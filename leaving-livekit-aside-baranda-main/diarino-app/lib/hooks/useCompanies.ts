import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import { requestOwnMediaCleanup } from "../mediaCleanupClient";
import {
  CompanyCategory, CompanyPlanKey, CompanyPlanStatus, CompanyStatus,
  isCompanyPlanStatus, isCompanyStatus,
} from "../companies";

// ↔ قسم «الخدمات» — migration 20261123000000_companies_directory.sql.
//   الجدولان companies / company_images لا يُقرآن مباشرة إلا للمالك والأدمن؛ الزائر يقرأ عبر list_companies / get_company
//   (لا يُرجعان الهاتف ولا الصور إلا لو الميزة سارية — الإخفاء من جهة الخادم). كل الكتابة عبر دوال RPC تتحقق من المالك.
//   الـ client هنا غير مُنمَّط (SupabaseClient بلا Database) لأن ملف الأنواع المُولَّد لا يحتوى الجداول/الدوال الجديدة.
const db = supabase as unknown as SupabaseClient;

// ───────── الأنواع ─────────
export type CompanyListItem = {
  id: string;
  category: CompanyCategory;
  name: string;
  logoUrl: string;
  province: string;
  region: string;
  description: string;
  createdAt: string;
};

export type CompanyImage = { id: string; url: string };

export type CompanyDetails = {
  id: string;
  category: CompanyCategory;
  name: string;
  description: string;
  logoUrl: string;
  province: string;
  region: string;
  buildingNo: string | null;
  floorNo: string | null;
  unitNo: string | null;
  status: CompanyStatus;
  phoneVisible: boolean;
  photosVisible: boolean;
  phone: string | null;
  phone2: string | null;
  images: CompanyImage[];
};

export type CompanySettings = {
  freeDays: number;
  periodDays: number;
  phonePriceEgp: number;
  photosPriceEgp: number;
  bothPriceEgp: number;
  maxPhotos: number;
};

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  freeDays: 60, periodDays: 30, phonePriceEgp: 100, photosPriceEgp: 100, bothPriceEgp: 200, maxPhotos: 6,
};

export type CompanyOrder = {
  id: string;
  plan: CompanyPlanKey;
  priceEgp: number;
  periodDays: number;
  status: CompanyPlanStatus;
  startsAt: string | null;
  endsAt: string | null;
  payerNote: string | null;
  createdAt: string;
  paymentMethod: string | null;
  paymentSenderName: string | null;
  paymentContactPhone: string | null;
};

export type MyCompany = {
  id: string;
  category: CompanyCategory;
  name: string;
  description: string;
  logoUrl: string;
  province: string;
  region: string;
  managerName: string;
  phone: string;
  phone2: string | null;
  buildingNo: string | null;
  floorNo: string | null;
  unitNo: string | null;
  taxCardNo: string | null;
  commercialRegisterNo: string | null;
  status: CompanyStatus;
  rejectReason: string | null;
  approvedAt: string | null;
  createdAt: string;
  images: CompanyImage[];
  freeUntil: string | null;
  phoneUntil: string | null;
  photosUntil: string | null;
  phoneActive: boolean;
  photosActive: boolean;
  orders: CompanyOrder[];
  settings: CompanySettings;
};

export type CompanyFormValues = {
  category: CompanyCategory | "";
  name: string;
  description: string;
  logoUrl: string;
  province: string;
  region: string;
  managerName: string;
  phone: string;
  phone2: string;
  buildingNo: string;
  floorNo: string;
  unitNo: string;
  taxCardNo: string;
  commercialRegisterNo: string;
  images: string[];
};

