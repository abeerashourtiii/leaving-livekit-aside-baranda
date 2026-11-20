import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { ChatMessage } from "../../data/mock-chats";
import { appendToMessages, applyMessage, toChatMessage, MessageRow as RealtimeMessageRow } from "../chatCache";
import { invalidateSoon } from "../invalidateSoon";

// ↔ replaces data/mock-chats.ts + lib/hooks/useChats.ts's local
// useSyncExternalStore store. Real persistence + Realtime instead of an
// in-memory array that reset on every app relaunch.

type ProfileRow = { id: string; full_name: string | null };
type ChatRow = {
  id: string; property_id: string | null; request_id: string | null;
  initiator_id: string; partner_id: string; created_at: string;
  initiator: ProfileRow | null; partner: ProfileRow | null;
  // ↔ سياق المحادثة (عنوان الإعلان/الطلب) — بيرجع null لو الإعلان اتخفى/اتقفل أو اتحذف.
  property: { short_title: string | null; title: string | null; price: number | null; purpose: string | null } | null;
  request: { type: string | null; location: string | null; purpose: string | null } | null;
};
type MessageRow = {
  id: string; chat_id: string; sender_id: string; text: string; images: string[] | null;
  whatsapp: string | null; read: boolean; created_at: string;
};

export type ChatSummary = {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerInitial: string;
  propertyId: string | null;
  requestId: string | null;
  lastMessage: string;
  unread: number;
  // ↔ وقت آخر نشاط (آخر رسالة أو إنشاء المحادثة): صفحة «العروض» بترتّب بيه — المحادثة الأحدث فى الأعلى.
  lastMessageAt: string;
  lastMessageFromMe: boolean;
  propertyTitle: string | null;
  requestTitle: string | null;
};

type SummaryRow = { chat_id: string; last_text: string | null; last_sender_id: string | null; last_at: string | null; unread_count: number | string | null };

// ↔ إصلاح الأداء: كان بينزّل *كل رسائل كل المحادثات* عند كل تحديث (ومحدود ضمنيًا بـ 1000 صف فتتخرّب الأرقام). دلوقتى دالة RPC
//   (chat_list_summary — migration 20261106000000) بترجّع آخر رسالة وعدد غير المقروء فقط لكل محادثة. لو الـ migration لسه ما اتطبّقتش
//   (الدالة غير موجودة) نرجع للطريقة القديمة تلقائيًا حتى لا تتعطّل الشاشة.
let summaryRpcMissing = false;

async function fetchSummaries(chatIds: string[], userId: string): Promise<Map<string, { text: string; at: string | null; fromMe: boolean; unread: number }>> {
  const out = new Map<string, { text: string; at: string | null; fromMe: boolean; unread: number }>();
  if (!summaryRpcMissing) {
    const { data, error } = await supabase.rpc("chat_list_summary");
    if (!error) {
      for (const r of (data ?? []) as SummaryRow[]) {
        out.set(r.chat_id, { text: r.last_text ?? "", at: r.last_at, fromMe: !!r.last_sender_id && r.last_sender_id === userId, unread: Number(r.unread_count ?? 0) });
      }
      return out;
    }
    // 42883 / PGRST202 = الدالة غير موجودة (الـ migration لم تُطبَّق) — أى خطأ آخر (شبكة…) نرميه ليعيد React Query المحاولة.
    const code = (error as { code?: string }).code;
    if (code === "42883" || code === "PGRST202" || /chat_list_summary/.test(error.message ?? "")) {
      summaryRpcMissing = true;
      console.warn("chat_list_summary RPC not found; falling back to client-side summary (apply migration 20261106000000).");
    } else {
      throw error;
    }
  }
  // الطريقة القديمة (احتياطى).
  const { data: messages } = await supabase
    .from("chat_messages")
    .select("chat_id, text, sender_id, read, created_at")
    .in("chat_id", chatIds)
    .order("created_at", { ascending: true });
  for (const id of chatIds) {
    const chatMessages = (messages || []).filter((m) => m.chat_id === id);
    const last = chatMessages[chatMessages.length - 1];
    out.set(id, {
      text: last?.text || "",
      at: last?.created_at ?? null,
      fromMe: !!last && last.sender_id === userId,
      unread: chatMessages.filter((m) => !m.read && m.sender_id !== userId).length,
    });
  }
  return out;
}

