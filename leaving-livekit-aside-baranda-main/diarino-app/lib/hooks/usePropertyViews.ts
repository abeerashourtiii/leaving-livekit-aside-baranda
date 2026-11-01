import { supabase } from "../supabase";

// ↔ تسجيل «مشاهدة» لإعلان (للوحة الأدمن: إجمالي المشاهدات): الدالة public.increment_property_views
// (20261028000000_property_views_tracking.sql) بتحسب مرة واحدة لكل (مستخدم، إعلان، يوم) وتتجاهل صاحب الإعلان، فالاستدعاء المتكرر آمن.
// بنحتفظ كمان بقائمة محلية لهذه الجلسة عشان ما نبعتش طلب كل ما الريل يرجع نشط.
const seen = new Set<string>();

export function recordPropertyView(propertyId: string): void {
  if (!propertyId || seen.has(propertyId)) return;
  seen.add(propertyId);
  supabase.rpc("increment_property_views", { p_property_id: propertyId }).then(({ error }) => {
    if (error) {
      seen.delete(propertyId); // نسمح بمحاولة تانية لاحقًا
      console.warn("Failed to record property view:", error.message);
    }
  });
}
