// اختبار بحسابين: غير المضيف لا يقرأ recording_filepath / recording_url / egress_id لبث غير منشور عبر REST، ولا يحصل على رابط موقّع،
// والمضيف يحصل عليه، والنشر يفتحه للآخرين، وإلغاء النشر يغلقه، والرابط العام القديم لا يعمل (حاوية خاصة).
// ⚠ يعمل على مشروع *تجريبى* فقط (يرفض الإنتاج المعروف، ويلزمه ALLOW_TEST_PROJECT=1 و ALLOWED_TEST_PROJECT_REF=<ref> خارج localhost).
// المتغيرات:  SUPABASE_URL  SUPABASE_ANON_KEY  HOST_EMAIL HOST_PASSWORD  OTHER_EMAIL OTHER_PASSWORD   (حسابان حقيقيان غير مجهولين، 18+)
//             SUPABASE_SERVICE_ROLE_KEY (اختيارى لكنه لازم لاختبار الرابط الموقّع: يزرع تسجيلًا وهميًا ويرفع ملفًا صغيرًا ثم ينظّف)
//             RECORDING_BUCKET=live-recordings
// الخرج: جدول PASS/FAIL/SKIP؛ رمز الخروج 1 عند أى FAIL. SKIP لا يُحتسب نجاحًا.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const env = (k) => process.env[k];
const URL_ = env("SUPABASE_URL"), ANON = env("SUPABASE_ANON_KEY"), SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");
const BUCKET = env("RECORDING_BUCKET") || "live-recordings";
const PRODUCTION_REFS = ["nwbtzchtwyhqktoerbap"];
for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "HOST_EMAIL", "HOST_PASSWORD", "OTHER_EMAIL", "OTHER_PASSWORD"]) {
  if (!env(k)) { console.error(`✗ المتغير ${k} مطلوب.`); process.exit(1); }
}
const host = new URL(URL_).hostname;
const isLocal = host === "localhost" || host === "127.0.0.1";
const ref = host.endsWith(".supabase.co") ? host.split(".")[0] : null;
if (ref && PRODUCTION_REFS.includes(ref)) { console.error(`✗ ${ref} هو مشروع الإنتاج — يرفض السكربت.`); process.exit(1); }
if (!isLocal && (env("ALLOW_TEST_PROJECT") !== "1" || !ref || env("ALLOWED_TEST_PROJECT_REF") !== ref)) {
  console.error("✗ اضبط ALLOW_TEST_PROJECT=1 و ALLOWED_TEST_PROJECT_REF=<ref المشروع التجريبى> (يطابق الرابط)."); process.exit(1);
}

const results = [];
const record = (name, status, note = "") => { results.push({ test: name, status, note }); };
const mk = () => createClient(URL_, ANON, { auth: { persistSession: false } });
const signIn = async (email, password) => {
  const c = mk();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`تسجيل الدخول فشل لـ ${email}: ${error.message}`);
  return c;
};
const admin = SERVICE ? createClient(URL_, SERVICE, { auth: { persistSession: false } }) : null;

const emptyOrDenied = ({ data, error }) => !!error || data == null || (Array.isArray(data) && data.length === 0);
const allNull = (rows) => rows.every((r) => r.recording_url == null && r.egress_id == null && r.recording_filepath == null);
const getUrl = async (c, liveId) => {
  const { data, error } = await c.functions.invoke("live-recording-url", { body: { liveId } });
  const status = error?.context?.status;
  return { url: data?.url ?? null, status: error ? status ?? 0 : 200 };
};

