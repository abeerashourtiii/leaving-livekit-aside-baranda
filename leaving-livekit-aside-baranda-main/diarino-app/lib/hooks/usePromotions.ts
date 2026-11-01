import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";

// ↔ «اجعل الإعلان افتتاحي / مميز» — ترويج مدفوع 7 أيام (migration 20261023000000_ad_promotions_and_payment_methods.sql).
//   • مميز (featured → placement in_feed): يظهر أثناء التصفح وفى صفحة البحث — 300 ج.م.
//   • افتتاحي (intro): أول ريل عند فتح الصفحة الرئيسية — 1000 ج.م لهدف 3000 مشاهدة، 2000 ج.م لهدف 5000 مشاهدة.
//   • الفئة العمرية المستهدفة (من تاريخ الميلاد المسجَّل فى الحساب)، والمدة 7 أيام (من تفعيل الإدارة بعد مراجعة السداد).
// الأسعار والمدة فى promo_settings (تُعدَّل من لوحة الأدمن)، والقيم هنا افتراضية لو الجدول لسه ما اتطبقش.

export type PromoKind = "featured" | "intro";
export type PromoStatus = "pending_payment" | "submitted" | "active" | "rejected" | "cancelled" | "expired";

export type PromoSettings = {
  featuredPriceEgp: number;
  intro3000PriceEgp: number;
  intro5000PriceEgp: number;
  durationDays: number;
  // ↔ المساحة الإعلانية (بانر القائمة/البحث): 7 / 14 / 30 يومًا.
  banner7PriceEgp: number;
  banner14PriceEgp: number;
  banner30PriceEgp: number;
};

export const DEFAULT_PROMO_SETTINGS: PromoSettings = {
  featuredPriceEgp: 300,
  intro3000PriceEgp: 1000,
  intro5000PriceEgp: 2000,
  durationDays: 7,
  banner7PriceEgp: 1500,
  banner14PriceEgp: 2500,
  banner30PriceEgp: 4000,
};

export const INTRO_REACH_GOALS = [3000, 5000] as const;

export type AgeGroup = { key: string; label: string; min: number | null; max: number | null };
export const AGE_GROUPS: AgeGroup[] = [
  { key: "all", label: "كل الأعمار", min: null, max: null },
  { key: "18-24", label: "١٨ – ٢٤ سنة", min: 18, max: 24 },
  { key: "25-34", label: "٢٥ – ٣٤ سنة", min: 25, max: 34 },
  { key: "35-44", label: "٣٥ – ٤٤ سنة", min: 35, max: 44 },
  { key: "45-54", label: "٤٥ – ٥٤ سنة", min: 45, max: 54 },
  { key: "55+", label: "٥٥ سنة فأكثر", min: 55, max: null },
];

export function ageGroupLabel(min: number | null, max: number | null): string {
  const g = AGE_GROUPS.find((x) => x.min === min && x.max === max);
  if (g) return g.label;
  if (min == null) return AGE_GROUPS[0].label;
  return max == null ? `${min}+` : `${min} – ${max}`;
}

export function promoPrice(settings: PromoSettings, kind: PromoKind, reachGoal: number | null): number {
  if (kind === "featured") return settings.featuredPriceEgp;
  return reachGoal === 5000 ? settings.intro5000PriceEgp : settings.intro3000PriceEgp;
}

export const PROMO_KIND_LABELS: Record<PromoKind, string> = {
  featured: "إعلان مميز (أثناء التصفح وفي البحث)",
  intro: "إعلان افتتاحي (الصفحة الرئيسية)",
};

export const PROMO_STATUS_LABELS: Record<PromoStatus, string> = {
  pending_payment: "بانتظار السداد",
  submitted: "تم إرسال تأكيد السداد وقيد المراجعة",
  active: "مفعّل",
  rejected: "مرفوض",
  cancelled: "ملغى",
  expired: "انتهى",
};

export function isPromoStatus(v: unknown): v is PromoStatus {
  return v === "pending_payment" || v === "submitted" || v === "active" || v === "rejected" || v === "cancelled" || v === "expired";
}

