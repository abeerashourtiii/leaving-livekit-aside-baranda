// ↔ نافذة الـ 24 ساعة لصاحب الإعلان/الطلب (migration 20261021000000_edit_delete_windows.sql — التنفيذ الحقيقى على الخادم، والواجهة بتعكسه):
//  • الإعلان: التعديل والحذف خلال 24 ساعة من **أول نشر** (موافقة الأدمن). بعدها الحذف للمشرفين فقط. قبل النشر (قيد المراجعة/مرفوض) بلا مدة.
//  • الطلب: الحذف خلال 24 ساعة من وقت عرضه. بعدها للمشرفين.
export const OWNER_WINDOW_MS = 24 * 60 * 60 * 1000;

export type WindowState = {
  /** هل الإعلان اتنشر فعلًا (بدأت المدة)؟ */
  published: boolean;
  /** المدة المتبقية بالمللى ثانية (null = لم تبدأ بعد، أى مفتوحة). */
  remainingMs: number | null;
  /** يقدر صاحبه يعدّل / يحذف دلوقتى؟ */
  editable: boolean;
  deletable: boolean;
};

export function adWindow(
  ad: { createdAt: number; publishedAt?: number; moderationStatus?: "pending" | "approved" | "rejected" },
  now: number = Date.now()
): WindowState {
  // publishedAt بيجى من الخادم. لو مش موجود (قاعدة بيانات قديمة قبل الـ migration): المنشور = approved بوقت الإنشاء كبديل،
  // وقيد المراجعة/المرفوض = لم يُنشر.
  const base = ad.publishedAt ?? (ad.moderationStatus === "pending" || ad.moderationStatus === "rejected" ? undefined : ad.createdAt);
  if (base === undefined) return { published: false, remainingMs: null, editable: true, deletable: true };
  const remainingMs = base + OWNER_WINDOW_MS - now;
  const open = remainingMs > 0;
  return { published: true, remainingMs: Math.max(0, remainingMs), editable: open, deletable: open };
}

export function requestWindow(createdAt: number, now: number = Date.now()): { deletable: boolean; remainingMs: number } {
  const remainingMs = createdAt + OWNER_WINDOW_MS - now;
  return { deletable: remainingMs > 0, remainingMs: Math.max(0, remainingMs) };
}

/** «5 س 20 د» / «45 د» / "5h 20m" — للعرض داخل الكروت والقوائم. */
export function formatRemaining(ms: number, language: string): string {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ar = language !== "en";
  if (h <= 0) return ar ? `${m} د` : `${m}m`;
  if (m === 0) return ar ? `${h} س` : `${h}h`;
  return ar ? `${h} س ${m} د` : `${h}h ${m}m`;
}
