// @ts-nocheck
// supabase/functions/cloudinary-cleanup/index.ts
//
// حذف ملفات Cloudinary اليتيمة فعليًا (صور/فيديو/صوت) — الـ API Secret على الخادم فقط (لا يوجد فى كود التطبيق).
//
// الطابور تملؤه triggers قاعدة البيانات عند حذف/استبدال أى وسائط (migration 20261121000200_cloudinary_cleanup_queue.sql)؛ هذه الدالة:
//   mode "process" (الافتراضى): تعالج دفعة من الطابور — لكل ملف: تتأكد أنه لم يعد مستخدمًا فى أى سجل نشط (cloudinary_asset_in_use)،
//        ثم destroy عبر Cloudinary API (مع invalidate لإزالته من الـ CDN). «not found» = نجاح (محذوف أصلًا). أى خطأ مؤقت (شبكة/429/5xx)
//        = إعادة محاولة بتأخير متصاعد (5 دقائق × 2^المحاولة، حتى 8 محاولات) مع تسجيل الخطأ فى last_error. وبعد الحذف تُزال بصمات منع التكرار والسجل.
//   mode "scan": فحص اليتامى. source "ledger" (الافتراضى): ملفات مسجّلة فى media_fingerprints/media لم يعد لها سجل نشط وأقدم من مهلة الأمان
//        (≥ 24 ساعة). source "cloudinary": يسرد ملفات Cloudinary تحت prefix مُحدَّد (إلزامى) ويقارنها بالسجلات النشطة. **dryRun افتراضيًا**: يرجّع
//        القائمة للمراجعة فقط؛ الإدخال للطابور يتطلب dryRun:false (وللمصدر cloudinary يتطلب أيضًا confirm:"DELETE" والمشرف الرئيسى).
//   mode "process_own": للمستخدم نفسه بعد حذفه إعلانًا: يعالج صفوف الطابور المملوكة له فقط (الحذف الفورى لصور/فيديوهات إعلانه، مع نفس التحقق من عدم الاستخدام).
//   mode "stats": أعداد الطابور.
//
// الصلاحية: process_own لأى مستخدم مسجَّل (لصفوفه فقط)؛ وباقى الأوضاع: (أ) رأس x-cleanup-secret = السر CLEANUP_CRON_SECRET (للجدولة pg_cron/pg_net)، أو (ب) المشرف الرئيسى (JWT). لا أحد غيرهما.
// الأسرار: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLEANUP_CRON_SECRET (اختيارى للجدولة).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { serveWithCors } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const MAX_ATTEMPTS = 8;
const BACKOFF_MIN = 5; // دقائق × 2^المحاولة

