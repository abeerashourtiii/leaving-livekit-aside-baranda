import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";

// ↔ الحد الأقصى لريلزات المعلن + الباقات الشهرية (migration 20261121000300_reel_limit_plans.sql).
//   • 20 ريل مجانًا. باقة 1: +30 (إجمالى 50) بـ 300 ج.م/شهر. باقة 2: +100 (إجمالى 120) بـ 800 ج.م/شهر — الأرقام الفعلية فى reel_plan_settings (المشرف الرئيسى).
//   • الدفع: فودافون كاش / اتصالات كاش / إنستاباي (نفس PaymentSection والفاتورة الخاصة بالترويج) ← مراجعة الأدمن ← تفعيل لشهر.
//   • بعد انتهاء الشهر: فترة سماح 30 يومًا تبقى فيها المساحة الإضافية، ثم يعود الحد 20 ويُمنع نشر ريل جديد لحين التجديد/الحذف (لا يُحذف شيء).
// القيم هنا افتراضية لو الجدول لم يُطبَّق بعد.

export type ReelPlanKey = "plan1" | "plan2";
export type ReelPlanStatus = "pending_payment" | "submitted" | "active" | "rejected" | "cancelled" | "expired";

export type ReelPlanSettings = {
  freeLimit: number;
  plan1Extra: number;
  plan1PriceEgp: number;
  plan2Extra: number;
  plan2PriceEgp: number;
  periodDays: number;
  graceDays: number;
};

export const DEFAULT_REEL_PLAN_SETTINGS: ReelPlanSettings = {
  freeLimit: 20, plan1Extra: 30, plan1PriceEgp: 300, plan2Extra: 100, plan2PriceEgp: 800, periodDays: 30, graceDays: 30,
};

export const REEL_PLAN_STATUS_LABELS: Record<ReelPlanStatus, string> = {
  pending_payment: "بانتظار السداد",
  submitted: "تم إرسال تأكيد السداد وقيد المراجعة",
  active: "مفعّلة",
  rejected: "مرفوضة",
  cancelled: "ملغاة",
  expired: "منتهية",
};

export function isReelPlanStatus(v: unknown): v is ReelPlanStatus {
  return v === "pending_payment" || v === "submitted" || v === "active" || v === "rejected" || v === "cancelled" || v === "expired";
}

export function planExtra(s: ReelPlanSettings, plan: ReelPlanKey): number {
  return plan === "plan1" ? s.plan1Extra : s.plan2Extra;
}
export function planPrice(s: ReelPlanSettings, plan: ReelPlanKey): number {
  return plan === "plan1" ? s.plan1PriceEgp : s.plan2PriceEgp;
}

/** رسالة الخطأ القادمة من الخادم عند بلوغ الحد. */
export function isReelLimitError(err: unknown): boolean {
  const msg = String((err as { message?: string } | null)?.message ?? err ?? "");
  return msg.includes("reel_limit_reached");
}

export function useReelPlanSettings() {
  const q = useQuery({
    queryKey: ["reelPlanSettings"],
    queryFn: async (): Promise<ReelPlanSettings> => {
      const { data, error } = await supabase.from("reel_plan_settings").select("*").eq("id", true).maybeSingle();
      if (error || !data) return DEFAULT_REEL_PLAN_SETTINGS;
      return {
        freeLimit: Number(data.free_limit),
        plan1Extra: Number(data.plan1_extra),
        plan1PriceEgp: Number(data.plan1_price_egp),
        plan2Extra: Number(data.plan2_extra),
        plan2PriceEgp: Number(data.plan2_price_egp),
        periodDays: Number(data.period_days),
        graceDays: Number(data.grace_days),
      };
    },
    staleTime: 5 * 60_000,
  });
  return { settings: q.data ?? DEFAULT_REEL_PLAN_SETTINGS, isLoading: q.isLoading };
}