// ───────── التحويل من JSON الخادم ─────────
type Json = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" ? v : Number(v ?? d) || d);
function images(v: unknown): CompanyImage[] {
  if (!Array.isArray(v)) return [];
  return (v as Json[]).map((i) => ({ id: str(i.id), url: str(i.url) })).filter((i) => !!i.url);
}
function settingsFrom(v: unknown): CompanySettings {
  const s = (v ?? {}) as Json;
  return {
    freeDays: num(s.free_days, 60), periodDays: num(s.period_days, 30), phonePriceEgp: num(s.phone_price_egp, 100),
    photosPriceEgp: num(s.photos_price_egp, 100), bothPriceEgp: num(s.both_price_egp, 200), maxPhotos: num(s.max_photos, 6),
  };
}
function orderFrom(o: Json): CompanyOrder {
  const plan = o.plan === "phone" || o.plan === "photos" || o.plan === "both" ? o.plan : "phone";
  return {
    id: str(o.id), plan, priceEgp: num(o.price_egp), periodDays: num(o.period_days, 30),
    status: isCompanyPlanStatus(o.status) ? o.status : "pending_payment",
    startsAt: strOrNull(o.starts_at), endsAt: strOrNull(o.ends_at), payerNote: strOrNull(o.payer_note), createdAt: str(o.created_at),
    paymentMethod: strOrNull(o.payment_method), paymentSenderName: strOrNull(o.payment_sender_name),
    paymentContactPhone: strOrNull(o.payment_contact_phone),
  };
}
function categoryFrom(v: unknown): CompanyCategory {
  return v === "finishing" || v === "supplies" || v === "development" || v === "moving" ? v : "marketing";
}
function myCompanyFrom(j: Json): MyCompany {
  return {
    id: str(j.id), category: categoryFrom(j.category), name: str(j.name), description: str(j.description), logoUrl: str(j.logo_url),
    province: str(j.province), region: str(j.region), managerName: str(j.manager_name), phone: str(j.phone), phone2: strOrNull(j.phone2),
    buildingNo: strOrNull(j.building_no), floorNo: strOrNull(j.floor_no), unitNo: strOrNull(j.unit_no),
    taxCardNo: strOrNull(j.tax_card_no), commercialRegisterNo: strOrNull(j.commercial_register_no),
    status: isCompanyStatus(j.status) ? j.status : "pending", rejectReason: strOrNull(j.reject_reason),
    approvedAt: strOrNull(j.approved_at), createdAt: str(j.created_at), images: images(j.images),
    freeUntil: strOrNull(j.free_until), phoneUntil: strOrNull(j.phone_until), photosUntil: strOrNull(j.photos_until),
    phoneActive: !!j.phone_active, photosActive: !!j.photos_active,
    orders: Array.isArray(j.orders) ? (j.orders as Json[]).map(orderFrom) : [],
    settings: settingsFrom(j.settings),
  };
}

function errCode(error: { message?: string } | null | undefined, codes: string[]): Error | null {
  if (!error) return null;
  const msg = error.message ?? "";
  for (const c of codes) if (msg.includes(c)) return new Error(c);
  if (/not_authenticated|permission denied|42501/i.test(msg)) return new Error("not_authenticated");
  return new Error(msg || "unknown_error");
}

// ───────── الجمهور ─────────
export type CompanyListFilters = { category: CompanyCategory; province?: string; region?: string; search?: string };

export function useCompanyList(f: CompanyListFilters) {
  return useQuery({
    queryKey: ["companies", "list", f.category, f.province ?? "", f.region ?? "", f.search ?? ""],
    queryFn: async (): Promise<CompanyListItem[]> => {
      const { data, error } = await db.rpc("list_companies", {
        p_category: f.category, p_province: f.province || null, p_region: f.region || null, p_search: f.search || null, p_limit: 200, p_offset: 0,
      });
      if (error) throw error;
      return ((data ?? []) as Json[]).map((r) => ({
        id: str(r.id), category: categoryFrom(r.category), name: str(r.name), logoUrl: str(r.logo_url),
        province: str(r.province), region: str(r.region), description: str(r.description), createdAt: str(r.created_at),
      }));
    },
    staleTime: 30_000,
  });
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: ["companies", "detail", id],
    queryFn: async (): Promise<CompanyDetails | null> => {
      const { data, error } = await db.rpc("get_company", { p_id: id });
      if (error) throw error;
      if (!data) return null;
      const j = data as Json;
      return {
        id: str(j.id), category: categoryFrom(j.category), name: str(j.name), description: str(j.description), logoUrl: str(j.logo_url),
        province: str(j.province), region: str(j.region), buildingNo: strOrNull(j.building_no), floorNo: strOrNull(j.floor_no),
        unitNo: strOrNull(j.unit_no), status: isCompanyStatus(j.status) ? j.status : "approved",
        phoneVisible: !!j.phone_visible, photosVisible: !!j.photos_visible, phone: strOrNull(j.phone), phone2: strOrNull(j.phone2),
        images: images(j.images),
      };
    },
    enabled: !!id,
    staleTime: 15_000,
  });
}

// ───────── المالك ─────────
export function useMyCompany(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["companies", "mine", userId],
    queryFn: async (): Promise<MyCompany | null> => {
      const { data, error } = await db.rpc("get_my_company");
      if (error) {
        console.warn("my company unavailable:", error.message);
        return null;
      }
      return data ? myCompanyFrom(data as Json) : null;
    },
    enabled: !!userId && enabled,
    staleTime: 15_000,
  });
}

