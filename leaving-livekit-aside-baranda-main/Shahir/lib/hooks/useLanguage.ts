import { useSyncExternalStore, useCallback, useEffect } from "react";
import { Alert, I18nManager, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";
import { I18N_DICT } from "../../data/i18n-dict";
import { I18N_EXACT } from "../../data/i18n-exact";

// ↔ currentLang / toggleLanguage() / translateText() / applyLanguage() in
// app-viewer.html — see the earlier note in this file's history for why
// this is a key-based t() store rather than a DOM text-walker.
//
// RTL: only Arabic is RTL here (single-language-pair app), English is LTR.
// I18nManager.forceRTL() changes the setting immediately but does NOT
// re-layout anything already mounted — native only applies it on next
// launch. So toggling to a language that needs the opposite direction:
//  1. persists the choice
//  2. flips I18nManager's RTL flag
//  3. reloads the app (expo-updates) so the new layout direction is real
// If the direction doesn't actually change (rare, kept generic for a
// possible future RTL language), no restart happens — text just updates.

export type Language = "ar" | "en";

const RTL_LANGUAGES: Language[] = ["ar"];
function isRTLLanguage(lang: Language) {
  return RTL_LANGUAGES.includes(lang);
}

// ↔ الويب: اتجاه الصفحة بيتحدد بخاصية dir/lang على <html> (مش I18nManager ولا إعادة تشغيل).
// السبب: على الويب I18nManager.isRTL دايمًا false، فكود «اضبط RTL ثم أعد التشغيل» كان بيشوف إن الاتجاه ما اتغيّرش وبيعمل
// window.location.reload() (Updates.reloadAsync على الويب) فى كل تحميل ← حلقة إعادة تحميل لا نهائية (شاشة خضراء تتكرر عند فتح
// أى رابط مشاركة). الحل: على الويب ما فيش reload أبدًا؛ بنضبط dir مباشرة.
function applyWebDirection(lang: Language) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const el = document.documentElement;
  el.lang = lang;
  el.dir = isRTLLanguage(lang) ? "rtl" : "ltr";
}