async function destroyAsset(cloud: string, key: string, secret: string, resourceType: string, publicId: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  // التوقيع: المعاملات (بدون api_key/resource_type/cloud_name/file) مرتبة أبجديًا + السر.
  const toSign = `invalidate=true&public_id=${publicId}&timestamp=${timestamp}`;
  const signature = await sha1Hex(toSign + secret);
  const form = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), api_key: key, signature, invalidate: "true" });
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/${resourceType}/destroy`, { method: "POST", body: form });
  let body: any = null;
  try { body = await res.json(); } catch { /* غير JSON */ }
  return { status: res.status, body };
}

serveWithCors(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cloud = Deno.env.get("CLOUDINARY_CLOUD_NAME");
  const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
  const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");
  if (!cloud || !apiKey || !apiSecret) return json({ error: "Cloudinary secrets are not configured" }, 501);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ── الصلاحية ──
  let isSuper = false;
  let viaCron = false;
  let userId: string | null = null;
  const cronSecret = Deno.env.get("CLEANUP_CRON_SECRET");
  const given = req.headers.get("x-cleanup-secret");
  if (cronSecret && given && safeEqual(given, cronSecret)) {
    viaCron = true;
  } else {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);
    userId = user.id;
    const { data: roleRow } = await service
      .from("user_roles").select("is_super_admin").eq("user_id", user.id).eq("role", "admin").eq("is_super_admin", true).maybeSingle();
    isSuper = !!roleRow;
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const mode = String(body.mode ?? "process");
  // المستخدم العادى مسموح له فقط بـ process_own (حذف ملفات عناصره هو التى حذفها للتو)؛ باقى الأوضاع للمشرف الرئيسى أو الجدولة.
  if (!viaCron && !isSuper && mode !== "process_own") return json({ error: "Forbidden" }, 403);
  if (mode === "process_own" && !userId) return json({ error: "process_own requires a signed-in user" }, 400);

  // ───────────── stats ─────────────
  if (mode === "stats") {
    const { data } = await service.from("cloudinary_cleanup_queue").select("done_at, attempts, result, last_error");
    const rows = data ?? [];
    const pending = rows.filter((r: any) => !r.done_at);
    return json({
      pending: pending.length,
      failing: pending.filter((r: any) => r.attempts > 0 && r.last_error).length,
      gaveUp: pending.filter((r: any) => r.attempts >= MAX_ATTEMPTS).length,
      done: rows.filter((r: any) => r.done_at).length,
      deleted: rows.filter((r: any) => r.result === "deleted" || r.result === "not_found").length,
      skippedInUse: rows.filter((r: any) => r.result === "in_use_skipped").length,
    });
  }

  // ───────────── process ─────────────
  if (mode === "process" || mode === "process_own") {
    const limit = Math.min(Math.max(Number(body.limit ?? 25) || 25, 1), mode === "process_own" ? 50 : 100);
    // process_own: صفوف الطابور المملوكة لهذا المستخدم فقط (owner_id = المستخدم) — حذف فورى بعد حذفه إعلانه.
    const { data: claimed, error: claimError } = mode === "process_own"
      ? await service.rpc("claim_cloudinary_cleanup_for", { p_owner: userId, p_limit: limit })
      : await service.rpc("claim_cloudinary_cleanup", { p_limit: limit });
    if (claimError) {
      console.error("cloudinary-cleanup claim error:", claimError);
      return json({ error: "Failed to read cleanup queue" }, 500);
    }
    const summary = { claimed: (claimed ?? []).length, deleted: 0, notFound: 0, skippedInUse: 0, foreignCloud: 0, retry: 0, gaveUp: 0 };
    for (const row of claimed ?? []) {
      const finish = async (result: string) => {
        await service.from("cloudinary_cleanup_queue").update({ done_at: new Date().toISOString(), result, last_error: null }).eq("id", row.id);
      };
      const fail = async (message: string) => {
        const minutes = BACKOFF_MIN * Math.pow(2, Math.max(0, row.attempts - 1));
        await service.from("cloudinary_cleanup_queue").update({
          last_error: message.slice(0, 500),
          next_attempt_at: new Date(Date.now() + minutes * 60_000).toISOString(),
        }).eq("id", row.id);
        if (row.attempts >= MAX_ATTEMPTS) summary.gaveUp++; else summary.retry++;
        console.error(`cloudinary-cleanup: ${row.resource_type}/${row.public_id} attempt ${row.attempts} failed: ${message}`);
      };
      try {
        if (row.cloud_name !== cloud) { await finish("foreign_cloud"); summary.foreignCloud++; continue; }
        const { data: inUse, error: inUseError } = await service.rpc("cloudinary_asset_in_use", { p_public_id: row.public_id });
        if (inUseError) { await fail(`in-use check failed: ${inUseError.message}`); continue; }
        if (inUse) { await finish("in_use_skipped"); summary.skippedInUse++; continue; }

        const { status, body: res } = await destroyAsset(cloud, apiKey, apiSecret, row.resource_type, row.public_id);
        if (status === 200 && res?.result === "ok") {
          await finish("deleted"); summary.deleted++;
        } else if ((status === 200 && res?.result === "not found") || status === 404) {
          await finish("not_found"); summary.notFound++;
        } else {
          await fail(`Cloudinary ${status}: ${res?.error?.message ?? res?.result ?? "unknown error"}`);
          continue;
        }
        // الملف لم يعد موجودًا: نُسقط بصماته (منع التكرار) وسجل الرفع كى لا يُعاد استخدام رابط ميت أو يُفحص كيتيم.
        const { data: fpRows } = await service.from("media_fingerprints").select("id, url").like("url", `%/${row.public_id}.%`);
        const ids = (fpRows ?? []).map((r: any) => r.id);
        if (ids.length) await service.from("media_fingerprints").delete().in("id", ids);
        await service.from("media").delete().eq("public_id", row.public_id);
      } catch (e) {
        await fail(String(e?.message ?? e));
      }
    }
    return json({ mode, ...summary });
  }

  // ───────────── scan ─────────────
  if (mode === "scan") {
    const source = body.source === "cloudinary" ? "cloudinary" : "ledger";
    const dryRun = body.dryRun !== false; // افتراضيًا معاينة فقط
    const olderThanHours = Math.max(Number(body.olderThanHours ?? 24) || 24, 24); // لا أقل من 24 ساعة (ملف قيد الرفع)
    const limit = Math.min(Math.max(Number(body.limit ?? 500) || 500, 1), 2000);
    let candidates: any[] = [];

    if (source === "ledger") {
      const { data, error } = await service.rpc("cloudinary_orphan_candidates", { p_older_than: `${olderThanHours} hours`, p_limit: limit });
      if (error) { console.error("cloudinary-cleanup scan error:", error); return json({ error: "Scan failed" }, 500); }
      candidates = data ?? [];
    } else {
      if (!isSuper) return json({ error: "Cloudinary listing scan requires the super admin" }, 403);
      const prefix = String(body.prefix ?? "").trim();
      if (!prefix) return json({ error: "prefix is required for source=cloudinary" }, 400);
      const types = Array.isArray(body.resourceTypes) && body.resourceTypes.length ? body.resourceTypes : ["image", "video"];
      const cutoff = Date.now() - olderThanHours * 3600_000;
      const auth = "Basic " + btoa(`${apiKey}:${apiSecret}`);
      for (const type of types) {
        if (!["image", "video", "raw"].includes(type)) continue;
        let cursor: string | undefined;
        for (let page = 0; page < 20 && candidates.length < limit; page++) {
          const qs = new URLSearchParams({ prefix, max_results: "100", type: "upload" });
          if (cursor) qs.set("next_cursor", cursor);
          const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/resources/${type}?${qs}`, { headers: { Authorization: auth } });
          if (!res.ok) return json({ error: `Cloudinary list failed (${res.status})` }, 502);
          const data = await res.json();
          for (const r of data.resources ?? []) {
            if (new Date(r.created_at).getTime() > cutoff) continue;
            const { data: inUse } = await service.rpc("cloudinary_asset_in_use", { p_public_id: r.public_id });
            if (!inUse) candidates.push({ cloud_name: cloud, resource_type: type, public_id: r.public_id, bytes: r.bytes ?? 0, created_at: r.created_at, source: "cloudinary" });
            if (candidates.length >= limit) break;
          }
          cursor = data.next_cursor;
          if (!cursor) break;
        }
      }
    }

    const totalBytes = candidates.reduce((s, c) => s + Number(c.bytes ?? 0), 0);
    if (dryRun) {
      return json({ mode, source, dryRun: true, count: candidates.length, totalBytes, sample: candidates.slice(0, 50) });
    }
    if (source === "cloudinary" && body.confirm !== "DELETE") {
      return json({ error: 'confirm:"DELETE" is required to queue files found by listing Cloudinary' }, 400);
    }
    let queued = 0;
    if (candidates.length) {
      const rows = candidates.map((c) => ({
        cloud_name: c.cloud_name, resource_type: c.resource_type, public_id: c.public_id, source_table: c.source,
      }));
      const { data: n, error } = await service.rpc("enqueue_cloudinary_orphans", { p_rows: rows });
      if (error) { console.error("cloudinary-cleanup enqueue error:", error); return json({ error: "Failed to queue orphans" }, 500); }
      queued = Number(n ?? 0);
    }
    return json({ mode, source, dryRun: false, queued, totalBytes, note: "ستُحذف عند تشغيل mode=process (مع إعادة التحقق من الاستخدام)." });
  }

  return json({ error: "Unknown mode" }, 400);
});
