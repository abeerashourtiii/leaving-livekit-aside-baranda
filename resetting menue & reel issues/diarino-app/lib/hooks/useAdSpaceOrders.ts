import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { PromoSettings, PromoStatus, isPromoStatus } from "./usePromotions";

// ↔ حجز «المساحة الإعلانية» (بانر صفحة القائمة + صفحة البحث) من داخل التطبيق — migration 20261024000000_ad_space_orders.sql.
//   الباقات: 7 أيام = 1500 ج.م، 14 يومًا = 2500 ج.م، 30 يومًا = 4000 ج.م (الأسعار من promo_settings، يعدّلها الأدمن).
//   المسار: رفع صورة الإعلان ← اختيار المدة ← فاتورة ← السداد (فودافون كاش/اتصالات كاش/إنستاباي) ← مراجعة الأدمن ← تفعيل.
//   الإعلان «الحصرى» بالتواصل على واتساب (EXCLUSIVE_AD_WHATSAPP_URL).
export const AD_SPACE_DURATIONS = [7, 14, 30] as const;
export type AdSpaceDuration = (typeof AD_SPACE_DURATIONS)[number];
export const EXCLUSIVE_AD_WHATSAPP_URL = "https://wa.me/message/ELZ7IYGOMVU2I1";

export function adSpacePrice(settings: PromoSettings, days: AdSpaceDuration): number {
  return days === 30 ? settings.banner30PriceEgp : days === 14 ? settings.banner14PriceEgp : settings.banner7PriceEgp;
}

export type AdSpaceOrder = {
  id: string;
  title: string;
  imageUrl: string;
  durationDays: number;
  priceEgp: number;
  status: PromoStatus; // الحالة الفعلية (المفعّل المنتهى = expired)
  paymentMethod: string | null;
  paymentSenderName: string | null;
  paymentContactPhone: string | null;
  adminNote: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
};

type OrderRow = {
  id: string; title: string; image_url: string; duration_days: number; price_egp: number; status: string;
  payment_method: string | null; payment_sender_name: string | null; payment_contact_phone: string | null;
  admin_note: string | null; starts_at: string | null; ends_at: string | null; created_at: string;
};

function rowToOrder(r: OrderRow): AdSpaceOrder {
  let status: PromoStatus = isPromoStatus(r.status) ? r.status : "pending_payment";
  if (status === "active" && r.ends_at && new Date(r.ends_at).getTime() < Date.now()) status = "expired";
  return {
    id: r.id, title: r.title, imageUrl: r.image_url, durationDays: r.duration_days, priceEgp: Number(r.price_egp), status,
    paymentMethod: r.payment_method, paymentSenderName: r.payment_sender_name, paymentContactPhone: r.payment_contact_phone,
    adminNote: r.admin_note, startsAt: r.starts_at, endsAt: r.ends_at, createdAt: r.created_at,
  };
}

export function useMyAdSpaceOrders(userId: string | undefined) {
  return useQuery({
    queryKey: ["adSpaceOrders", "mine", userId],
    queryFn: async (): Promise<AdSpaceOrder[]> => {
      const { data, error } = await supabase.from("ad_space_orders").select("*").eq("payer_id", userId!).order("created_at", { ascending: false });
      if (error) {
        console.warn("my ad space orders unavailable:", error.message);
        return [];
      }
      return ((data ?? []) as OrderRow[]).map(rowToOrder);
    },
    enabled: !!userId,
    staleTime: 15_000,
  });
}

export function useCreateAdSpaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { imageUrl: string; durationDays: AdSpaceDuration; title?: string }) => {
      const { data, error } = await supabase.rpc("create_ad_space_order", {
        p_image_url: input.imageUrl,
        p_duration_days: input.durationDays,
        p_title: input.title?.trim() || undefined,
      });
      if (error) {
        for (const code of ["bad_image", "bad_duration", "too_many_open_orders"]) {
          if (error.message.includes(code)) throw new Error(code);
        }
        if (/not_authenticated/i.test(error.message)) throw new Error("not_authenticated");
        throw error;
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adSpaceOrders"] }),
  });
}

export function useConfirmAdSpacePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; method: string; senderName: string; contactPhone: string }) => {
      const { data, error } = await supabase.rpc("confirm_ad_space_payment", {
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adSpaceOrders"] }),
  });
}

export function useCancelAdSpaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("cancel_ad_space_order", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adSpaceOrders"] }),
  });
}

// ───────── لوحة الأدمن ─────────
export type AdminAdSpaceOrder = AdSpaceOrder & {
  payerId: string | null;
  payerName: string | null;
  payerPhone: string | null;
  payerEmail: string | null;
  paymentSubmittedAt: string | null;
  paymentRef: string | null;
};

export function useAdminAdSpaceOrders(enabled: boolean) {
  return useQuery({
    queryKey: ["adSpaceOrders", "admin"],
    queryFn: async (): Promise<AdminAdSpaceOrder[]> => {
      const { data, error } = await supabase.rpc("admin_list_ad_space_orders");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...rowToOrder(r as unknown as OrderRow),
        payerId: r.payer_id, payerName: r.payer_name, payerPhone: r.payer_phone, payerEmail: r.payer_email,
        paymentSubmittedAt: r.payment_submitted_at, paymentRef: r.payment_ref,
      }));
    },
    enabled,
    staleTime: 10_000,
  });
}

export function useAdminUpdateAdSpaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: "pending_payment" | "submitted" | "active" | "rejected" | "cancelled"; paymentRef?: string; adminNote?: string }) => {
      const { error } = await supabase.rpc("admin_update_ad_space_order", {
        p_id: input.id, p_status: input.status, p_payment_ref: input.paymentRef, p_admin_note: input.adminNote,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adSpaceOrders"] });
      qc.invalidateQueries({ queryKey: ["adBanners"] });
    },
  });
}
