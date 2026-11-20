// @ts-nocheck
// // supabase/functions/send-push/index.ts
//
// Turns a new row in public.notifications into a real OS-level push, on
// top of the in-app notification that already exists the moment the row
// is inserted (DB triggers on likes/favorites/follows/chat_messages —
// see 20260802000000_notifications_backend.sql). Without this, someone
// only ever finds out about a like/follow/message by opening the app and
// checking the bell — this is what reaches them while it's closed.
//
// SETUP (one-time, after deploying):
//   1. supabase functions deploy send-push --no-verify-jwt
//      (--no-verify-jwt because this is called by a Database Webhook,
//      server-to-server, not by a signed-in user — same reasoning as
//      livekit-webhook.)
//   2. supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_URL=...
//      (service role, NOT anon — this needs to read push_tokens for
//      whichever user the notification is for, not just the caller.)
//   3. supabase secrets set PUSH_WEBHOOK_SECRET=<a long random string you generate>
//      (RLS audit fix — --no-verify-jwt alone makes this URL callable by
//      anyone who finds it, with no proof the caller is actually the
//      Database Webhook. This shared secret is that proof — the same
//      role LiveKit's signed-webhook check plays for livekit-webhook,
//      just simpler since it's our own webhook, not a third party's.)
//   4. Supabase Dashboard → Database → Webhooks → Create a new webhook:
//        Table: notifications | Events: Insert
//        Type: Supabase Edge Function | Function: send-push
//        HTTP Headers → add: x-webhook-secret = <the same value from step 3>
//      (the dashboard wires the Authorization header itself — the
//      x-webhook-secret header is the one part you add by hand)
//
// Expo's push endpoint doesn't require its own credentials for this app
// (no push notification service key needed on the Expo/RN side, unlike
// FCM/APNs directly) — it's a public endpoint that accepts Expo push
// tokens minted by this same project's projectId.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { serveWithCors } from "../_shared/cors.ts";

type NotifCategory = "like" | "save" | "follow" | "chat" | "new_match" | "price_drop" | "comment" | "offer" | "approval";

const TITLE_BY_CATEGORY: Record<NotifCategory, string> = {
  like: "إعجاب جديد",
  save: "حفظ جديد",
  follow: "متابع جديد",
  // ↔ رسائل المحادثات = رسائل العروض (على ريلز أو طلبات): تظهر فى صفحة «العروض» وليس جرس الإشعارات.
  chat: "رسالة جديدة في العروض",
  comment: "تعليق جديد",
  offer: "عرض جديد",
  approval: "قرار على إعلانك",
  new_match: "عقار جديد يطابق تنبيهك",
  price_drop: "انخفاض سعر",
};

// ↔ مقارنة السر ثابتة الزمن: نحسب SHA-256 للقيمتين (طول ثابت) ثم نقارنهما بـ XOR على كل البايتات بدل `!==` اللى بيتوقف عند أول
//   اختلاف (تسريب توقيت نظرى لقيمة السر).
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const RECEIPT_MIN_AGE_MS = 15 * 60 * 1000; // توصية Expo: انتظر ~15 دقيقة قبل طلب الإيصالات
const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // Expo يحتفظ بالإيصالات 24 ساعة
const RECEIPT_BATCH = 300;

// ↔ توكنات ميتة كانت تتراكم (DeviceNotRegistered: تطبيق اتحذف / توكن اتغيّر): نحذفها (1) فورًا لو ظهر الخطأ فى ticket الإرسال،
//   و(2) بعد ~15 دقيقة من إيصالات Expo (getReceipts) — بدون مهمة مجدولة: كل استدعاء لـ send-push بيعالج دفعة من الإيصالات المستحقة.
async function deleteDeadTokens(supabase, tokens: string[]) {
  if (!tokens.length) return;
  const { error } = await supabase.from("push_tokens").delete().in("token", tokens);
  if (error) console.error("Failed to delete dead push tokens:", error.message);
}

