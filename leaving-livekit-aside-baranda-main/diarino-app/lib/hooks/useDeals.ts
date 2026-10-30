import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";

// ↔ نظام الصفقات والرسوم (سياسة البيع والرسوم) — migration 20261012000000_property_deals_and_rights.sql.
// الرسم الافتراضى 1000 جنيه، يتغيّر من لوحة الأدمن (deal_settings) من غير تعديل كود.
// كل الاستعلامات هنا بتتعامل مع غياب الجدول/الدالة (migration لسه ما اتطبقتش) بقيم افتراضية بدل ما الشاشة تفشل.

export type DealType = "sale" | "rent";
// submitted = الناشر أكّد السداد وأدخل بياناته، بانتظار مراجعة التطبيق (20261022000000_deal_fees_instapay.sql).
export type DealStatus = "reported" | "invoiced" | "submitted" | "paid" | "disputed" | "waived";

export type DealSettings = {
  feeEgp: number; // رسم البيع
  feeRentEgp: number; // رسم الإيجار
  protectionDays: number;
  notifyDays: number;
  payDays: number;
  paymentInstructions: string | null;
};

export const DEFAULT_DEAL_SETTINGS: DealSettings = {
  feeEgp: 1000,
  feeRentEgp: 500,
  protectionDays: 90,
  notifyDays: 7,
  payDays: 7,
  paymentInstructions: null,
};

export type Deal = {
  id: string;
  propertyId: string | null;
  propertyTitle: string;
  dealType: DealType;
  feeEgp: number;
  status: DealStatus;
  reportedAt: string;
  dueAt: string | null;
  paidAt: string | null;
  // ↔ بيانات تأكيد السداد التى أدخلها الناشر (تظهر له بعد الإرسال).
  paymentSenderName?: string | null;
  paymentSenderEmail?: string | null;
  paymentContactPhone?: string | null;
  paymentSubmittedAt?: string | null;
  paymentMethod?: string | null; // vodafone_cash | etisalat_cash | instapay
};

// رسم الصفقة حسب نوعها من الإعدادات (بيع 1000 / إيجار 500 افتراضيًا).
export function feeForDealType(settings: DealSettings, dealType: DealType): number {
  return dealType === "rent" ? settings.feeRentEgp : settings.feeEgp;
}

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  reported: "مستحق — بانتظار السداد",
  invoiced: "تم إرسال المطالبة",
  submitted: "تم إرسال تأكيد السداد وقيد المراجعة",
  paid: "تم السداد",
  disputed: "قيد المراجعة",
  waived: "ملغاة",
};

export function isDealStatus(v: unknown): v is DealStatus {
  return v === "reported" || v === "invoiced" || v === "submitted" || v === "paid" || v === "disputed" || v === "waived";
}

// ───────── الإعدادات (قراءة للجميع، تعديل للأدمن) ─────────
export function useDealSettings() {
  const q = useQuery({
    queryKey: ["dealSettings"],
    queryFn: async (): Promise<DealSettings> => {
      const { data, error } = await supabase.from("deal_settings").select("*").eq("id", true).maybeSingle();
      if (error || !data) return DEFAULT_DEAL_SETTINGS;
      return {
        feeEgp: Number(data.fee_egp),
        feeRentEgp: data.fee_rent_egp != null ? Number(data.fee_rent_egp) : DEFAULT_DEAL_SETTINGS.feeRentEgp,
        protectionDays: data.protection_days,
        notifyDays: data.notify_days,
        payDays: data.pay_days,
        paymentInstructions: data.payment_instructions,
      };
    },
    staleTime: 5 * 60_000,
  });
  return { settings: q.data ?? DEFAULT_DEAL_SETTINGS, isLoading: q.isLoading };
}

export function useUpdateDealSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DealSettings) => {
      const { error } = await supabase
        .from("deal_settings")
        .update({
          fee_egp: input.feeEgp,
          fee_rent_egp: input.feeRentEgp,
          protection_days: input.protectionDays,
          notify_days: input.notifyDays,
          pay_days: input.payDays,
          payment_instructions: input.paymentInstructions?.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dealSettings"] }),
  });
}

// ───────── صفقات الناشر نفسه ─────────
export function useMyDeals(userId: string | undefined) {
  return useQuery({
    queryKey: ["deals", "mine", userId],
    queryFn: async (): Promise<Map<string, Deal>> => {
      const BASE = "id, property_id, property_title, deal_type, fee_egp, status, reported_at, due_at, paid_at";
      const EXTRA = ", payment_sender_name, payment_sender_email, payment_contact_phone, payment_submitted_at";
      const WITH_METHOD = EXTRA + ", payment_method";
      // ↔ لو الـ migrations الأحدث (20261022 / 20261023) لسه ما اتطبقتش، أعمدتها مش موجودة: نرجع خطوة خطوة للاستعلام الأقدم بدل ما تفشل الشاشة.
      let res = await supabase.from("property_deals").select(BASE + WITH_METHOD).eq("payer_id", userId!).neq("status", "waived");
      if (res.error) {
        res = (await supabase.from("property_deals").select(BASE + EXTRA).eq("payer_id", userId!).neq("status", "waived")) as typeof res;
      }
      if (res.error) {
        res = (await supabase.from("property_deals").select(BASE).eq("payer_id", userId!).neq("status", "waived")) as typeof res;
      }
      const { data, error } = res;
      const map = new Map<string, Deal>();
      if (error) {
        console.warn("my deals unavailable:", error.message);
        return map;
      }
      for (const r of (data ?? []) as Record<string, any>[]) {
        if (!r.property_id) continue;
        map.set(r.property_id, {
          id: r.id,
          propertyId: r.property_id,
          propertyTitle: r.property_title,
          dealType: r.deal_type === "rent" ? "rent" : "sale",
          feeEgp: Number(r.fee_egp),
          status: isDealStatus(r.status) ? r.status : "reported",
          reportedAt: r.reported_at,
          dueAt: r.due_at,
          paidAt: r.paid_at,
          paymentSenderName: r.payment_sender_name ?? null,
          paymentSenderEmail: r.payment_sender_email ?? null,
          paymentContactPhone: r.payment_contact_phone ?? null,
          paymentSubmittedAt: r.payment_submitted_at ?? null,
          paymentMethod: r.payment_method ?? null,
        });
      }
      return map;
    },
    enabled: !!userId,
    staleTime: 15_000,
  });
}

