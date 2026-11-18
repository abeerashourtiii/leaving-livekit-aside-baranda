import { getCurrentLanguage } from "./hooks/useLanguage";
import type { QueryClient } from "@tanstack/react-query";
import type { ChatMessage } from "../data/mock-chats";
import type { ChatSummary } from "./hooks/useChatsDB";
import { invalidateSoon } from "./invalidateSoon";

// ↔ تحديث كاش الشات «فى مكانه» بدل إعادة جلب قائمة المحادثات مع كل رسالة. كل رسالة (واردة أو مُرسلة) بتعدّل صف المحادثة نفسه
//   (آخر رسالة/وقتها/غير المقروء) وتُضاف لقائمة رسائل المحادثة المفتوحة — بدون أى طلب شبكة إضافى.
export type MessageRow = {
  id: string; chat_id: string; sender_id: string; text: string; images: string[] | null;
  whatsapp: string | null; read: boolean; created_at: string;
};

let openChatId: string | null = null;
/** المحادثة المفتوحة حاليًا (لا نزيد غير المقروء لرسائلها لأن المستخدم يقرؤها فعلًا). */
export function setOpenChat(id: string | null) { openChatId = id; }

const seen = new Set<string>();
function firstTime(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 300) { const oldest = seen.values().next().value; if (oldest !== undefined) seen.delete(oldest); }
  return true;
}

export function toChatMessage(m: MessageRow, currentUserId: string | undefined): ChatMessage & { id: string } {
  return {
    id: m.id,
    from: m.sender_id === currentUserId ? "me" : "them",
    text: m.text,
    time: new Date(m.created_at).toLocaleTimeString(getCurrentLanguage() === "en" ? "en-US" : "ar-EG", { hour: "2-digit", minute: "2-digit" }), // ↔ M4: يتبع لغة الواجهة
    images: m.images && m.images.length ? m.images : undefined,
    whatsapp: m.whatsapp || undefined,
  };
}

/** يضيف الرسالة لقائمة رسائل المحادثة لو كانت محمّلة (بدون تكرار بالـ id). */
export function appendToMessages(qc: QueryClient, userId: string | undefined, row: MessageRow) {
  qc.setQueryData<(ChatMessage & { id?: string })[] | undefined>(["chat_messages", row.chat_id], (old) => {
    if (!old) return old; // لسه ما اتحمّلتش: هتتحمّل كاملة عند فتح المحادثة
    if (old.some((m) => m.id === row.id)) return old;
    return [...old, toChatMessage(row, userId)];
  });
}

/**
 * رسالة جديدة (من Realtime أو من إرسالى أنا): تحديث صف المحادثة فى القائمة + عدّاد «العروض» غير المقروء.
 * آمنة للتكرار (نفس الرسالة تصل من أكتر من قناة): تُطبَّق مرة واحدة بالـ id.
 */
export function applyMessage(qc: QueryClient, userId: string | undefined, row: MessageRow) {
  if (!userId || !row?.id || !firstTime(row.id)) return;
  const mine = row.sender_id === userId;
  const chatOpen = openChatId === row.chat_id;
  let known = false;
  qc.setQueryData<ChatSummary[] | undefined>(["chats", userId], (old) => {
    if (!old) return old;
    const idx = old.findIndex((c) => c.id === row.chat_id);
    if (idx === -1) return old;
    known = true;
    const cur = old[idx];
    const next: ChatSummary = {
      ...cur,
      lastMessage: row.text,
      lastMessageAt: row.created_at,
      lastMessageFromMe: mine,
      unread: mine || chatOpen ? cur.unread : cur.unread + 1,
    };
    const list = [...old];
    list[idx] = next;
    return list.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  });
  // محادثة جديدة لسه مش فى القائمة (أول رسالة): نجيب القائمة مرة واحدة (مجمّعة).
  if (!known && qc.getQueryData(["chats", userId]) !== undefined) invalidateSoon(qc, ["chats", userId]);
  if (!mine && !chatOpen) {
    qc.setQueryData<number | undefined>(["offers", "unread", userId], (n) => (typeof n === "number" ? n + 1 : n));
  }
}