async function fetchChatList(userId: string): Promise<ChatSummary[]> {
  const { data: chats, error } = await supabase
    .from("chats")
    .select("*, initiator:profiles!chats_initiator_profile_fkey(id,full_name), partner:profiles!chats_partner_profile_fkey(id,full_name), property:properties!chats_property_id_fkey(short_title,title,price,purpose), request:requests!chats_request_id_fkey(type,location,purpose)")
    .or(`initiator_id.eq.${userId},partner_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = (chats || []) as unknown as ChatRow[];
  if (rows.length === 0) return [];

  const summaries = await fetchSummaries(rows.map((r) => r.id), userId);

  return rows.map((r) => {
    const isInitiator = r.initiator_id === userId;
    const partnerProfile = isInitiator ? r.partner : r.initiator;
    const sm = summaries.get(r.id);
    const partnerName = partnerProfile?.full_name || "مستخدم Shahir";

    return {
      id: r.id,
      partnerId: isInitiator ? r.partner_id : r.initiator_id,
      partnerName,
      partnerInitial: partnerName.charAt(0),
      propertyId: r.property_id,
      requestId: r.request_id,
      lastMessage: sm?.text || "",
      unread: sm?.unread ?? 0,
      lastMessageAt: sm?.at ?? r.created_at,
      lastMessageFromMe: sm?.fromMe ?? false,
      propertyTitle: r.property ? (r.property.short_title || r.property.title || null) : null,
      requestTitle: r.request ? [r.request.type, r.request.location].filter(Boolean).join(" - ") || null : null,
    };
  })
    // المحادثة الأحدث (آخر رسالة) فى الأعلى.
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
}

export function useChatList(userId: string | undefined) {
  return useQuery({
    queryKey: ["chats", userId],
    queryFn: () => fetchChatList(userId!),
    enabled: !!userId,
    staleTime: 5_000,
  });
}

// Returns messages tagged from/them relative to the current user, plus a
// live subscription so new messages (sent by either side) show up without
// a manual refetch.
export function useChatMessages(chatId: string | undefined, currentUserId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["chat_messages", chatId],
    queryFn: async () => {
      const { data, error } = await supabase.from("chat_messages")
        .select("id, chat_id, sender_id, text, images, whatsapp, read, created_at")
        .eq("chat_id", chatId!).order("created_at", { ascending: true });
      if (error) throw error;
      return (data as MessageRow[]).map((m) => toChatMessage(m, currentUserId)) as (ChatMessage & { id: string })[];
    },
    enabled: !!chatId && !!currentUserId,
  });

  useEffect(() => {
    if (!chatId) return;
    // ↔ same fix as useNotifications.ts: a unique topic per effect run
    // avoids reusing a channel that a previous mount's removeChannel()
    // hasn't finished tearing down yet, which otherwise throws "cannot
    // add postgres_changes callbacks ... after subscribe()" on React's
    // dev/StrictMode double-mount or any fast remount.
    const channelName = `chat:${chatId}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      // ↔ بدل إعادة جلب الرسائل + قائمة المحادثات مع كل رسالة واردة: نضيف الرسالة نفسها فى الكاش ونحدّث صف المحادثة (lib/chatCache.ts).
      //   لو الكاش مش جاهز (أو الـ payload ناقص) نرجع لإعادة جلب واحدة مجمّعة.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `chat_id=eq.${chatId}` }, (payload) => {
        const row = payload.new as RealtimeMessageRow | undefined;
        if (row?.id && row.chat_id === chatId) {
          appendToMessages(qc, currentUserId, row);
          applyMessage(qc, currentUserId, row);
        } else {
          invalidateSoon(qc, ["chat_messages", chatId]);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chatId, currentUserId, qc]);

  return query;
}

// ↔ بعد 23505 المحادثة التى أنشأها الطلب الأول موجودة (أو على وشك الظهور): نقرأها، مع محاولتين إضافيتين قصيرتين لو لم تظهر بعد.
async function findChatAfterConflict(read: () => PromiseLike<{ data: { id: string } | null; error: unknown }>): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await read();
    if (data) return data.id;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

