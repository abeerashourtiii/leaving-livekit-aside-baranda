import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";

// ↔ صفحة «العروض» (أيقونة جنب جرس الإشعارات): كل عرض = محادثة بين مقدّم العرض وصاحب الإعلان/الطلب.
//  • useOffersMeta        : بيانات كل عرض (النوع ريل/طلب، السعر، الحالة، دورى فيه) مفهرسة بـ chat_id.
//  • useOffersUnreadCount : عدد الرسائل غير المقروءة (RLS بتقصرها على محادثاتى) → النقطة الحمراء على أيقونة العروض.
//  • useOffersRealtimeSync: اشتراك Realtime واحد (بيتركّب فى app/(tabs)/_layout.tsx) بيحدّث النقطة والقائمة فورًا.
//  • useRespondToOffer    : قبول/اعتذار (الدالة على الخادم بتتحقق إنك الطرف المستلم، وبتبعت رسالة فى المحادثة).
// إشعارات رسائل العروض منفصلة عن جرس الإشعارات: الجرس بيخفى فئتى chat/offer (lib/hooks/useNotifications.ts).
export type OfferKind = "reel" | "request";
export type OfferStatus = "new" | "accepted" | "declined";

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  new: "بانتظار الرد",
  accepted: "تم قبول العرض",
  declined: "تم الاعتذار عن العرض",
};

export type OfferMeta = {
  offerId: string;
  chatId: string;
  kind: OfferKind;
  status: OfferStatus;
  price: number | null;
  // هل أنا مقدّم العرض (offerer) أم المستلم (recipient: صاحب الإعلان / صاحب الطلب)؟
  role: "offerer" | "recipient";
};

function asStatus(v: string): OfferStatus {
  return v === "accepted" || v === "declined" ? v : "new";
}

export function useOffersMeta(userId: string | undefined) {
  return useQuery({
    queryKey: ["offers", "meta", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Map<string, OfferMeta>> => {
      const map = new Map<string, OfferMeta>();
      const [reels, requests] = await Promise.all([
        supabase.from("property_offers").select("id, chat_id, price, status, offerer_id").limit(500),
        supabase.from("request_offers").select("id, chat_id, price, status, offerer_id").limit(500),
      ]);
      const add = (rows: { id: string; chat_id: string | null; price: number | null; status: string; offerer_id: string }[] | null, kind: OfferKind) => {
        for (const r of rows ?? []) {
          if (!r.chat_id) continue;
          map.set(r.chat_id, {
            offerId: r.id,
            chatId: r.chat_id,
            kind,
            status: asStatus(r.status),
            price: r.price != null ? Number(r.price) : null,
            role: r.offerer_id === userId ? "offerer" : "recipient",
          });
        }
      };
      // RLS: كل جدول بيرجّع عروضى أنا بس (مقدّم أو مستلم).
      add(reels.data, "reel");
      add(requests.data, "request");
      return map;
    },
    staleTime: 15_000,
  });
}

export function useOffersUnreadCount(userId: string | undefined) {
  return useQuery({
    queryKey: ["offers", "unread", userId],
    enabled: !!userId,
    queryFn: async (): Promise<number> => {
      // RLS على chat_messages بتقصر الصفوف على محادثاتى؛ نستثنى رسائلى أنا.
      const { count, error } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("read", false)
        .neq("sender_id", userId!);
      if (error) return 0;
      return count ?? 0;
    },
    staleTime: 10_000,
    refetchInterval: 60_000, // احتياطى لو انقطع الـ Realtime
  });
}

export function useOffersRealtimeSync(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    // قناة بإسم فريد لكل mount (نفس سبب useNotifications/useChatMessages).
    const name = `offers-sync:${userId}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(name)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => {
        void qc.invalidateQueries({ queryKey: ["offers"] });
        void qc.invalidateQueries({ queryKey: ["chats", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "property_offers" }, () => {
        void qc.invalidateQueries({ queryKey: ["offers"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "request_offers" }, () => {
        void qc.invalidateQueries({ queryKey: ["offers"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, qc]);
}

export function useRespondToOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, offerId, status }: { kind: OfferKind; offerId: string; status: "accepted" | "declined" }) => {
      const { error } =
        kind === "reel"
          ? await supabase.rpc("respond_property_offer", { p_offer_id: offerId, p_status: status })
          : await supabase.rpc("respond_request_offer", { p_offer_id: offerId, p_status: status });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["offers"] });
      void qc.invalidateQueries({ queryKey: ["chats"] });
      void qc.invalidateQueries({ queryKey: ["chat_messages"] });
    },
  });
}

// ───────── لوحة الأدمن: العروض المقدَّمة (ريلز + طلبات) — صلاحية قسم «offers» ─────────
export type AdminOfferRow = {
  id: string;
  kind: OfferKind;
  targetTitle: string;
  askingPrice: number | null;
  offerPrice: number | null;
  status: OfferStatus;
  message: string;
  offererName: string | null;
  offererPhone: string | null;
  offererEmail: string | null;
  otherName: string | null;
  otherPhone: string | null;
  otherEmail: string | null;
  messagesCount: number;
  createdAt: string;
  updatedAt: string;
};

export function useAdminOffers() {
  return useQuery({
    queryKey: ["offers", "admin"],
    queryFn: async (): Promise<AdminOfferRow[]> => {
      const { data, error } = await supabase.rpc("admin_list_offers");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        kind: r.kind === "request" ? "request" : "reel",
        targetTitle: r.target_title,
        askingPrice: r.asking_price != null ? Number(r.asking_price) : null,
        offerPrice: r.offer_price != null ? Number(r.offer_price) : null,
        status: asStatus(r.status),
        message: r.message,
        offererName: r.offerer_name,
        offererPhone: r.offerer_phone,
        offererEmail: r.offerer_email,
        otherName: r.other_name,
        otherPhone: r.other_phone,
        otherEmail: r.other_email,
        messagesCount: Number(r.messages_count),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },
    staleTime: 10_000,
  });
}
