import { supabase } from "./supabase";

// ↔ المضيف حظر هذا المستخدم من البث (livekit-token ⇐ 403 code=live_banned): خطأ نهائى، لا نعيد المحاولة، والشاشة تعرض رسالة واضحة.
export class LiveBannedError extends Error {
  constructor() {
    super("live_banned");
    this.name = "LiveBannedError";
  }
}

async function readFunctionErrorBody(err: unknown): Promise<{ status?: number; code?: string }> {
  const ctx = (err as { context?: Response } | null)?.context;
  if (!ctx || typeof ctx.status !== "number") return {};
  let code: string | undefined;
  try {
    const j = (await ctx.clone().json()) as { code?: string };
    code = j?.code;
  } catch { /* ليس JSON */ }
  return { status: ctx.status, code };
}

export type LiveKitConnectionInfo = {
  token: string;
  url: string;
  isHost: boolean; // echoed back so the UI knows which controls to show
};

// Calls the `livekit-token` Edge Function with the caller's current
// Supabase session attached automatically by supabase-js.
// Added automatic retry logic to ensure room exists in DB before failing.
export async function fetchLiveKitToken(
  roomName: string,
  retries = 3,
  delay = 600
): Promise<LiveKitConnectionInfo> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke<LiveKitConnectionInfo>(
        "livekit-token",
        {
          body: { roomName },
        }
      );

      if (!error && data?.token && data?.url) {
        return data;
      }

      // أخطاء نهائية لا تفيد فيها إعادة المحاولة: محظور (403) أو انتهى البث (410).
      if (error) {
        const info = await readFunctionErrorBody(error);
        if (info.status === 403 && info.code === "live_banned") throw new LiveBannedError();
        if (info.status === 403 || info.status === 410) throw error;
      }

      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
      } else if (error) {
        throw error;
      }
    } catch (err) {
      if (err instanceof LiveBannedError) throw err;
      if (attempt === retries - 1) throw err;
      const info = await readFunctionErrorBody(err);
      if (info.status === 403 || info.status === 410) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
    }
  }

  throw new Error("livekit-token function returned an incomplete response");
}

// ↔ L1/L2: اسم الغرفة يُولَّد على الخادم (live_<uuid> عبر RPC create_live_room) فلا يحمل معرّف المضيف ولا الوقت ولا يمكن حجزه مسبقًا.
// يُرجع اسم الغرفة الذى يُستخدم لطلب التوكن. قبل تطبيق migration 20261114 (الدالة غير موجودة) نرجع للإدراج المباشر باسم عشوائى حتى لا يتعطل البث.
function randomUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message ?? ""));
}

export async function createLiveRoom(title: string): Promise<string> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Not signed in");

  const { data, error } = await supabase.rpc("create_live_room", { p_title: title });
  if (!error && typeof data === "string" && data) return data;

  if (error && !isMissingFunction(error)) {
    console.error("Error creating live room:", error);
    throw error;
  }

  // احتياطى لما قبل الـ migration: إدراج مباشر باسم عشوائى.
  const roomName = `live_${randomUuid()}`;
  const base = { room_name: roomName, host_id: userData.user.id, title, status: "live", recording_status: "none" };
  let { error: insErr } = await supabase.from("lives").insert({ ...base, rights_declared_at: new Date().toISOString() });
  if (insErr && (insErr.code === "PGRST204" || insErr.code === "42703" || /rights_declared_at/i.test(insErr.message))) {
    ({ error: insErr } = await supabase.from("lives").insert(base));
  }
  if (insErr) {
    console.error("Error creating live room in Supabase:", insErr);
    throw insErr;
  }
  return roomName;
}

// ↔ L3: الإنهاء عبر end_live_room (يتحقق من المضيف على الخادم). احتياطى لما قبل الـ migration: تحديث مباشر (مسموح status/ended_at للمضيف).
export async function endLiveRoom(roomName: string): Promise<void> {
  const { error } = await supabase.rpc("end_live_room", { p_room_name: roomName });
  if (error && isMissingFunction(error)) {
    await supabase.from("lives").update({ status: "ended", ended_at: new Date().toISOString() }).eq("room_name", roomName);
    return;
  }
  if (error) console.warn("[endLiveRoom]", error);
}

// ↔ يبدأ تسجيل Egress. L3: الخادم (livekit-recording + livekit-webhook) هو الوحيد الذى يكتب egress_id/recording_status/مسار الملف؛
// العميل لا يكتب شيئًا فى lives هنا (كانت كتاباته تفشل بصمت بعد تقييد الأعمدة). التحصين: لا نرمى أخطاء حتى لا ينهار التطبيق.
export async function startRecording(roomName: string): Promise<{ egressId: string } | null> {
  try {
    const { data, error } = await supabase.functions.invoke<{ egressId: string }>("livekit-recording", {
      body: { action: "start", roomName },
    });
    if (error || !data?.egressId) {
      console.warn("[startRecording] recording did not start:", error ?? "no egressId");
      return null;
    }
    return { egressId: data.egressId };
  } catch (err) {
    console.warn("[startRecording] Suppressed error to prevent app crash:", err);
    return null;
  }
}

// ↔ يوقف التسجيل. الخادم يستخدم egress_id المخزَّن عنده ويحسب المدة بنفسه (K1)؛ المعاملان egressId/durationSec محفوظان للتوافق فقط ولا يُرسلان.
export async function stopRecording(
  roomName: string,
  _egressId?: string,
  _durationSec?: number
): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("livekit-recording", {
      body: { action: "stop", roomName },
    });
    if (error) console.warn("Handled error stopping livekit recording:", error);
  } catch (err) {
    console.error("Error stopping livekit recording:", err);
  }
}

// ↔ send chat or like messages to the live room (محصنة)
// ↔ يرجّع نتيجة الخادم بدل ابتلاعها: reason = "blocked" (رقم هاتف/رابط… فى التعليق) | "banned" (محظور من البث) | "rate_limited".
export type LiveMessageResult = { relayed: boolean; reason?: "blocked" | "banned" | "rate_limited"; blocked?: string };
export async function sendLiveMessage(
  roomName: string,
  type: "comment" | "like",
  text?: string
): Promise<LiveMessageResult> {
  try {
    const { data, error } = await supabase.functions.invoke<LiveMessageResult>("livekit-send-message", {
      body: { roomName, type, text },
    });
    if (error) {
      console.warn("Failed to send live message:", error);
      return { relayed: false };
    }
    return data ?? { relayed: false };
  } catch (err) {
    console.warn("Suppressed sendLiveMessage error:", err);
    return { relayed: false };
  }
}

// ↔ kick participant (moderation) (محصنة)
// يرجّع true لو الطرد نجح (أو المشاهد غادر أصلًا)، وfalse لو فشل — كان الفشل يُبتلع فلا يعرف المضيف.
export async function kickParticipant(
  roomName: string,
  participantIdentity: string
): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke("livekit-moderate", {
      // الطرد = حظر لباقى هذا البث (الخادم يسجّله؛ بدونه كان المطرود يعود بتوكن جديد فورًا).
      body: { roomName, participantIdentity, ban: true },
    });
    if (error) {
      console.warn("Failed to kick participant:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Suppressed kickParticipant error:", err);
    return false;
  }
}