function invalidateCompanies(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["companies"] });
}

export function useSaveMyCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: CompanyFormValues & { includeImages: boolean }): Promise<MyCompany | null> => {
      const payload: Record<string, unknown> = {
        category: v.category, name: v.name, description: v.description, logo_url: v.logoUrl, province: v.province, region: v.region,
        manager_name: v.managerName, phone: v.phone, phone2: v.phone2, building_no: v.buildingNo, floor_no: v.floorNo, unit_no: v.unitNo,
        tax_card_no: v.taxCardNo, commercial_register_no: v.commercialRegisterNo,
      };
      if (v.includeImages) payload.images = v.images;
      const { data, error } = await db.rpc("save_my_company", { p: payload });
      const e = errCode(error, [
        "bad_category", "bad_name", "bad_description", "bad_logo", "bad_province", "bad_region", "bad_manager", "bad_phone",
        "bad_phone2", "bad_text", "too_many_images", "photos_inactive",
      ]);
      if (e) throw e;
      return data ? myCompanyFrom(data as Json) : null;
    },
    onSuccess: () => {
      invalidateCompanies(qc);
      // الشعار/الصور المُستبدلة أو المحذوفة تدخل طابور الحذف بالخادم — نطلب معالجتها فورًا (best-effort).
      requestOwnMediaCleanup();
    },
  });
}

export function useDeleteMyCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("delete_my_company");
      const e = errCode(error, ["has_open_fees", "no_company"]);
      if (e) throw e;
    },
    onSuccess: () => {
      invalidateCompanies(qc);
      requestOwnMediaCleanup();
    },
  });
}

// ───────── الاشتراكات ─────────
export type CompanyOrderCreated = { id: string; plan: CompanyPlanKey; priceEgp: number; periodDays: number; status: CompanyPlanStatus; companyName: string };

export function useCreateCompanyPlanOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plan: CompanyPlanKey): Promise<CompanyOrderCreated> => {
      const { data, error } = await db.rpc("create_company_plan_order", { p_plan: plan });
      const e = errCode(error, ["bad_plan", "no_company", "company_not_approved"]);
      if (e) throw e;
      const j = (data ?? {}) as Json;
      return {
        id: str(j.id), plan: orderFrom({ plan: j.plan }).plan, priceEgp: num(j.price_egp), periodDays: num(j.period_days, 30),
        status: isCompanyPlanStatus(j.status) ? j.status : "pending_payment", companyName: str(j.company_name),
      };
    },
    onSuccess: () => invalidateCompanies(qc),
  });
}

export function useConfirmCompanyPlanPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; method: string; senderName: string; contactPhone: string }) => {
      const { data, error } = await db.rpc("confirm_company_plan_payment", {
        p_id: input.id, p_method: input.method, p_sender_name: input.senderName.trim(), p_contact_phone: input.contactPhone.trim(),
      });
      const e = errCode(error, ["order_closed", "bad_method", "bad_sender_name", "bad_contact_phone", "not_owner"]);
      if (e) throw e;
      return data;
    },
    onSuccess: () => invalidateCompanies(qc),
  });
}

export function useCancelCompanyPlanOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("cancel_company_plan_order", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => invalidateCompanies(qc),
  });
}

// ───────── لوحة الأدمن ─────────
export type AdminCompany = {
  id: string;
  ownerId: string;
  category: CompanyCategory;
  name: string;
  description: string;
  logoUrl: string;
  province: string;
  region: string;
  managerName: string;
  phone: string;
  phone2: string | null;
  buildingNo: string | null;
  floorNo: string | null;
  unitNo: string | null;
  taxCardNo: string | null;
  commercialRegisterNo: string | null;
  status: CompanyStatus;
  rejectReason: string | null;
  adminNote: string | null;
  approvedAt: string | null;
  createdAt: string;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  freeUntil: string | null;
  phoneUntil: string | null;
  photosUntil: string | null;
  images: CompanyImage[];
};

