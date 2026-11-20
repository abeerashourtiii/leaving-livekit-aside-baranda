// @ts-nocheck
// supabase/functions/livekit-recording/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload } from "npm:livekit-server-sdk";
import { serveWithCors } from "../_shared/cors.ts";

const jsonHeaders = { "Content-Type": "application/json" };

serveWithCors(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  // 1. دعم الأسماء المختلفة لمتغيرات البيئة الخاصة بـ LiveKit
  const livekitUrl = Deno.env.get("LIVEKIT_URL") || Deno.env.get("LIVEKIT_HOST");
  const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY");
  const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET");

  if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
    console.error("Missing LiveKit environment variables");
    return new Response(
      JSON.stringify({
        error: "Server configuration error: Missing LiveKit credentials",
      }),
      { status: 500, headers: jsonHeaders }
    );
  }

  const egressClient = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);
  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase client configuration" }),
      { status: 500, headers: jsonHeaders }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid session" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const user = userData.user;
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  // ↔ G2: كتابات recording_* على lives صارت للخدمة فقط (trigger lives_guard_host_update يمنع المضيف من كتابة recording_filepath/recording_url…).
  //   بعد التحقق من أن المستخدم هو مضيف البث (أدناه) نكتب بمفتاح الخدمة. العميل الأصلى (JWT المستخدم) يظل للقراءة والتحقق فقط.
  const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { action, roomName } = body;
  if (!action || !roomName) {
    return new Response(
      JSON.stringify({ error: "action and roomName are required" }),
      { status: 400, headers: jsonHeaders }
    );
  }

  const { data: live, error: liveError } = await supabase
    .from("lives")
    .select("id, host_id, status, recording_status, created_at")
    .eq("room_name", roomName)
    .maybeSingle();

  if (liveError) {
    return new Response(JSON.stringify({ error: "Failed to look up room" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  if (!live) {
    return new Response(JSON.stringify({ error: "Room not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  if (live.host_id !== user.id) {
    return new Response(
      JSON.stringify({ error: "Not the host of this room" }),
      { status: 403, headers: jsonHeaders }
    );
  }

  // --- بدء عملية التسجيل START ---
  if (action === "start") {
    // ↔ L1: اسم ملف عشوائى غير قابل للتخمين (لا يشتق من اسم الغرفة ولا من الوقت).
    const filepath = `recordings/${crypto.randomUUID()}.mp4`;

    // التحقق الآمن من مفاتيح التخزين السحابي S3
    const s3AccessKey = Deno.env.get("RECORDING_S3_ACCESS_KEY");
    const s3Secret = Deno.env.get("RECORDING_S3_SECRET");
    const s3Bucket = Deno.env.get("RECORDING_S3_BUCKET");
    const s3Endpoint = Deno.env.get("RECORDING_S3_ENDPOINT");

    // ↔ K2: لا بدء إلا لبث جارٍ (live)، ولا بدء ثانٍ لو فيه تسجيل شغّال/قيد المعالجة (كان كل نداء يبدأ egress جديدًا ويستبدل egress_id المخزَّن فتبقى
    //   تسجيلات يتيمة وتكلفة)، ولا بدء بلا إعدادات S3 (كان يُمرَّر {} ويُسجَّل recording_filepath كأن الملف محفوظ).
    if (live.status !== "live") {
      return new Response(JSON.stringify({ error: "Live is not active" }), { status: 409, headers: jsonHeaders });
    }
    if (!s3AccessKey || !s3Secret || !s3Bucket) {
      console.error("Recording storage (RECORDING_S3_*) is not configured; refusing to start egress.");
      return new Response(JSON.stringify({ error: "Recording is not available" }), { status: 503, headers: jsonHeaders });
    }
    // حجز ذرّى للحالة (يمنع سباق نداءين متزامنين): ينجح نداء واحد فقط.
    const { data: claimed, error: claimError } = await serviceClient
      .from("lives")
      .update({ recording_status: "recording" })
      .eq("id", live.id)
      .or("recording_status.is.null,recording_status.not.in.(recording,processing)")
      .select("id");
    if (claimError) {
      console.error("Recording claim error:", claimError);
      return new Response(JSON.stringify({ error: "Failed to start recording" }), { status: 500, headers: jsonHeaders });
    }
    if (!claimed || claimed.length === 0) {
      return new Response(JSON.stringify({ error: "Recording already in progress" }), { status: 409, headers: jsonHeaders });
    }

    try {
      const fileOutput = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath,
        output: {
          case: "s3",
          value: new S3Upload({
            accessKey: s3AccessKey,
            secret: s3Secret,
            bucket: s3Bucket,
            region: Deno.env.get("RECORDING_S3_REGION") || "us-east-1",
            endpoint: s3Endpoint || undefined,
            forcePathStyle: true,
          }),
        },
      });
      const egressOptions = { file: fileOutput };

      const info = await egressClient.startRoomCompositeEgress(
        roomName,
        egressOptions,
        { layout: "grid" }
      );

      // ↔ L1: المعرّف والمسار فى جدول خاص (service_role فقط) لا فى lives المقروء للمستخدمين.
      const { error: privError } = await serviceClient
        .from("live_recording_private")
        .upsert({ live_id: live.id, egress_id: info.egressId, recording_filepath: filepath }, { onConflict: "live_id" });
      if (privError) {
        console.error("Failed to store private recording info:", privError);
        try { await egressClient.stopEgress(info.egressId); } catch (_) { /* ignore */ }
        await serviceClient.from("lives").update({ recording_status: "failed" }).eq("id", live.id);
        return new Response(JSON.stringify({ error: "Failed to start recording" }), { status: 500, headers: jsonHeaders });
      }

      // ↔ لا نُرجع filepath للعميل (L1).
      return new Response(JSON.stringify({ egressId: info.egressId }), { headers: jsonHeaders });
    } catch (err) {
      console.error("Start recording error:", err);
      // فشل البدء: نحرّر الحجز (وإلا يبقى recording_status=recording بلا تسجيل فعلى) ونعلّمه failed. التفاصيل فى السجل فقط (K2: لا نعيد err.message للعميل).
      await serviceClient.from("lives").update({ recording_status: "failed" }).eq("id", live.id);
      return new Response(
        JSON.stringify({ error: "Failed to start recording" }),
        { status: 500, headers: jsonHeaders }
      );
    }
  }

  // --- إيقاف عملية التسجيل STOP ---
  if (action === "stop") {
    // ↔ G2: معرّف التسجيل يُؤخذ من قاعدة البيانات (الذى كتبته عملية البدء) لا من جسم الطلب — كان المضيف يقدر يمرّر أى egressId (تسجيل بث آخر).
    const { data: priv } = await serviceClient
      .from("live_recording_private")
      .select("egress_id")
      .eq("live_id", live.id)
      .maybeSingle();
    const egressToStop = (priv?.egress_id ?? null) as string | null;
    if (!egressToStop) {
      return new Response(
        JSON.stringify({ error: "No active recording to stop for this room" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    try {
      await egressClient.stopEgress(egressToStop);
      // ↔ K1: لا نثق بـ durationSec القادم من العميل (كان يُكتب كما هو). نحسبه على الخادم من وقت إنشاء البث (التسجيل يبدأ مع البث) بسقف 24 ساعة.
      const durationSec = Math.min(86400, Math.max(0, Math.round((Date.now() - new Date(live.created_at as string).getTime()) / 1000)));

      await serviceClient
        .from("lives")
        .update({
          recording_status: "processing",
          ...(durationSec != null ? { duration_sec: durationSec } : {}),
        })
        .eq("id", live.id);

      return new Response(JSON.stringify({ stopped: true }), {
        headers: jsonHeaders,
      });
    } catch (err) {
      console.error("Stop recording error:", err);
      return new Response(
        JSON.stringify({ error: "Failed to stop recording" }),
        { status: 500, headers: jsonHeaders }
      );
    }
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), {
    status: 400,
    headers: jsonHeaders,
  });
});