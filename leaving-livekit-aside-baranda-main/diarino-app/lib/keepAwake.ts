// ↔ منع الشاشة من الانطفاء أثناء عملية طويلة (ضغط + رفع فيديو) وأثناء تشغيل الريل (زى يوتيوب) — لو الشاشة نامت
// وأندرويد حط التطبيق فى الخلفية ممكن الضغط/الرفع يتوقف أو ينقطع. بنستخدم
// expo-keep-awake لو متركّب؛ لو مش متركّب بنتجاهل بهدوء (الرفع بيشتغل عادي).
type KeepAwakeModule = {
  activateKeepAwakeAsync?: (tag?: string) => Promise<void>;
  deactivateKeepAwake?: (tag?: string) => Promise<void> | void;
};

const TAG = "baranda-upload"; // الوسم الافتراضى (الرفع). مشغّل الريل بيستخدم وسمًا خاصًا لكل مشغّل.

function load(): KeepAwakeModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-keep-awake") as KeepAwakeModule;
  } catch {
    return null;
  }
}

export function acquireKeepAwake(tag: string = TAG): void {
  try {
    load()?.activateKeepAwakeAsync?.(tag)?.catch?.(() => {});
  } catch {
    /* ignore */
  }
}

export function releaseKeepAwake(tag: string = TAG): void {
  try {
    const r = load()?.deactivateKeepAwake?.(tag);
    (r as Promise<void> | undefined)?.catch?.(() => {});
  } catch {
    /* ignore */
  }
}