export function useAdminCompanies(enabled: boolean) {
  return useQuery({
    queryKey: ["companies", "admin"],
    queryFn: async (): Promise<AdminCompany[]> => {
      const { data, error } = await db.rpc("admin_list_companies");
      if (error) throw error;
      return ((data ?? []) as Json[]).map((j) => ({
        id: str(j.id), ownerId: str(j.owner_id), category: categoryFrom(j.category), name: str(j.name), description: str(j.description),
        logoUrl: str(j.logo_url), province: str(j.province), region: str(j.region), managerName: str(j.manager_name), phone: str(j.phone),
        phone2: strOrNull(j.phone2), buildingNo: strOrNull(j.building_no), floorNo: strOrNull(j.floor_no), unitNo: strOrNull(j.unit_no),
        taxCardNo: strOrNull(j.tax_card_no), commercialRegisterNo: strOrNull(j.commercial_register_no),
        status: isCompanyStatus(j.status) ? j.status : "pending", rejectReason: strOrNull(j.reject_reason), adminNote: strOrNull(j.admin_note),
        approvedAt: strOrNull(j.approved_at), createdAt: str(j.created_at), ownerName: strOrNull(j.owner_name),
        ownerPhone: strOrNull(j.owner_phone), ownerEmail: strOrNull(j.owner_email), freeUntil: strOrNull(j.free_until),
        phoneUntil: strOrNull(j.phone_until), photosUntil: strOrNull(j.photos_until), images: images(j.images),
      }));
    },
    enabled,
    staleTime: 10_000,
  });
}

export function useAdminSetCompanyStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: CompanyStatus; reason?: string; note?: string }) => {
      const { error } = await db.rpc("admin_set_company_status", {
        p_id: input.id, p_status: input.status, p_reason: input.reason ?? null, p_note: input.note ?? null,
      });
      const e = errCode(error, ["reason_required", "company_not_found", "forbidden"]);
      if (e) throw e;
    },
    onSuccess: () => {
      invalidateCompanies(qc);
      void qc.invalidateQueries({ queryKey: ["adminPendingCounts"] });
    },
  });
}

export function useAdminDeleteCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("admin_delete_company", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateCompanies(qc);
      void qc.invalidateQueries({ queryKey: ["adminPendingCounts"] });
    },
  });
}

export type AdminCompanyOrder = CompanyOrder & {
  companyId: string | null;
  companyName: string;
  payerName: string | null;
  payerPhone: string | null;
  payerEmail: string | null;
  paymentSubmittedAt: string | null;
  paymentRef: string | null;
  adminNote: string | null;
};

export function useAdminCompanyOrders(enabled: boolean) {
  return useQuery({
    queryKey: ["companies", "adminOrders"],
    queryFn: async (): Promise<AdminCompanyOrder[]> => {
      const { data, error } = await db.rpc("admin_list_company_orders");
      if (error) throw error;
      return ((data ?? []) as Json[]).map((j) => ({
        ...orderFrom(j), companyId: strOrNull(j.company_id), companyName: str(j.company_name), payerName: strOrNull(j.payer_name),
        payerPhone: strOrNull(j.payer_phone), payerEmail: strOrNull(j.payer_email), paymentSubmittedAt: strOrNull(j.payment_submitted_at),
        paymentRef: strOrNull(j.payment_ref), adminNote: strOrNull(j.admin_note),
      }));
    },
    enabled,
    staleTime: 10_000,
  });
}

export function useAdminUpdateCompanyOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: "pending_payment" | "submitted" | "active" | "rejected" | "cancelled"; paymentRef?: string; adminNote?: string }) => {
      const { error } = await db.rpc("admin_update_company_order", {
        p_id: input.id, p_status: input.status, p_payment_ref: input.paymentRef ?? null, p_admin_note: input.adminNote ?? null,
      });
      const e = errCode(error, ["company_unavailable", "company_not_approved", "order_not_found", "forbidden"]);
      if (e) throw e;
    },
    onSuccess: () => {
      invalidateCompanies(qc);
      void qc.invalidateQueries({ queryKey: ["adminPendingCounts"] });
    },
  });
}

// أسعار/مدد الخدمات: القراءة للجميع، والتعديل للمشرف الرئيسى فقط (RLS).
export function useCompanySettings() {
  const q = useQuery({
    queryKey: ["companies", "settings"],
    queryFn: async (): Promise<CompanySettings> => {
      const { data, error } = await db.from("company_settings").select("*").eq("id", true).maybeSingle();
      if (error || !data) return DEFAULT_COMPANY_SETTINGS;
      return settingsFrom(data);
    },
    staleTime: 5 * 60_000,
  });
  return { settings: q.data ?? DEFAULT_COMPANY_SETTINGS, isLoading: q.isLoading };
}

export function useUpdateCompanySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: CompanySettings) => {
      const { error } = await db
        .from("company_settings")
        .update({
          free_days: s.freeDays, period_days: s.periodDays, phone_price_egp: s.phonePriceEgp, photos_price_egp: s.photosPriceEgp,
          both_price_egp: s.bothPriceEgp, max_photos: s.maxPhotos, updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => invalidateCompanies(qc),
  });
}