export function useUpdateReelPlanSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReelPlanSettings) => {
      const { error } = await supabase
        .from("reel_plan_settings")
        .update({
          free_limit: input.freeLimit,
          plan1_extra: input.plan1Extra,
          plan1_price_egp: input.plan1PriceEgp,
          plan2_extra: input.plan2Extra,
          plan2_price_egp: input.plan2PriceEgp,
          period_days: input.periodDays,
          grace_days: input.graceDays,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reelPlanSettings"] });
      qc.invalidateQueries({ queryKey: ["reelQuota"] });
    },
  });
}

// ───────── عدّاد الريلز للمعلن ─────────
export type ReelQuotaState = "none" | "active" | "grace" | "lapsed";
export type ReelQuota = {
  used: number;
  freeLimit: number;
  extra: number;
  cap: number;
  canPublish: boolean;
  state: ReelQuotaState;
  plan: ReelPlanKey | null;
  endsAt: string | null;
  graceEndsAt: string | null;
  pendingOrder: { id: string; plan: ReelPlanKey; status: ReelPlanStatus } | null;
  /** true = الـ migration لم تُطبَّق على الخادم: لا نقيّد المعلن من الواجهة. */
  unavailable?: boolean;
};

const UNAVAILABLE_QUOTA: ReelQuota = {
  used: 0, freeLimit: DEFAULT_REEL_PLAN_SETTINGS.freeLimit, extra: 0, cap: DEFAULT_REEL_PLAN_SETTINGS.freeLimit,
  canPublish: true, state: "none", plan: null, endsAt: null, graceEndsAt: null, pendingOrder: null, unavailable: true,
};

type QuotaRow = {
  used: number; free_limit: number; extra: number; cap: number; can_publish: boolean; state: string; plan: string | null;
  ends_at: string | null; grace_ends_at: string | null; pending_order: { id: string; plan: string; status: string } | null;
};

export function useReelQuota(userId: string | undefined) {
  return useQuery({
    queryKey: ["reelQuota", userId],
    queryFn: async (): Promise<ReelQuota> => {
      const { data, error } = await supabase.rpc("get_my_reel_quota");
      if (error || !data) {
        console.warn("reel quota unavailable:", error?.message);
        return UNAVAILABLE_QUOTA;
      }
      const r = data as unknown as QuotaRow;
      const state: ReelQuotaState = r.state === "active" || r.state === "grace" || r.state === "lapsed" ? r.state : "none";
      return {
        used: Number(r.used), freeLimit: Number(r.free_limit), extra: Number(r.extra), cap: Number(r.cap),
        canPublish: !!r.can_publish, state,
        plan: r.plan === "plan1" || r.plan === "plan2" ? r.plan : null,
        endsAt: r.ends_at, graceEndsAt: r.grace_ends_at,
        pendingOrder: r.pending_order && isReelPlanStatus(r.pending_order.status) && (r.pending_order.plan === "plan1" || r.pending_order.plan === "plan2")
          ? { id: r.pending_order.id, plan: r.pending_order.plan, status: r.pending_order.status }
          : null,
      };
    },
    enabled: !!userId,
    staleTime: 15_000,
  });
}

// ───────── طلبات الاشتراك الخاصة بالمعلن ─────────
export type ReelPlanOrder = {
  id: string;
  plan: ReelPlanKey;
  extraReels: number;
  priceEgp: number;
  periodDays: number;
  status: ReelPlanStatus;
  paymentMethod: string | null;
  paymentSenderName: string | null;
  paymentContactPhone: string | null;
  payerNote: string | null; // ملاحظة الرفض فقط (ملاحظات الأدمن الداخلية لا تُقرأ)
  startsAt: string | null;
  endsAt: string | null;
  graceEndsAt: string | null;
  createdAt: string;
};

type OrderRow = {
  id: string; plan: string; extra_reels: number; price_egp: number; period_days: number; status: string;
  payment_method: string | null; payment_sender_name: string | null; payment_contact_phone: string | null;
  payer_note?: string | null; starts_at: string | null; ends_at: string | null; grace_ends_at: string | null; created_at: string;
};