// ↔ openOrCreateChat() — finds an existing chat for this property (by the
// current user as initiator), or creates one.
// ↔ إصلاح الضغط المزدوج: ضغطتان سريعتان تبدآن «ابحث ثم أدرج» معًا؛ الإدراج الثانى كان يفشل بخطأ 23505 (الفهرس الفريد
//   chats_initiator_property_uidx) غير المعالَج. الآن: عند 23505 نقرأ المحادثة التى أنشأها الطلب الأول ونرجّع معرّفها.
export async function openOrCreateChat(currentUserId: string, sellerId: string, propertyId: string): Promise<string> {
  const { data: existing } = await supabase
    .from("chats").select("id").eq("initiator_id", currentUserId).eq("property_id", propertyId).maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("chats")
    .insert({ initiator_id: currentUserId, partner_id: sellerId, property_id: propertyId })
    .select("id").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const again = await findChatAfterConflict(() =>
        supabase.from("chats").select("id").eq("initiator_id", currentUserId).eq("property_id", propertyId).maybeSingle());
      if (again) return again;
    }
    throw error;
  }
  return data.id;
}

// ↔ getOrCreateRequestChat() / submitOffer()'s inline chat creation.
export async function openOrCreateRequestChat(currentUserId: string, requesterId: string, requestId: string): Promise<string> {
  const { data: existing } = await supabase
    .from("chats").select("id").eq("initiator_id", currentUserId).eq("request_id", requestId).maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("chats")
    .insert({ initiator_id: currentUserId, partner_id: requesterId, request_id: requestId })
    .select("id").single();
  if (error) {
    // نفس معالجة الضغط المزدوج (الفهرس الفريد chats_initiator_request_uidx).
    if ((error as { code?: string }).code === "23505") {
      const again = await findChatAfterConflict(() =>
        supabase.from("chats").select("id").eq("initiator_id", currentUserId).eq("request_id", requestId).maybeSingle());
      if (again) return again;
    }
    throw error;
  }
  return data.id;
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ chatId, senderId, text, images, whatsapp }: { chatId: string; senderId: string; text: string; images?: string[]; whatsapp?: string }) => {
      const { data, error } = await supabase.from("chat_messages").insert({
        chat_id: chatId, sender_id: senderId, text, images: images || [], whatsapp: whatsapp || null,
      }).select("id, chat_id, sender_id, text, images, whatsapp, read, created_at").single();
      if (error) throw error;
      return data as RealtimeMessageRow;
    },
    onSuccess: (row, vars) => {
      // ↔ نضيف رسالتى المُرسلة فى الكاش مباشرة (بدل إعادة جلب الرسائل وقائمة المحادثات)؛ وصدى Realtime لنفس الرسالة بيتجاهل بالـ id.
      if (row?.id) {
        appendToMessages(qc, vars.senderId, row);
        applyMessage(qc, vars.senderId, row);
      } else {
        invalidateSoon(qc, ["chat_messages", vars.chatId]);
        invalidateSoon(qc, ["chats", vars.senderId]);
      }
    },
  });
}

export function useMarkChatRead() {
  const qc = useQueryClient();
  return useMutation({
    // ↔ RLS audit fix — was a direct .update({read:true}), which the old
    // policy's `with check (true)` let widen into rewriting any column of
    // any message in the chat. mark_chat_messages_read (20260822000000_
    // rls_audit_fixes.sql) can only ever do the one thing this needs.
    mutationFn: async ({ chatId, currentUserId }: { chatId: string; currentUserId: string }) => {
      const { error } = await supabase.rpc("mark_chat_messages_read", { p_chat_id: chatId });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      // ↔ بدل إعادة جلب قائمة المحادثات: نصفّر غير المقروء لهذه المحادثة فى الكاش، ونخصم عددها من نقطة «العروض» (أو نجدّدها لو القائمة مش محمّلة).
      const box: { prev: number | null } = { prev: null };
      qc.setQueryData<ChatSummary[] | undefined>(["chats", vars.currentUserId], (old) => {
        if (!old) return old;
        const c = old.find((x) => x.id === vars.chatId);
        box.prev = c ? c.unread : 0;
        return c && c.unread !== 0 ? old.map((x) => (x.id === vars.chatId ? { ...x, unread: 0 } : x)) : old;
      });
      if (box.prev === null) {
        invalidateSoon(qc, ["offers", "unread"]);
      } else if (box.prev > 0) {
        const n = box.prev;
        qc.setQueryData<number | undefined>(["offers", "unread", vars.currentUserId], (old) => (typeof old === "number" ? Math.max(0, old - n) : old));
        invalidateSoon(qc, ["offers", "unread"], 1500); // تصحيح هادئ من الخادم
      }
    },
  });
}