// ↔ «تم البيع / تم الإيجار» — الدالة على الخادم بتتأكد إن المستدعى هو صاحب الإعلان، وإن نوع الصفقة = غرض الإعلان،
// وإن مفيش صفقة فعّالة تانية على نفس الإعلان، وبتقفل الإعلان وتسجّل الرسم.
export function useReportDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ propertyId, dealType, note }: { propertyId: string; dealType: DealType; note?: string }) => {
      const { data, error } = await supabase.rpc("report_property_deal", {
        p_property_id: propertyId,
        p_deal_type: dealType,
        p_note: note?.trim() || undefined,
      });
      if (error) {
        if (/already_reported/i.test(error.message)) throw new Error("already_reported");
        if (/type_mismatch/i.test(error.message)) throw new Error("type_mismatch");
        if (/not_owner|not_authenticated/i.test(error.message)) throw new Error("not_owner");
        throw error;
      }
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["deals"] }),
        qc.invalidateQueries({ queryKey: ["properties"] }),
      ]);
    },
  });
}

// ↔ تأكيد السداد: طريقة الدفع (فودافون كاش / اتصالات كاش / إنستاباي) + اسم الراسل ثلاثيًا + رقم التواصل (بدون إيميل إنستاباي).
// الدالة على الخادم (confirm_deal_payment) تتأكد إن المستدعى هو صاحب الصفقة وتتحقق من البيانات، وتحوّل الحالة إلى submitted
// لتراجعها إدارة التطبيق. (submit_deal_payment القديمة بتفضل موجودة فقط لنسخ التطبيق القديمة.)
export function useConfirmDealPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { dealId: string; method: string; senderName: string; contactPhone: string }) => {
      const { data, error } = await supabase.rpc("confirm_deal_payment", {
        p_deal_id: input.dealId,
        p_method: input.method,
        p_sender_name: input.senderName.trim(),
        p_contact_phone: input.contactPhone.trim(),
      });
      if (error) {
        for (const code of ["deal_closed", "bad_method", "bad_sender_name", "bad_contact_phone"]) {
          if (error.message.includes(code)) throw new Error(code);
        }
        if (/not_owner|not_authenticated/i.test(error.message)) throw new Error("not_owner");
        throw error;
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deals"] }),
  });
}

// ───────── لوحة الأدمن ─────────
export type AdminDealRow = {
  id: string;
  propertyId: string | null;
  propertyTitle: string;
  propertyProvince: string | null;
  dealType: DealType;
  feeEgp: number;
  status: DealStatus;
  reportedAt: string;
  dueAt: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  note: string | null;
  adminNote: string | null;
  payerId: string | null;
  payerName: string | null;
  payerPhone: string | null;
  payerEmail: string | null;
  payerAccountType: string | null;
  // ↔ بيانات تأكيد السداد من الناشر (للمراجعة مع كشف InstaPay).
  paymentSenderName: string | null;
  paymentSenderEmail: string | null;
  paymentContactPhone: string | null;
  paymentSubmittedAt: string | null;
  paymentMethod: string | null;
};

export function useAdminDeals() {
  return useQuery({
    queryKey: ["deals", "admin"],
    queryFn: async (): Promise<AdminDealRow[]> => {
      const { data, error } = await supabase.rpc("admin_list_deals");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        propertyId: r.property_id,
        propertyTitle: r.property_title,
        propertyProvince: r.property_province,
        dealType: r.deal_type === "rent" ? "rent" : "sale",
        feeEgp: Number(r.fee_egp),
        status: isDealStatus(r.status) ? r.status : "reported",
        reportedAt: r.reported_at,
        dueAt: r.due_at,
        paidAt: r.paid_at,
        paymentRef: r.payment_ref,
        note: r.note,
        adminNote: r.admin_note,
        payerId: r.payer_id,
        payerName: r.payer_name,
        payerPhone: r.payer_phone,
        payerEmail: r.payer_email,
        payerAccountType: r.payer_account_type,
        paymentSenderName: r.payment_sender_name ?? null,
        paymentSenderEmail: r.payment_sender_email ?? null,
        paymentContactPhone: r.payment_contact_phone ?? null,
        paymentSubmittedAt: r.payment_submitted_at ?? null,
        paymentMethod: r.payment_method ?? null,
      }));
    },
    staleTime: 10_000,
  });
}

export function useAdminUpdateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: DealStatus; paymentRef?: string; adminNote?: string; reopen?: boolean }) => {
      const { error } = await supabase.rpc("admin_update_deal", {
        p_id: input.id,
        p_status: input.status,
        p_payment_ref: input.paymentRef?.trim() || undefined,
        p_admin_note: input.adminNote?.trim() || undefined,
        p_reopen: input.reopen ?? false,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["deals"] }),
        qc.invalidateQueries({ queryKey: ["properties"] }),
      ]);
    },
  });
}
