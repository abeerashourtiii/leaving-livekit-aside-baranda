import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { applyMessage, MessageRow } from "../chatCache";
import { invalidateSoon } from "../invalidateSoon";

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

type OfferRow = { id: string; chat_id: string | null; price: number | null; status: string; offerer_id: string };
const OFFERS_PAGE = 500;
const OFFERS_MAX_PAGES = 10;

async function fetchAllOffers(table: "property_offers" | "request_offers"): Promise<OfferRow[]> {
  const out: OfferRow[] = [];
  for (let page = 0; page < OFFERS_MAX_PAGES; page++) {
    const from = page * OFFERS_PAGE;
    const { data, error } = await supabase
      .from(table)
      .select("id, chat_id, price, status, offerer_id")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + OFFERS_PAGE - 1);
    if (error) {
      // الجدول غير موجود (migration لم تُطبَّق) = لا عروض من هذا النوع؛ أى خطأ آخر يُرمى.
      const code = (error as { code?: string }).code;
      if (code === "42P01" || code === "PGRST205") return out;
      throw error;
    }
    const rows = (data ?? []) as OfferRow[];
    out.push(...rows);
    if (rows.length < OFFERS_PAGE) break;
  }
  return out;
}

export function useOffersMeta(userId: string | undefined) {
  return useQuery({
    queryKey: ["offers", "meta", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Map<string, OfferMeta>> => {
      const map = new Map<string, OfferMeta>();
      // ↔ كان limit(500) بلا ترتيب (فى حالة تجاوز 500 عرض كانت تُسقَط عروض عشوائية)، وأى خطأ كان يُبتلع فتظهر القائمة بلا حالات.
      //   الآن: ترتيب ثابت (الأحدث أولًا ثم id) مع جلب صفحات متتالية حتى آخر عرض (سقف أمان 10 صفحات)، وخطأ حقيقى يُرمى.
      const [reels, requests] = await Promise.all([fetchAllOffers("property_offers"), fetchAllOffers("request_offers")]);
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
      add(reels, "reel");
      add(requests, "request");
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
      // ↔ كان الخطأ يرجّع 0 فيُخفى النقطة الحمراء ويمسح العدّاد الصحيح من الكاش. الآن الخطأ يُرمى فيبقى آخر عدّاد معروف ويُعاد
      //   الجلب تلقائيًا (React Query يحتفظ بالبيانات القديمة عند فشل التحديث).
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 10_000,
    // ↔ الجلب الدورى (كل 60 ثانية) كان شغّال دايمًا حتى والـ Realtime متّصل. دلوقتى هو احتياطى بس: بيشتغل فقط لو قناة الـ
    //   Realtime مش متّصلة (انقطعت أو لسه ما اشتغلتش)، وبيقف فى الخلفية (lib/queryClient.ts). وبنجدّد العدّاد عند الرجوع للتطبيق
    //   (لو اتقرأت رسائل من جهاز تانى مثلًا، لأن Realtime هنا بيسمع إدراج الرسائل فقط).
    refetchInterval: () => (offersRealtimeUp ? false : 60_000),
    refetchOnWindowFocus: true,
  });
}

// حالة اتصال قناة العروض (مشتركة بين useOffersRealtimeSync وuseOffersUnreadCount).
let offersRealtimeUp = false;

export function useOffersRealtimeSync(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    // قناة بإسم فريد لكل mount (نفس سبب useNotifications/useChatMessages).
    const name = `offers-sync:${userId}:${Math.random().toString(36).slice(2)}`;
    let everDropped = false;
    const channel = supabase
      .channel(name)
      // ↔ رسالة جديدة: تحديث صف المحادثة وعدّاد غير المقروء فى الكاش فقط (lib/chatCache.ts) بدل إعادة جلب العروض وقائمة المحادثات
      //   (كل رسالة واردة كانت تطلق نحو 6 طلبات). الـ payload ناقص → إعادة جلب واحدة مجمّعة.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const row = payload.new as MessageRow | undefined;
        if (row?.id && row.chat_id) applyMessage(qc, userId, row);
        else {
          invalidateSoon(qc, ["offers", "unread", userId]);
          invalidateSoon(qc, ["chats", userId]);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "property_offers" }, () => {
        void qc.invalidateQueries({ queryKey: ["offers"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "request_offers" }, () => {
        void qc.invalidateQueries({ queryKey: ["offers"] });
      })
      .subscribe((status) => {
        const up = status === "SUBSCRIBED";
        // رجوع الاتصال بعد انقطاع: نجدّد مرة واحدة عشان نلحق أى حدث فات أثناء الانقطاع.
        if (up && everDropped) void qc.invalidateQueries({ queryKey: ["offers"] });
        if (!up && status !== "CLOSED") everDropped = true;
        // انقطع الاتصال: نطلق جلبة واحدة فيُعاد حساب refetchInterval ويبدأ الجلب الاحتياطى (المؤقّت ما بيتحدّث من نفسه).
        if (!up && offersRealtimeUp && status !== "CLOSED") void qc.invalidateQueries({ queryKey: ["offers", "unread"] });
        offersRealtimeUp = up;
      });
    return () => { offersRealtimeUp = false; supabase.removeChannel(channel); };
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
