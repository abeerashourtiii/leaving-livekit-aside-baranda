import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";

// ↔ تقديم عرض (على إعلان/ريل أو على طلب) — migrations 20261016000000_property_offers.sql و20261017000000_offers_conversations.sql.
// العرض بيتسجّل (property_offers / request_offers) وبتتفتح معاه محادثة بين الطرفين بالرسالة الأولى (من الخادم)، وبترجع chat_id
// عشان نفتح المحادثة. الردود والمتابعة كلها من صفحة «العروض» (أيقونة جنب جرس الإشعارات) — راجع app/offers.tsx.
export type OfferError =
  | "not_authenticated" | "own_property" | "own_request" | "property_unavailable" | "request_unavailable"
  | "bad_message" | "bad_price" | "bad_whatsapp" | "rate_limited" | "unknown";

const KNOWN: OfferError[] = [
  "not_authenticated", "own_property", "own_request", "property_unavailable", "request_unavailable",
  "bad_message", "bad_price", "bad_whatsapp", "rate_limited",
];

export function offerErrorCode(err: unknown): OfferError {
  const msg = err instanceof Error ? err.message : "";
  return (KNOWN.find((k) => msg.includes(k)) ?? "unknown") as OfferError;
}

// whatsapp اختيارى: "" = من غير رقم (migration 20261018000000_offers_optional_whatsapp.sql).
type SubmitInput = { targetId: string; price: number | null; message: string; whatsapp: string };

export function useSubmitPropertyOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ targetId, price, message, whatsapp }: SubmitInput): Promise<{ chatId: string | null }> => {
      const { data, error } = await supabase.rpc("submit_property_offer", {
        p_property_id: targetId, p_price: price ?? undefined, p_message: message, p_whatsapp: whatsapp || undefined,
      });
      if (error) throw new Error(KNOWN.find((k) => error.message.includes(k)) ?? error.message);
      return { chatId: data?.chat_id ?? null };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["offers"] });
      void qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

export function useSubmitRequestOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ targetId, price, message, whatsapp }: SubmitInput): Promise<{ chatId: string | null }> => {
      const { data, error } = await supabase.rpc("submit_request_offer", {
        p_request_id: targetId, p_price: price ?? undefined, p_message: message, p_whatsapp: whatsapp || undefined,
      });
      if (error) throw new Error(KNOWN.find((k) => error.message.includes(k)) ?? error.message);
      return { chatId: data?.chat_id ?? null };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["offers"] });
      void qc.invalidateQueries({ queryKey: ["chats"] });
      void qc.invalidateQueries({ queryKey: ["requests"] });
    },
  });
}
