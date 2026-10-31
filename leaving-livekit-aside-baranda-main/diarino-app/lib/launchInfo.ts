import { NativeModules, Platform } from "react-native";

// ↔ هل التشغيل الحالى «استعادة من النظام» (فتح من قائمة التطبيقات المفتوحة بعد ما النظام قتل العملية لتوفير الذاكرة)، ولا تشغيل
// جديد بعد إغلاق نهائى (سحب التطبيق من القائمة) وفتحه من الأيقونة؟ المصدر: وحدة native اسمها BarandaLaunchInfo
//   • أندرويد: android/app/src/main/java/com/diarino/app/LaunchInfo.kt (savedInstanceState / FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)
//   • آيفون: ios/Baranda/AppDelegate.mm (OS state restoration — أبل بتمسح الحالة عند الإغلاق بالسحب)
// الاستخدام: lib/sessionRestore.ts — الصفحة/الريل المحفوظين بيتستخدموا بس لو الجواب true، وإلا بيتمسحوا والتطبيق يبدأ من الرئيسية.
// لو الوحدة مش موجودة (Expo Go / نسخة قديمة) أو الويب ← false (بداية جديدة، وهو الأأمن).
//
// تحقق فعلى على آيفون مطلوب. لو الاستئناف ما اشتغلش على iOS (مثلًا آيفون ما استدعاش callbacks الاستعادة) خلّي القيمة دى false
// فيرجع استئناف iOS كل ما فتح التطبيق خلال 12 ساعة (السلوك السابق) بدل ما يبدأ دايمًا من الرئيسية.
export const IOS_USE_RESTORE_SIGNAL = true;

let cached: Promise<boolean> | null = null;

export function isSystemRestore(): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(false);
  if (!cached) {
    cached = (async () => {
      try {
        if (Platform.OS === "ios" && !IOS_USE_RESTORE_SIGNAL) return true;
        const mod = (NativeModules as { BarandaLaunchInfo?: { isSystemRestore?: () => Promise<boolean> } }).BarandaLaunchInfo;
        if (!mod?.isSystemRestore) return false;
        return !!(await mod.isSystemRestore());
      } catch {
        return false;
      }
    })();
  }
  return cached;
}
