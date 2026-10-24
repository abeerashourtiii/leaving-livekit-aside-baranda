import { Platform, I18nManager } from "react-native";

// ↔ إصلاح "الأيقونات الجانبية (إعجاب/مشاركة/مفضلة) بتظهر يمين بدل شمال
// فى العربي، بس على أندرويد/آيفون/الـ APK — شغّالة صح على الويب": باغ
// معروف فى React Native نفسها (خاصية I18nManager.doLeftAndRightSwapInRTL
// الافتراضية) — أي عنصر position:"absolute" وعليه left أو right حرفيًا
// بيتقلب تلقائيًا (left↔right) على المنصات الأصلية لما I18nManager.isRTL
// شغالة (زي ما بيحصل هنا لما اللغة عربي، شوف useLanguage.ts). التقليب ده
// خاصية Yoga (محرك التخطيط بتاع React Native نفسه) ومالوش أي علاقة بـ
// CSS الحقيقي، فـ react-native-web (اللي بيرندر CSS حقيقي فى المتصفح)
// مبيعملوش خالص — CSS مفيهوش تقليب تلقائي لـ left/right الحرفيين مع
// direction:rtl أصلاً (ده بالظبط سبب وجود خصائص CSS منطقية زي
// inset-inline-start فى المعيار). النتيجة: نفس كود isAr ? left : right
// كان بيدّي نتيجة مختلفة فعليًا بين المنصتين.
//
// الحل: physicalSide() بتحسب مقدّمًا أنهي property حرفي (left/right)
// لازم يتكتب فعليًا فى الكود عشان الناتج المرئي النهائي — بعد أي تقليب
// تلقائي محتمل من Yoga على المنصات الأصلية — يطابق الجهة المطلوبة فعلاً
// على المنصتين مع بعض.
export function physicalSide(wantLeftVisually: boolean): "left" | "right" {
  const nativeWillAutoSwap = Platform.OS !== "web" && I18nManager.isRTL;
  const useLeftProp = wantLeftVisually !== nativeWillAutoSwap; // XOR
  return useLeftProp ? "left" : "right";
}

// ↔ اتجاه صف (flexDirection) بحيث *أول عنصر* فى الصف يقع على الجهة المرئية المطلوبة ("left" | "right")،
// على كل المنصات: على أندرويد/آيفون/APK لما I18nManager.isRTL شغّالة (العربى) الـ row بيبدأ من اليمين
// تلقائيًا، وعلى الويب (من غير قلب تلقائى) بيبدأ من الشمال. نفس منطق physicalSide() لكن للـ flex row.
export function rowStartingAt(side: "left" | "right"): "row" | "row-reverse" {
  const naturalStartIsRight = Platform.OS !== "web" && I18nManager.isRTL;
  return (side === "right") === naturalStartIsRight ? "row" : "row-reverse";
}

// ↔ جهة أزرار الشريط العلوى (الجرس ثم الفلتر) حسب لغة التطبيق: العربية → أعلى اليمين، الإنجليزية → أعلى الشمال.
export function topActionsSide(language: "ar" | "en"): "left" | "right" {
  return language === "ar" ? "right" : "left";
}