let liveId = null, objectPath = null, hostC, otherC;
try {
  hostC = await signIn(env("HOST_EMAIL"), env("HOST_PASSWORD"));
  otherC = await signIn(env("OTHER_EMAIL"), env("OTHER_PASSWORD"));

  // 1) المضيف ينشئ بثًّا ثم ينهيه (غير منشور).
  const { data: room, error: crErr } = await hostC.rpc("create_live_room", { p_title: `privacy-test-${Date.now()}` });
  if (crErr || typeof room !== "string") throw new Error(`create_live_room: ${crErr?.message}`);
  record("اسم الغرفة من الخادم (live_<uuid>) بلا معرّف المضيف", /^live_[0-9a-f-]{36}$/.test(room) ? "PASS" : "FAIL", room);
  const { data: liveRow } = await hostC.from("lives").select("id").eq("room_name", room).single();
  liveId = liveRow.id;
  await hostC.rpc("end_live_room", { p_room_name: room });

  // 2) زرع تسجيل وهمى (يحتاج مفتاح الخدمة).
  let seeded = false;
  if (admin) {
    objectPath = `recordings/${randomUUID()}.mp4`;
    const up = await admin.storage.from(BUCKET).upload(objectPath, new Blob(["privacy-test"], { type: "video/mp4" }), { upsert: true });
    if (!up.error) {
      await admin.from("live_recording_private").upsert({ live_id: liveId, egress_id: "EG_PRIVACY_TEST", recording_filepath: objectPath });
      await admin.from("lives").update({ recording_status: "ready" }).eq("id", liveId);
      seeded = true;
    } else record("زرع ملف تجريبى فى الحاوية", "SKIP", up.error.message);
  } else record("زرع تسجيل تجريبى", "SKIP", "SUPABASE_SERVICE_ROLE_KEY غير مضبوط");

  // 3) غير المضيف عبر REST: لا يقرأ شيئًا لبث غير منشور.
  const sel = await otherC.from("lives").select("id, recording_url, recording_filepath, egress_id").eq("id", liveId);
  record("غير المضيف: lives (الأعمدة الثلاثة) لبث غير منشور", emptyOrDenied(sel) || allNull(sel.data) ? "PASS" : "FAIL", JSON.stringify(sel.data));
  const byEgress = await otherC.from("lives").select("id").eq("egress_id", "EG_PRIVACY_TEST");
  record("غير المضيف: البحث بقيمة egress_id لا يُرجع شيئًا", emptyOrDenied(byEgress) ? "PASS" : "FAIL");
  const priv = await otherC.from("live_recording_private").select("*").eq("live_id", liveId);
  record("غير المضيف: الجدول الخاص غير مقروء", emptyOrDenied(priv) ? "PASS" : "FAIL", priv.error?.code ?? "");
  const star = await otherC.from("lives").select("*").eq("id", liveId);
  record("غير المضيف: select * لا يكشف المسار/الرابط/المعرّف", emptyOrDenied(star) || allNull(star.data) ? "PASS" : "FAIL");

  // 4) المضيف: لا يرى المسار الخاص أيضًا عبر REST (الجدول مغلق على العملاء)؛ ويحصل على رابط موقّع.
  const hostPriv = await hostC.from("live_recording_private").select("*").eq("live_id", liveId);
  record("المضيف: الجدول الخاص مغلق على العملاء أيضًا", emptyOrDenied(hostPriv) ? "PASS" : "FAIL");
  if (seeded) {
    const other = await getUrl(otherC, liveId);
    record("غير المضيف: الدالة ترفض (403) لبث غير منشور", other.status === 403 && !other.url ? "PASS" : "FAIL", `status=${other.status}`);
    const mine = await getUrl(hostC, liveId);
    record("المضيف: يحصل على رابط موقّع", mine.url ? "PASS" : "FAIL", `status=${mine.status}`);
    if (mine.url) {
      const head = await fetch(mine.url, { method: "GET", headers: { Range: "bytes=0-3" } });
      record("الرابط الموقّع يعمل", head.ok ? "PASS" : "FAIL", `HTTP ${head.status}`);
    }
    const pub = await fetch(`${URL_}/storage/v1/object/public/${BUCKET}/${objectPath}`);
    record("الرابط العام القديم لا يعمل (حاوية خاصة)", pub.status >= 400 ? "PASS" : "FAIL", `HTTP ${pub.status}`);

    // 5) النشر يفتحه للآخرين، وإلغاء النشر يغلقه.
    await hostC.from("lives").update({ published_public: true }).eq("id", liveId);
    const pubOther = await getUrl(otherC, liveId);
    const { data: modRow } = await admin.from("lives").select("moderation_status").eq("id", liveId).single();
    record("بعد النشر: غير المضيف يحصل على رابط (إن كان moderation_status=approved)", modRow?.moderation_status === "approved" ? (pubOther.url ? "PASS" : "FAIL") : "SKIP", `moderation=${modRow?.moderation_status} status=${pubOther.status}`);
    const sel2 = await otherC.from("lives").select("recording_url, recording_filepath, egress_id").eq("id", liveId);
    record("بعد النشر: الأعمدة الثلاثة ما زالت null لغير المضيف", emptyOrDenied(sel2) || allNull(sel2.data) ? "PASS" : "FAIL", JSON.stringify(sel2.data));
    await hostC.from("lives").update({ published_public: false }).eq("id", liveId);
    const again = await getUrl(otherC, liveId);
    record("بعد إلغاء النشر: الرفض يعود (403)", again.status === 403 ? "PASS" : "FAIL", `status=${again.status}`);
  } else {
    for (const t of ["غير المضيف: الدالة ترفض لبث غير منشور", "المضيف: يحصل على رابط موقّع", "الرابط الموقّع يعمل", "الرابط العام القديم لا يعمل", "دورة النشر/إلغاء النشر"]) record(t, "SKIP", "يلزم SUPABASE_SERVICE_ROLE_KEY");
  }
} catch (err) {
  record("تنفيذ الاختبار", "FAIL", err.message);
} finally {
  try { if (liveId && hostC) await hostC.from("lives").delete().eq("id", liveId); } catch {}
  try { if (admin && objectPath) await admin.storage.from(BUCKET).remove([objectPath]); } catch {}
  console.table(results);
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  console.log(`النتيجة: ${results.length - failed - skipped} PASS، ${failed} FAIL، ${skipped} SKIP`);
  process.exit(failed ? 1 : 0);
}
