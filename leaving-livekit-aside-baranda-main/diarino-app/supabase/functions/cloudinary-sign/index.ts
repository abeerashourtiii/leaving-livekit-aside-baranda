// @ts-nocheck
// supabase/functions/cloudinary-sign/index.ts
//
// ↔ K3: رفع Cloudinary الموقَّع. الرفع الحالى مباشر من التطبيق بـ upload_preset عام *غير موقَّع* (اسم الحساب والـ preset فى الكود المنشور)، فأى شخص
//   (حتى بلا حساب) يرفع إلى حسابك بما تسمح به إعدادات الـ preset = تكلفة تخزين/نقل ومحتوى غير مراجَع. هذه الدالة تُصدر *توقيعًا قصير العمر لكل رفع*
//   بعد: (1) جلسة حقيقية غير مجهولة، (2) حد يومى لكل مستخدم (bump_upload_quota)، (3) مجلد ثابت لكل مستخدم وpreset يحدّده الخادم (لا العميل).
//   مُعطَّلة افتراضيًا: العميل لا يستدعيها إلا مع EXPO_PUBLIC_SIGNED_UPLOADS=1، والمسار القديم يبقى احتياطيًا أثناء الانتقال.
//
// الأسرار المطلوبة (supabase secrets set): CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
//   CLOUDINARY_SIGNED_PRESET_IMAGE, CLOUDINARY_SIGNED_PRESET_VIDEO, (اختيارى) CLOUDINARY_SIGNED_PRESET_AUDIO, UPLOAD_DAILY_LIMIT (الافتراضى 60).
//   الـ presets لازم تكون من نوع *Signed* فى لوحة Cloudinary مع allowed_formats وmax_file_size مناسبين (انظر docs/cloudinary-image-preset.md).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { serveWithCors } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

serveWithCors(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME");
  const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
  const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");
  if (!cloudName || !apiKey || !apiSecret) {
    console.error("cloudinary-sign: Cloudinary secrets are not configured");
    return json({ error: "Signed uploads are not configured" }, 501);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);
  if (user.is_anonymous) return json({ error: "Registered account required" }, 403);

  let body: { resourceType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const kind = body.resourceType === "video" ? "video" : body.resourceType === "audio" ? "audio" : "image";
  const preset = Deno.env.get(
    kind === "video" ? "CLOUDINARY_SIGNED_PRESET_VIDEO" : kind === "audio" ? "CLOUDINARY_SIGNED_PRESET_AUDIO" : "CLOUDINARY_SIGNED_PRESET_IMAGE",
  );
  if (!preset) {
    console.error(`cloudinary-sign: no signed preset configured for ${kind}`);
    return json({ error: "Signed uploads are not configured" }, 501);
  }

  // الحد اليومى لكل مستخدم (الأدمن ×10 لرفع الموسيقى والإدارة).
  const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: adminRow } = await serviceClient.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  const baseLimit = Number(Deno.env.get("UPLOAD_DAILY_LIMIT") ?? "60") || 60;
  const limit = adminRow ? baseLimit * 10 : baseLimit;
  const { data: allowed, error: quotaError } = await serviceClient.rpc("bump_upload_quota", { p_user: user.id, p_limit: limit });
  if (quotaError) {
    console.error("cloudinary-sign quota error:", quotaError);
    return json({ error: "Failed to verify upload quota" }, 500);
  }
  if (!allowed) return json({ error: "Daily upload limit reached", reason: "quota" }, 429);

  // معاملات موقَّعة: folder (ثابت لكل مستخدم)، timestamp (Cloudinary يرفض التوقيع بعد ~1 ساعة)، upload_preset (من الخادم).
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = kind === "audio" ? "music" : `uploads/${user.id}`;
  const toSign = `folder=${folder}&timestamp=${timestamp}&upload_preset=${preset}`;
  const signature = await sha1Hex(toSign + apiSecret);

  return json({ signature, timestamp, api_key: apiKey, cloud_name: cloudName, folder, upload_preset: preset });
});