export type Promotion = {
  id: string;
  propertyId: string | null;
  propertyTitle: string;
  kind: PromoKind;
  reachGoal: number | null;
  ageMin: number | null;
  ageMax: number | null;
  durationDays: number;
  priceEgp: number;
  status: PromoStatus; // الحالة الفعلية (المفعّل المنتهى بيظهر expired)
  paymentMethod: string | null;
  paymentSenderName: string | null;
  paymentContactPhone: string | null;
  adminNote: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  currentReach: number;
};

type PromoRow = {
  id: string; property_id: string | null; property_title: string; kind: string; reach_goal: number | null;
  age_min: number | null; age_max: number | null; duration_days: number; price_egp: number; status: string;
  payment_method: string | null; payment_sender_name: string | null; payment_contact_phone: string | null;
  admin_note: string | null; starts_at: string | null; ends_at: string | null; created_at: string;
  sponsored_reel_id?: string | null;
};

function effectiveStatus(status: string, endsAt: string | null): PromoStatus {
  const st: PromoStatus = isPromoStatus(status) ? status : "pending_payment";
  if (st === "active" && endsAt && new Date(endsAt).getTime() < Date.now()) return "expired";
  return st;
}

function rowToPromotion(r: PromoRow, reach = 0): Promotion {
  return {
    id: r.id,
    propertyId: r.property_id,
    propertyTitle: r.property_title,
    kind: r.kind === "intro" ? "intro" : "featured",
    reachGoal: r.reach_goal,
    ageMin: r.age_min,
    ageMax: r.age_max,
    durationDays: r.duration_days,
    priceEgp: Number(r.price_egp),
    status: effectiveStatus(r.status, r.ends_at),
    paymentMethod: r.payment_method,
    paymentSenderName: r.payment_sender_name,
    paymentContactPhone: r.payment_contact_phone,
    adminNote: r.admin_note,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    createdAt: r.created_at,
    currentReach: reach,
  };
}

export function usePromoSettings() {
  const q = useQuery({
    queryKey: ["promoSettings"],
    queryFn: async (): Promise<PromoSettings> => {
      const { data, error } = await supabase.from("promo_settings").select("*").eq("id", true).maybeSingle();
      if (error || !data) return DEFAULT_PROMO_SETTINGS;
      return {
        featuredPriceEgp: Number(data.featured_price_egp),
        intro3000PriceEgp: Number(data.intro_price_3000_egp),
        intro5000PriceEgp: Number(data.intro_price_5000_egp),
        durationDays: data.duration_days,
        banner7PriceEgp: data.banner_price_7_egp != null ? Number(data.banner_price_7_egp) : DEFAULT_PROMO_SETTINGS.banner7PriceEgp,
        banner14PriceEgp: data.banner_price_14_egp != null ? Number(data.banner_price_14_egp) : DEFAULT_PROMO_SETTINGS.banner14PriceEgp,
        banner30PriceEgp: data.banner_price_30_egp != null ? Number(data.banner_price_30_egp) : DEFAULT_PROMO_SETTINGS.banner30PriceEgp,
      };
    },
    staleTime: 5 * 60_000,
  });
  return { settings: q.data ?? DEFAULT_PROMO_SETTINGS, isLoading: q.isLoading };
}

export function useUpdatePromoSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PromoSettings) => {
      const { error } = await supabase
        .from("promo_settings")
        .update({
          featured_price_egp: input.featuredPriceEgp,
          intro_price_3000_egp: input.intro3000PriceEgp,
          intro_price_5000_egp: input.intro5000PriceEgp,
          duration_days: input.durationDays,
          banner_price_7_egp: input.banner7PriceEgp,
          banner_price_14_egp: input.banner14PriceEgp,
          banner_price_30_egp: input.banner30PriceEgp,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promoSettings"] }),
  });
}

// طلبات الترويج الخاصة بالمعلن (الأحدث أولًا). لو الجدول لسه ما اتطبقش بنرجّع قائمة فاضية بدل ما الشاشة تفشل.
export function useMyPromotions(userId: string | undefined) {
  return useQuery({
    queryKey: ["promotions", "mine", userId],
    queryFn: async (): Promise<Promotion[]> => {
      const { data, error } = await supabase
        .from("ad_promotions")
        .select("*")
        .eq("payer_id", userId!)
        .order("created_at", { ascending: false });
      if (error) {
        console.warn("my promotions unavailable:", error.message);
        return [];
      }
      const rows = (data ?? []) as PromoRow[];
      const reelIds = rows.map((r) => r.sponsored_reel_id).filter((x): x is string => !!x);
      const reach = new Map<string, number>();
      if (reelIds.length) {
        const { data: reels } = await supabase.from("sponsored_reels").select("id, current_reach").in("id", reelIds);
        for (const r of (reels ?? []) as { id: string; current_reach: number }[]) reach.set(r.id, r.current_reach);
      }
      return rows.map((r) => rowToPromotion(r, r.sponsored_reel_id ? reach.get(r.sponsored_reel_id) ?? 0 : 0));
    },
    enabled: !!userId,
    staleTime: 15_000,
  });
}