// ↔ حارس ضد حلقة إعادة التشغيل على الموبايل: لو اتعمل reload خلال آخر 30 ثانية ولسه الاتجاه مش متطابق، ما نعيدش تانى.
const RELOAD_GUARD_KEY = "diarino:rtl_reload_at";
async function reloadAllowed(): Promise<boolean> {
  try {
    const at = Number((await AsyncStorage.getItem(RELOAD_GUARD_KEY)) ?? 0);
    if (Date.now() - at < 30_000) return false;
    await AsyncStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch { /* تجاهل */ }
  return true;
}

let language: Language = "ar";
const listeners = new Set<() => void>();
const STORAGE_KEY = "diarino:language";
let hydrationStarted = false;

function emit() {
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  return language;
}

// Text-only change, no restart — used at startup and for same-direction switches.
export function setLanguage(lang: Language) {
  language = lang;
  applyWebDirection(lang);
  emit();
  AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
}

async function applyRestartAndSetLanguage(lang: Language) {
  await AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
  I18nManager.allowRTL(isRTLLanguage(lang));
  I18nManager.forceRTL(isRTLLanguage(lang));
  try {
    await Updates.reloadAsync();
  } catch {
    // Not running under expo-updates (e.g. plain Expo Go, or a dev
    // environment without OTA configured) — can't reload programmatically.
    language = lang;
    emit();
    Alert.alert(
      "أعد تشغيل التطبيق",
      "من فضلك أغلق التطبيق وافتحه من جديد لإتمام تغيير اتجاه الشاشة."
    );
  }
}

// ↔ #7: خطوة مشتركة بين toggleLanguage() (لسه موجودة لأي كود تاني بيعتمد
// عليها) وchangeLanguage() الجديدة (تحديد لغة معينة صراحةً بدل التبديل
// العكسي) — كلاهما لازم يمرّ بنفس منطق "محتاج إعادة تشغيل ولا لأ".
function requestLanguageChange(next: Language) {
  if (next === language) return; // ↔ #7: اختيار نفس اللغة الحالية — لا شيء يتغيّر
  // الويب: مفيش إعادة تشغيل — dir بيتغيّر مباشرة (applyWebDirection).
  const needsRestart = Platform.OS !== "web" && I18nManager.isRTL !== isRTLLanguage(next);

  if (!needsRestart) {
    setLanguage(next);
    return;
  }

  Alert.alert(
    "تغيير اللغة",
    "سيتم إعادة تشغيل التطبيق لتطبيق اتجاه الشاشة الصحيح.",
    [
      { text: "إلغاء", style: "cancel" },
      { text: "متابعة", onPress: () => { applyRestartAndSetLanguage(next); } },
    ]
  );
}

export function toggleLanguage() {
  const next: Language = language === "ar" ? "en" : "ar";
  requestLanguageChange(next);
}

// ↔ #7: شاشة الإعدادات دلوقتي بتعرض الاختيارين (العربية / English) صراحةً
// مع علامة صح بجوار اللغة المستخدمة حاليًا، بدل ما يكون فيه زرار تبديل
// واحد بس. هذه هي الدالة اللي بيستخدمها ذلك الاختيار الصريح.
export function changeLanguage(lang: Language) {
  requestLanguageChange(lang);
}

// Sorted longest-key-first so multi-word phrases match before their
// individual words would.
const SORTED_KEYS = Object.keys(I18N_DICT).sort((a, b) => b.length - a.length);

// ↔ translateText(): exact match first; otherwise substitute any dictionary
// phrases found inside a longer composed string (e.g. "📍 الشيخ زايد").
export function translate(text: string): string {
  if (!text) return text;
  if (I18N_DICT[text]) return I18N_DICT[text];
  if (I18N_EXACT[text]) return I18N_EXACT[text];
  let out = text;
  for (const key of SORTED_KEYS) {
    if (out.indexOf(key) !== -1) {
      out = out.split(key).join(I18N_DICT[key]);
    }
  }
  // ↔ علامات الترقيم العربية اللى بتفضل فى الجمل المركّبة: ؟ ، → ? ,
  // (وإلا يفضل "حرف عربى" واحد فى نص إنجليزى كامل).
  return out.replace(/\u061F/g, "?").replace(/\u060C/g, ",");
}

export function useLanguage() {
  const lang = useSyncExternalStore(subscribe, getSnapshot);
  const t = useCallback((text: string) => (lang === "en" ? translate(text) : text), [lang]);

  useEffect(() => {
    if (hydrationStarted) return;
    hydrationStarted = true;
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === "ar" || saved === "en") {
        language = saved;
        applyWebDirection(saved);
        emit();
      }
    }).catch(() => {});
  }, []);

  return { language: lang, setLanguage, toggleLanguage, changeLanguage, t };
}

// Exported for app/_layout.tsx's startup sequence — applies the correct RTL
// setting for the persisted language BEFORE first paint, with no restart
// needed since nothing has rendered yet.
export async function applyPersistedRTLAtStartup() {
  const saved = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  const lang: Language = saved === "en" ? "en" : "ar";
  language = lang;
  // ↔ الويب: نضبط dir/lang بس — بدون forceRTL ولا reload (كان سبب حلقة التحميل الدائم).
  if (Platform.OS === "web") {
    applyWebDirection(lang);
    return;
  }
  const wantsRTL = isRTLLanguage(lang);
  if (I18nManager.isRTL !== wantsRTL) {
    I18nManager.allowRTL(wantsRTL);
    I18nManager.forceRTL(wantsRTL);
    // First-ever launch (or a launch right after the native RTL flag
    // itself changed): still needs one reload for native to pick it up.
    try {
      if (!(await reloadAllowed())) return; // حارس: ما نعيدش التشغيل فى حلقة
      await Updates.reloadAsync();
    } catch {
      // No expo-updates runtime available — fall back to whatever
      // I18nManager already had; the persisted preference will still
      // apply correctly starting from the *next* cold start.
    }
  }
}
