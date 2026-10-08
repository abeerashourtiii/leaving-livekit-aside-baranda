// lib/guestGate.ts
//
// ↔ الضيف ("المتابعة كضيف" = جلسة Supabase مجهولة is_anonymous) يتصفح فقط:
// ممنوع ينشر عقار (انشر عقارك) أو يطلب عقار (اطلب عقارك). أى محاولة بتودّيه
// لصفحة التسجيل (جوجل / إنشاء حساب بالبريد / تسجيل الدخول) مع رسالة واضحة
// بتظهر فى الصفحة نفسها (app/index.tsx ← param `notice`) — بدل Alert.alert اللى
// مبيشتغلش على الويب.
//
// الحماية على 3 مستويات:
//   1) نقطة الدخول: كروت القائمة (app/(tabs)/menu.tsx).
//   2) الشاشات نفسها: app/publish/_layout.tsx بيغطّى create-listing و
//      create-request من أى مدخل (مسودات، تعديل إعلان، رابط مباشر).
//   3) الخادم: migration 20261007000000_block_guest_publish.sql (RLS) —
//      الجزء اللى عميل معدّل مايقدرش يلفّ عليه.
import { router } from "expo-router";
import { signOut } from "./hooks/useAuth";

export const GUEST_PUBLISH_NOTICE = "guest_publish";

let redirecting = false;

// بنقفل جلسة الضيف الأول: شاشة الدخول (app/index.tsx) بتحوّل أى جلسة موجودة
// (حتى المجهولة) مباشرة للتبويبات، فمن غير signOut الضيف ماكانش هيشوف صفحة
// التسجيل أصلًا. (نفس اللى بيعمله زر "تسجيل الدخول" فى الإعدادات للضيف.)
export async function redirectGuestToLogin(notice: string = GUEST_PUBLISH_NOTICE): Promise<void> {
  if (redirecting) return;
  redirecting = true;
  try {
    await signOut();
    router.replace({ pathname: "/", params: { notice } });
  } finally {
    // تأخير بسيط عشان ضغطتين متتاليتين ما يعملوش signOut مرتين.
    setTimeout(() => { redirecting = false; }, 800);
  }
}
