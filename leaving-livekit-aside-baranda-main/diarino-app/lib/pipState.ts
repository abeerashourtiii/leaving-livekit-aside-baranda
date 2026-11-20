import { useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

// ↔ حالة "التطبيق فى وضع الصورة العائمة (PiP) دلوقتي" — مخزن مشترك صغير.
// بتتحدّث من أحداث onPictureInPictureStart/Stop بتاعة VideoView (ReelVideoPlayer.tsx).
// بتتستخدم فى شاشة الريلز عشان لما نافذة PiP تصغّر الشاشة:
//   * ارتفاع الريل (useReelHeight) يفضل ثابت — لو اتغيّر FlatList بيعيد حساب مكانه وبيقفز لريل
//     تانى فيتبدّل الريل النشط ويتوقف اللى بيشتغل فى النافذة العائمة؛
//   * تغيّر الريل النشط (onViewableItemsChanged) يتجاهَل طول مدة PiP.
// وبنصفّرها كمان لما التطبيق يرجع (AppState = active) لو حدث الإيقاف ما وصلش للـ JS
// (مثلًا الـ VideoView اللى بدأت PiP اتفكّت من الشاشة وهى فى النافذة العائمة).
let active = false;
const listeners = new Set<() => void>();

export function setPiPActive(next: boolean) {
  if (active === next) return;
  active = next;
  listeners.forEach((l) => l());
}

// ↔ هل التطبيق فى الواجهة الآن؟ بنستخدمها بعد انتهاء PiP للتفرقة بين حالتين:
//   • المستخدم ضغط «توسيع» (رجوع للتطبيق) ← التطبيق بيبقى فى الواجهة ← الريل يكمّل.
//   • المستخدم ضغط «إغلاق ✕» على النافذة العائمة ← التطبيق بيفضل فى الخلفية ← الريل لازم
//     يقف بصوته (زى يوتيوب). الويب: بنقرا visibilityState بدل AppState.
export function isAppForeground(): boolean {
  if (Platform.OS === "web") {
    return typeof document === "undefined" || document.visibilityState === "visible";
  }
  return AppState.currentState === "active";
}

export function isPiPActive() {
  return active;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function usePiPActive(): boolean {
  return useSyncExternalStore(subscribe, () => active, () => false);
}

// ↔ «مسلَّح»: فيه ريل نشط ومتوقّع إن الخروج من التطبيق هيفتح النافذة العائمة (PiP تلقائى مفعّل). بنعدّها (counter) لأن أكتر من
// مشغّل فيديو بيكون محمّل (الريل النشط ± 3) وكل واحد بيسجّل/يلغى لنفسه — فلازم الريل القديم اللى بيتفك ما يلغيش تسجيل الجديد.
let armedCount = 0;
export function registerPiPArmed(delta: 1 | -1) {
  armedCount = Math.max(0, armedCount + delta);
}

// ↔ لما التطبيق يخرج من الواجهة (Home) والـ PiP مسلَّح على أندرويد، النافذة العائمة بتعرض واجهة التطبيق (لو الجلسة native ما اشتغلتش
// لأى سبب) — فنعتبره «PiP» فورًا: usePiPActive() = true فتختفى كل الأزرار ويفضل الفيديو لوحه، من غير ما نستنى حدث من native.
// بنرجّع false أول ما التطبيق يرجع للواجهة (التوسيع) كما كان.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    setPiPActive(false);
  } else if (Platform.OS === "android" && armedCount > 0) {
    setPiPActive(true);
  }
});
