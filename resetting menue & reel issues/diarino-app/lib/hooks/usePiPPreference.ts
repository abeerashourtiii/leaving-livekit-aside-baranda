import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ↔ "عرض التطبيق فوق التطبيقات الأخرى" (Picture-in-Picture زي يوتيوب) — تظهر فى مكانين:
// app/settings.tsx وقايمة خيارات الريل (ReelOptionsSheet.tsx)، وكلاهما لازم يعكسوا نفس
// التفضيل المُخزَّن، فده مخزن واحد مشترك زي useTheme/useLanguage.
//
// ↔ الخاصية بقت *مفعّلة افتراضيًا* لكل المستخدمين (أندرويد/آيفون/ويب/APK)، والمستخدم
// يقدر يلغي تفعيلها من الإعدادات أو من قايمة خيارات الريل — وقتها بيتخزّن "declined".
// مفتاح التخزين اتغيّر لـ v2 عمدًا: القيمة القديمة "declined" كانت بتتسجّل بزر "ليس الآن"
// فى نافذة التفعيل القديمة (وقت ما الخاصية ماكانتش مفعّلة افتراضيًا) فمش اختيار صريح
// بالإلغاء؛ فمحدّش بيفضل عالق على "غير مفعّل" من غير ما يختار ده بنفسه بعد التحديث.
// "unset" محتفظ بيه فى النوع للتوافق بس، ومعامَل كمفعّل.
export type PiPPreference = "unset" | "enabled" | "declined";

const STORAGE_KEY = "diarino:pipPreference:v2";

let preference: PiPPreference = "enabled"; // ↔ الافتراضي: مفعّلة
let snapshot: { preference: PiPPreference } = { preference };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { preference };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
  if (saved === "enabled" || saved === "declined") {
    preference = saved;
    emit();
  }
});

export function usePiPPreference() {
  const { preference: pref } = useSyncExternalStore(subscribe, getSnapshot);

  function setPreference(next: PiPPreference) {
    preference = next;
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    emit();
  }

  return { preference: pref, setPreference };
}