async function recordTickets(supabase, messages, tickets) {
  const dead: string[] = [];
  const rows: { ticket_id: string; token: string }[] = [];
  tickets.forEach((t, i) => {
    const token = messages[i]?.to;
    if (!token || !t) return;
    if (t.status === "error" && t.details?.error === "DeviceNotRegistered") dead.push(token);
    else if (t.status === "ok" && t.id) rows.push({ ticket_id: t.id, token });
  });
  await deleteDeadTokens(supabase, dead);
  if (rows.length) {
    const { error } = await supabase.from("push_receipts").upsert(rows, { onConflict: "ticket_id" });
    if (error && error.code !== "42P01" && error.code !== "PGRST205") console.error("Failed to store push receipts:", error.message);
  }
}

async function processPendingReceipts(supabase) {
  const olderThan = new Date(Date.now() - RECEIPT_MIN_AGE_MS).toISOString();
  const { data: pending, error } = await supabase
    .from("push_receipts")
    .select("ticket_id, token, created_at")
    .lt("created_at", olderThan)
    .order("created_at", { ascending: true })
    .limit(RECEIPT_BATCH);
  if (error || !pending?.length) return;

  const res = await fetch(EXPO_RECEIPTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ids: pending.map((p) => p.ticket_id) }),
  });
  const json = await res.json().catch(() => null);
  const receipts = json?.data ?? {};

  const dead: string[] = [];
  const done: string[] = [];
  for (const p of pending) {
    const r = receipts[p.ticket_id];
    if (r) {
      done.push(p.ticket_id);
      if (r.status === "error" && r.details?.error === "DeviceNotRegistered") dead.push(p.token);
    } else if (Date.now() - new Date(p.created_at).getTime() > RECEIPT_MAX_AGE_MS) {
      done.push(p.ticket_id); // انتهت صلاحية الإيصال عند Expo
    }
  }
  await deleteDeadTokens(supabase, dead);
  if (done.length) await supabase.from("push_receipts").delete().in("ticket_id", done);
}

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ↔ RLS audit fix — this function is deployed with --no-verify-jwt
  // (it has to be, since the Database Webhook calls it server-to-server,
  // not as a signed-in user), which otherwise means every request reaching
  // this URL runs, with nothing proving it actually came from Supabase's
  // webhook and not a stranger who found the URL. This header is that
  // proof: only the Database Webhook (configured with the same value —
  // see step 4 above) can trigger a real push to someone's device.
  const providedSecret = req.headers.get("x-webhook-secret");
  const expectedSecret = Deno.env.get("PUSH_WEBHOOK_SECRET");
  if (!expectedSecret || !providedSecret || !(await safeEqual(providedSecret, expectedSecret))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const payload = await req.json();
  // Supabase Database Webhook payload shape: { type, table, record, old_record, schema }
  const record = payload?.record as {
    recipient_id?: string; category?: NotifCategory; text?: string;
    property_id?: string | null; chat_id?: string | null; actor_id?: string | null;
  } | undefined;

  if (!record?.recipient_id) {
    return new Response(JSON.stringify({ skipped: "no recipient_id" }), { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: tokens, error } = await supabase
    .from("push_tokens")
    .select("token")
    .eq("user_id", record.recipient_id);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  if (!tokens?.length) {
    return new Response(JSON.stringify({ skipped: "no push tokens for recipient" }), { status: 200 });
  }

  const title = TITLE_BY_CATEGORY[record.category ?? "like"] ?? "Shahir";
  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default",
    title,
    body: record.text ?? "",
    data: {
      category: record.category,
      propertyId: record.property_id ?? undefined,
      chatId: record.chat_id ?? undefined,
      sellerId: record.category === "follow" ? record.actor_id ?? undefined : undefined,
    },
  }));

  const pushRes = await fetch(EXPO_SEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(messages),
  });

  const pushJson = await pushRes.json().catch(() => null);
  // معالجة التذاكر/الإيصالات best-effort: أى فشل هنا لا يؤثر على نتيجة الإرسال نفسه.
  try {
    if (Array.isArray(pushJson?.data)) await recordTickets(supabase, messages, pushJson.data);
    await processPendingReceipts(supabase);
  } catch (err) {
    console.error("push receipts handling failed:", err);
  }
  return new Response(JSON.stringify({ sent: messages.length, expo: pushJson }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
