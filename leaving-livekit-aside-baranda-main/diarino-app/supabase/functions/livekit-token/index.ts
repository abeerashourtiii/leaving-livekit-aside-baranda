// supabase/functions/livekit-token/index.ts
// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk";

// ترويسات CORS الموحدة الشاملة للويب وجميع المنصات
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  // 1. التعامل الفوري مع طلبات الاستكشاف المسبق (Preflight OPTIONS) للويب
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "Invalid session" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const user = userData.user;

  let body: { roomName?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const roomName = body.roomName;
  if (!roomName) {
    return new Response(JSON.stringify({ error: "roomName is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: live, error: liveError } = await supabase
    .from("lives")
    .select("id, host_id, status")
    .eq("room_name", roomName)
    .maybeSingle();

  if (liveError) {
    return new Response(JSON.stringify({ error: "Failed to look up room" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!live) {
    return new Response(JSON.stringify({ error: "Room not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (live.status === "ended") {
    return new Response(JSON.stringify({ error: "This live has ended" }), {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const isHost = live.host_id === user.id;

  // ↔ حظر المشاهد: المطرود (livekit-moderate) كان يرجع بتوكن جديد فورًا. الآن لا توكن لمن حظره المضيف من هذا البث.
  //   الجدول بلا سياسات (الخدمة فقط) فنقرأه بمفتاح الخدمة. لو الجدول غير موجود (migration لم تُطبَّق) لا نمنع أحدًا؛ أى خطأ آخر = رفض (fail closed).
  if (!isHost) {
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: ban, error: banError } = await serviceClient
      .from("live_bans")
      .select("user_id")
      .eq("live_id", live.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (banError && banError.code !== "42P01" && banError.code !== "PGRST205") {
      return new Response(JSON.stringify({ error: "Failed to verify access" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (ban) {
      return new Response(JSON.stringify({ error: "You were removed from this live", code: "live_banned" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // ↔ لا نستخدم البريد الإلكترونى كاسم عرض أبدًا (كان يظهر لكل المشاهدين لمن بلا اسم): الاسم أو «مستخدم».
  const displayName =
    (user.user_metadata?.full_name as string) ||
    (user.user_metadata?.name as string) ||
    "مستخدم";

  const at = new AccessToken(
    Deno.env.get("LIVEKIT_API_KEY")!,
    Deno.env.get("LIVEKIT_API_SECRET")!,
    {
      identity: user.id,
      name: displayName,
      ttl: "2h",
    }
  );

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: isHost,
    // ↔ أمنى: كانت true فيقدر أى مشاهد ينشر رسائل بيانات مباشرة فى الغرفة (يتجاوز bump_live_message_rate وفلتر التعليقات
    //   وينتحل senderName/senderId والعملاء يثقون فى المحتوى). كل التعليقات/الإعجابات تمرّ حصريًا عبر livekit-send-message
    //   (الذى يرسل بمفتاح الخدمة من الخادم)، فلا أحد يحتاج صلاحية نشر بيانات.
    canPublishData: false,
    canSubscribe: true,
  });

  const token = await at.toJwt();

  // إرجاع النتيجة مع تضمين ترويسات CORS
  return new Response(
    JSON.stringify({ token, url: Deno.env.get("LIVEKIT_URL"), isHost }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});