function rowToOrder(r: OrderRow): ReelPlanOrder {
  return {
    id: r.id,
    plan: r.plan === "plan2" ? "plan2" : "plan1",
    extraReels: Number(r.extra_reels),
    priceEgp: Number(r.price_egp),
    periodDays: Number(r.period_days),
    status: isReelPlanStatus(r.status) ? r.status : "pending_payment",
    paymentMethod: r.payment_method,
    paymentSenderName: r.payment_sender_name,
    paymentContactPhone: r.payment_contact_phone,
    payerNote: r.payer_note ?? null,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    graceEndsAt: r.grace_ends_at,
    createdAt: r.created_at,
  };
}

export function useMyReelPlanOrders(userId: string | undefined) {
  return useQuery({
    queryKey: ["reelPlanOrders", "mine", userId],
    queryFn: async (): Promise<ReelPlanOrder[]> => {
      const { data, error } = await supabase
        .from("reel_plan_orders")
        .select("id, plan, extra_reels, price_egp, period_days, status, payment_method, payment_sender_name, payment_contact_phone, payer_note, starts_at, ends_at, grace_ends_at, created_at")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) {
        console.warn("my reel plan orders unavailable:", error.message);
        return [];
      }
      return ((data ?? []) as OrderRow[]).map(rowToOrder);
    },
    enabled: !!userId,
    staleTime: 15_000,
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["reelPlanOrders"] });
  qc.invalidateQueries({ queryKey: ["reelQuota"] });
}

export function useCreateReelPlanOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plan: ReelPlanKey): Promise<{ id: string }> => {
      const { data, error } = await supabase.rpc("create_reel_plan_order", { p_plan: plan });
      if (error) {
        if (error.message.includes("bad_plan")) throw new Error("bad_plan");
        if (/not_authenticated/i.test(error.message)) throw new Error("not_owner");
        throw error;
      }
      return { id: String((data as { id: string }).id) };
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useConfirmReelPlanPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; method: string; senderName: string; contactPhone: string }) => {
      const { data, error } = await supabase.rpc("confirm_reel_plan_payment", {
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
    onSuccess: () => invalidateAll(qc),
  });
}

export function useCancelReelPlanOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("cancel_reel_plan_order", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

// ───────── لوحة الأدمن ─────────
export type AdminReelPlanOrder = ReelPlanOrder & {
  userId: string | null;
  payerName: string | null;
  payerPhone: string | null;
  payerEmail: string | null;
  paymentSubmittedAt: string | null;
  paymentRef: string | null;
  adminNote: string | null;
  keptReels: number;
};

export function useAdminReelPlanOrders(enabled: boolean) {
  return useQuery({
    queryKey: ["reelPlanOrders", "admin"],
    queryFn: async (): Promise<AdminReelPlanOrder[]> => {
      const { data, error } = await supabase.rpc("admin_list_reel_plan_orders");
      if (error) throw error;
      return ((data ?? []) as unknown as (OrderRow & {
        user_id: string | null; payer_name: string | null; payer_phone: string | null; payer_email: string | null;
        payment_submitted_at: string | null; payment_ref: string | null; admin_note: string | null; kept_reels: number;
      })[]).map((r) => ({
        ...rowToOrder(r),
        userId: r.user_id,
        payerName: r.payer_name,
        payerPhone: r.payer_phone,
        payerEmail: r.payer_email,
        paymentSubmittedAt: r.payment_submitted_at,
        paymentRef: r.payment_ref,
        adminNote: r.admin_note,
        keptReels: Number(r.kept_reels ?? 0),
      }));
    },
    enabled,
    staleTime: 10_000,
  });
}

export function useAdminUpdateReelPlanOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: "pending_payment" | "submitted" | "active" | "rejected" | "cancelled"; paymentRef?: string; adminNote?: string }) => {
      const { error } = await supabase.rpc("admin_update_reel_plan_order", {
        p_id: input.id,
        p_status: input.status,
        p_payment_ref: input.paymentRef,
        p_admin_note: input.adminNote,
      });
      if (error) {
        if (error.message.includes("user_unavailable")) throw new Error("user_unavailable");
        throw error;
      }
    },
    onSuccess: () => invalidateAll(qc),
  });
}