export function useCreatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { propertyId: string; kind: PromoKind; reachGoal: number | null; ageMin: number | null; ageMax: number | null }) => {
      const { data, error } = await supabase.rpc("create_ad_promotion", {
        p_property_id: input.propertyId,
        p_kind: input.kind,
        p_reach_goal: input.reachGoal ?? undefined,
        p_age_min: input.ageMin ?? undefined,
        p_age_max: input.ageMax ?? undefined,
      });
      if (error) {
        for (const code of ["already_promoted", "ad_not_promotable", "bad_reach_goal", "bad_age", "bad_kind"]) {
          if (error.message.includes(code)) throw new Error(code);
        }
        if (/not_owner|not_authenticated/i.test(error.message)) throw new Error("not_owner");
        throw error;
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promotions"] }),
  });
}

export function useConfirmPromotionPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; method: string; senderName: string; contactPhone: string }) => {
      const { data, error } = await supabase.rpc("confirm_promotion_payment", {
        p_id: input.id,
        p_method: input.method,
        p_sender_name: input.senderName.trim(),
        p_contact_phone: input.contactPhone.trim(),
      });
      if (error) {
        for (const code of ["order_closed", "bad_method", "bad_sender_name", "bad_contact_phone"]) {
          if (error.message.includes(code)) throw new Error(code);
        }
        if (/not_owner|not_authenticated/i.test(error.message)) throw new Error("not_owner");
        throw error;
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promotions"] }),
  });
}

export function useCancelPromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("cancel_ad_promotion", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promotions"] }),
  });
}

// ───────── لوحة الأدمن ─────────
export type AdminPromotion = Promotion & {
  payerId: string | null;
  payerName: string | null;
  payerPhone: string | null;
  payerEmail: string | null;
  paymentSubmittedAt: string | null;
  paymentRef: string | null;
};

export function useAdminPromotions(enabled: boolean) {
  return useQuery({
    queryKey: ["promotions", "admin"],
    queryFn: async (): Promise<AdminPromotion[]> => {
      const { data, error } = await supabase.rpc("admin_list_promotions");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...rowToPromotion(r as unknown as PromoRow, r.current_reach ?? 0),
        payerId: r.payer_id,
        payerName: r.payer_name,
        payerPhone: r.payer_phone,
        payerEmail: r.payer_email,
        paymentSubmittedAt: r.payment_submitted_at,
        paymentRef: r.payment_ref,
      }));
    },
    enabled,
    staleTime: 10_000,
  });
}

export function useAdminUpdatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: "pending_payment" | "submitted" | "active" | "rejected" | "cancelled"; paymentRef?: string; adminNote?: string }) => {
      const { error } = await supabase.rpc("admin_update_promotion", {
        p_id: input.id,
        p_status: input.status,
        p_payment_ref: input.paymentRef,
        p_admin_note: input.adminNote,
      });
      if (error) {
        if (error.message.includes("property_unavailable")) throw new Error("property_unavailable");
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["promotions"] });
      qc.invalidateQueries({ queryKey: ["sponsoredReels"] });
    },
  });
}

// ↔ أهم طلب ترويج «حى» لإعلان معيّن (مفعّل ثم بانتظار المراجعة ثم بانتظار السداد) — لعرض حالته على كارت الإعلان.
const LIVE_ORDER: PromoStatus[] = ["active", "submitted", "pending_payment"];
export function livePromotionsFor(list: Promotion[] | undefined, propertyId: string): Promotion[] {
  return (list ?? [])
    .filter((p) => p.propertyId === propertyId && LIVE_ORDER.includes(p.status))
    .sort((a, b) => LIVE_ORDER.indexOf(a.status) - LIVE_ORDER.indexOf(b.status));
}
