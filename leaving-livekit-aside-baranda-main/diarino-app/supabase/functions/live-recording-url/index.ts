// @ts-nocheck
// supabase/functions/live-recording-url/index.ts
//
// L1-ج: يُرجع رابطًا موقّعًا قصير العمر لتسجيل بث (الحاوية خاصة، لا رابط عام).
// يُنشر مع التحقق من JWT (الافتراضى):  supabase functions deploy live-recording-url
// الطلب:  POST { liveId: "<uuid>" }      الرد:  { url, expiresIn }
// التحقق: RPC can_view_live_recording (المضيف أو الأدمن أو بث منشور ومعتمد، والتسجيل ready) بجلسة المستخدم نفسها،
//         ثم التوقيع بمفتاح الخدمة. أى رفض يرجع 403 برسالة عامة (لا نكشف هل البث موجود).
// أسرار اختيارية:  RECORDING_S3_BUCKET (الافتراضى live-recordings)،  SIGNED_URL_TTL_SEC (الافتراضى 1800، بين 60 و7200)
import { createClient } from "jsr:@supabase/supabase-js@2";
import { serveWithCors } from "../_shared/cors.ts";

const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

serveWithCors(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "Missing Authorization header" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: "Server configuration error" });

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return json(401, { error: "Invalid session" });

  let body: { liveId?: string };
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  const liveId = typeof body?.liveId === "string" ? body.liveId : "";
  if (!UUID_RE.test(liveId)) return json(400, { error: "liveId is required" });

  const { data: allowed, error: allowError } = await userClient.rpc("can_view_live_recording", { p_live_id: liveId });
  if (allowError) {
    console.error("can_view_live_recording failed:", allowError);
    return json(500, { error: "Failed to check access" });
  }
  if (allowed !== true) return json(403, { error: "Recording not available" });

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { data: priv, error: privError } = await serviceClient
    .from("live_recording_private")
    .select("recording_filepath")
    .eq("live_id", liveId)
    .maybeSingle();
  if (privError) {
    console.error("live_recording_private lookup failed:", privError);
    return json(500, { error: "Failed to look up recording" });
  }
  if (!priv?.recording_filepath) return json(404, { error: "Recording not available" });

  const bucket = Deno.env.get("RECORDING_S3_BUCKET") || "live-recordings";
  const ttl = Math.min(7200, Math.max(60, Number(Deno.env.get("SIGNED_URL_TTL_SEC")) || 1800));
  const { data: signed, error: signError } = await serviceClient.storage
    .from(bucket)
    .createSignedUrl(priv.recording_filepath, ttl);
  if (signError || !signed?.signedUrl) {
    console.error("createSignedUrl failed:", signError);
    return json(404, { error: "Recording not available" });
  }
  return json(200, { url: signed.signedUrl, expiresIn: ttl });
});
