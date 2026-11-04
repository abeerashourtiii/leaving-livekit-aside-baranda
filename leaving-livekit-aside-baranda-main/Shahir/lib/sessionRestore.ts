import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { isSystemRestore } from "./launchInfo";

// ↔ استئناف التطبيق من حيث توقف بعد الخروج منه (زى يوتيوب).
//
// المشكلة: لما التطبيق يفضل فى الخلفية دقائق، أندرويد/آيفون ممكن يقتل عملية التطبيق لتوفير الذاكرة (مع إنه لسه ظاهر فى قايمة
// التطبيقات المفتوحة). فعند الرجوع بيحصل «تشغيل من الصفر» (فيديو الإقلاع ثم الصفحة الرئيسية) وتضيع الصفحة اللى كان فيها المستخدم.
// الحل: بنحفظ آخر صفحة مفتوحة (المسار + الباراميترات) وآخر ريل متشاف، ولو التطبيق اتفتح من جديد خلال RESUME_WINDOW_MS بنرجّع
// المستخدم لنفس الصفحة مباشرة (من غير فيديو الإقلاع). لو العملية لسه عايشة فمفيش أى إعادة تشغيل أصلًا (الحالة محفوظة فى الذاكرة).
// الويب: المتصفح بيحافظ على الرابط بنفسه، فالميزة دى للموبايل فقط.
//
// مدة الاحتفاظ (غيّرها من هنا): 12 ساعة.
export const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;
// فلتر الريلز بيتصفّر لو غاب المستخدم عن التطبيق أكتر من المدة دى (قبل كده كان بيتصفّر بمجرد الخروج).
export const FILTER_RESET_AFTER_MS = 30 * 60 * 1000;

const ROUTE_KEY = "baranda:resume:route";
const REEL_KEY = "baranda:resume:reel";

// صفحات ما ينفعش نرجّع لها: شاشة الدخول والتفعيل (فيها توكن/حالة مؤقتة)، والبث المباشر، وإكمال البيانات الإجبارى.
const NOT_RESUMABLE = ["/auth-callback", "/auth-email", "/reset-password", "/live", "/coming-soon", "/invoice", "/promotion-invoice"];

export function isResumable(href: string | null | undefined): href is string {
  if (!href) return false;
  if (href === "/" || href === "") return false;
  if (/onboarding=1/.test(href)) return false;
  return !NOT_RESUMABLE.some((p) => href === p || href.startsWith(p + "/") || href.startsWith(p + "?"));
}

type Saved = { href: string; savedAt: number };

export async function saveResumeRoute(href: string): Promise<void> {
  if (Platform.OS === "web" || !isResumable(href)) return;
  try {
    await AsyncStorage.setItem(ROUTE_KEY, JSON.stringify({ href, savedAt: Date.now() } satisfies Saved));
  } catch { /* التخزين مش متاح — مفيش استئناف بس التطبيق شغّال عادى */ }
}

// ↔ الاستئناف مسموح فقط لو التشغيل ده «استعادة من النظام» (فتح من قائمة التطبيقات المفتوحة — lib/launchInfo.ts). بعد الإغلاق النهائى
// (السحب من القائمة) وفتح التطبيق من الأيقونة: نمسح الحالة المحفوظة ونبدأ من صفحة الريلز الرئيسية. بتتحسب مرة واحدة لكل تشغيل.
let allowedOnce: Promise<boolean> | null = null;
function resumeAllowed(): Promise<boolean> {
  if (!allowedOnce) {
    allowedOnce = (async () => {
      const ok = await isSystemRestore();
      if (!ok) await clearResumeState();
      return ok;
    })();
  }
  return allowedOnce;
}

// آخر صفحة محفوظة لو لسه فى المدة (من غير ما نمسحها).
export async function peekResumeRoute(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    if (!(await resumeAllowed())) return null;
    const raw = await AsyncStorage.getItem(ROUTE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (!s?.href || !s.savedAt || Date.now() - s.savedAt > RESUME_WINDOW_MS) return null;
    return isResumable(s.href) ? s.href : null;
  } catch {
    return null;
  }
}

// آخر ريل شاهده المستخدم فى تبويب الريلز.
export async function saveResumeReel(propertyId: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await AsyncStorage.setItem(REEL_KEY, JSON.stringify({ href: propertyId, savedAt: Date.now() } satisfies Saved));
  } catch { /* تجاهل */ }
}

export async function peekResumeReel(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    if (!(await resumeAllowed())) return null;
    const raw = await AsyncStorage.getItem(REEL_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (!s?.href || !s.savedAt || Date.now() - s.savedAt > RESUME_WINDOW_MS) return null;
    return s.href;
  } catch {
    return null;
  }
}

// الاستئناف بيحصل مرة واحدة لكل تشغيل من الصفر (بعدها التنقل العادى).
let routeRestoredOnce = false;
export function shouldRestoreRouteNow(): boolean {
  if (routeRestoredOnce) return false;
  routeRestoredOnce = true;
  return true;
}
let reelRestoredOnce = false;
export function shouldRestoreReelNow(): boolean {
  if (reelRestoredOnce) return false;
  reelRestoredOnce = true;
  return true;
}

// ↔ عند تسجيل الخروج/حذف الحساب نمسح آخر صفحة وآخر ريل من الجهاز (خصوصية — مفيش استئناف لحساب سابق).
export async function clearResumeState(): Promise<void> {
  try { await AsyncStorage.multiRemove([ROUTE_KEY, REEL_KEY]); } catch { /* تجاهل */ }
}
