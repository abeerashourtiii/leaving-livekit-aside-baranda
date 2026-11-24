import type { ImageSourcePropType } from "react-native";

// ↔ قسم «الخدمات» (دليل الشركات والخدمات العقارية) — migration 20261123000000_companies_directory.sql.
//   التصنيفات الخمسة بالترتيب الظاهر فى صفحة القائمة (الأول على اليمين فى العربى). مفاتيحها مطابقة لـ companies.category فى قاعدة البيانات.
export type CompanyCategory = "marketing" | "finishing" | "supplies" | "development" | "moving";

export const COMPANY_CATEGORIES: { key: CompanyCategory; label: string; image: ImageSourcePropType }[] = [
  { key: "marketing", label: "شركات التسويق العقاري", image: require("../assets/services/marketing.jpg") },
  { key: "finishing", label: "شركات التشطيبات والديكور", image: require("../assets/services/finishing.jpg") },
  { key: "supplies", label: "شركات لوازم الكهرباء والسباكة والدهانات", image: require("../assets/services/supplies.jpg") },
  { key: "development", label: "شركات التطوير العقاري", image: require("../assets/services/development.jpg") },
  { key: "moving", label: "شركات الونش ونقل الأثاث", image: require("../assets/services/moving.jpg") },
];

export function isCompanyCategory(v: unknown): v is CompanyCategory {
  return COMPANY_CATEGORIES.some((c) => c.key === v);
}

export function companyCategoryLabel(key: string | null | undefined): string {
  return COMPANY_CATEGORIES.find((c) => c.key === key)?.label ?? "";
}

// ↔ الشركات التى تعرض «صور تسويق شقة / عقار / كمبوند» بدل صور الأعمال (تسويق + تطوير عقارى) — للنص التوضيحى فقط.
export function companyUsesPropertyPhotos(key: string | null | undefined): boolean {
  return key === "marketing" || key === "development";
}

export type CompanyPlanKey = "phone" | "photos" | "both";
export type CompanyPlanStatus = "pending_payment" | "submitted" | "active" | "rejected" | "cancelled" | "expired";
export type CompanyStatus = "pending" | "approved" | "rejected" | "hidden";

export const COMPANY_PLANS: { key: CompanyPlanKey; label: string; hint: string }[] = [
  { key: "phone", label: "إظهار رقم الهاتف", hint: "يظهر رقم هاتف شركتك وأزرار الاتصال والواتساب للزوار" },
  { key: "photos", label: "معرض صور الأعمال", hint: "إضافة وعرض حتى 6 صور لأعمال شركتك" },
  { key: "both", label: "الهاتف + معرض الصور", hint: "تفعيل الميزتين معًا بسعر مخفّض" },
];

export const COMPANY_STATUS_LABELS: Record<CompanyStatus, string> = {
  pending: "قيد مراجعة الإدارة",
  approved: "معتمدة وظاهرة للجميع",
  rejected: "مرفوضة",
  hidden: "مخفية بقرار الإدارة",
};

export const COMPANY_PLAN_STATUS_LABELS: Record<CompanyPlanStatus, string> = {
  pending_payment: "بانتظار السداد",
  submitted: "تم إرسال تأكيد السداد وقيد المراجعة",
  active: "مفعّل",
  rejected: "مرفوض",
  cancelled: "ملغى",
  expired: "منتهٍ",
};

export function isCompanyPlanKey(v: unknown): v is CompanyPlanKey {
  return v === "phone" || v === "photos" || v === "both";
}

export function isCompanyPlanStatus(v: unknown): v is CompanyPlanStatus {
  return v === "pending_payment" || v === "submitted" || v === "active" || v === "rejected" || v === "cancelled" || v === "expired";
}

export function isCompanyStatus(v: unknown): v is CompanyStatus {
  return v === "pending" || v === "approved" || v === "rejected" || v === "hidden";
}

export function companyPlanLabel(plan: string | null | undefined): string {
  return COMPANY_PLANS.find((p) => p.key === plan)?.label ?? "";
}

// تحقق الهاتف (نفس شرط الخادم: 7 إلى 15 رقمًا).
export function isValidCompanyPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && phone.trim().length <= 30;
}

// عدد الأيام المتبقية حتى تاريخ (للتنبيهات). null لو لا يوجد تاريخ.
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / 86_400_000);
}

export function formatCompanyDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
}

// رقم واتساب دولى مبسّط من رقم محلى مصرى (01xxxxxxxxx → 20 1xxxxxxxxx). ما يبدأ بـ + أو 00 يُترك كما هو.
export function companyWhatsappNumber(phone: string): string {
  const raw = phone.trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return `20${digits.slice(1)}`;
  return digits;
}
