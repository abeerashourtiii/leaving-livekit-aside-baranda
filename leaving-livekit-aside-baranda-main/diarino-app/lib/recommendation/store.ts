// lib/recommendation/store.ts
//
// ↔ طبقة التشغيل لنظام التوصية («لك»): تحمّل/تحفظ ملف الاهتمامات (AsyncStorage على الموبايل، وlocalStorage على الويب عبر نفس الواجهة)
//   وتزامنه مع حساب المستخدم (جدول user_interest_profiles) ليتّسق بين الأجهزة، وتستقبل الإشارات من أى مكان فى التطبيق
//   (مشاهدة، إعجاب، تعليق، مشاركة، حفظ، متابعة، بحث). المنطق الحسابى كله فى engine.ts.
//
// الخصوصية: الملف مُلخّص (أوزان خصائص) لا سجل حركات؛ يُمسح بزر «إعادة ضبط التوصيات»، ويُوقَف بالكامل بمفتاح «تخصيص الريلز».
// عند إيقاف التخصيص لا تُسجَّل أى إشارات ولا يُستخدم الملف، ويرجع ترتيب الريلز العام (الأحدث أولًا).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { useSyncExternalStore } from "react";
import { supabase } from "../supabase";
import type { Json } from "../../src/types/supabase";
import { PROVINCES } from "../../data/locations";
import {
  InterestProfile, RecoProperty, SignalKind, SearchHint, WatchInfo,
  applySearch, applySellerFollow, applySignal, applyWatch, emptyProfile, parseProfile, pickNewer,
} from "./engine";

const ENABLED_KEY = "shahir:reco:enabled";
const profileKey = (uid: string | null) => `shahir:reco:profile:v1:${uid ?? "anon"}`;
const UPLOAD_DEBOUNCE_MS = 20_000;
const SAVE_DEBOUNCE_MS = 1_500;
const REGISTRY_MAX = 500;
const KNOWN_TYPES = ["شقة", "فيلا", "بنتهاوس", "تاون هاوس", "تجاري", "إداري", "طبي", "أرض", "دور", "استراحة", "مكتب", "محل"];

let enabled = true;
let userId: string | null = null;
let initializedFor: string | null | undefined; // undefined = لم يُهيَّأ بعد
let profile: InterestProfile = emptyProfile(Date.now());
let version = 0;
let dirtyRemote = false;
let remoteMissing = false; // الـ migration لم تُطبَّق: نتجاهل المزامنة بصمت
// ↔ إصلاح سباق تبديل الحساب: initToken بيزيد مع كل تهيئة جديدة، وأى تهيئة قديمة لسه فى انتظار await بتتوقف بدون ما تكتب شيء.
//   loadedFor = صاحب ملف profile المحمّل فى الذاكرة فعلًا (undefined أثناء التحميل): لا حفظ ولا رفع إلا لو == userId،
//   فمستحيل يُكتب/يُرفع ملف شخص تحت حساب شخص آخر.
let initToken = 0;
let loadedFor: string | null | undefined;
let uploadInFlight: Promise<void> | null = null;
// ↔ حذف الملف من الخادم المعلّق (فشل/لا اتصال): يُحفظ على الجهاز ويُعاد تلقائيًا، ويُمنع أى رفع قبل نجاحه.
const PENDING_DELETE_KEY = "shahir:reco:pending-delete:v1";
const pendingDeletes = new Set<string>();
const registry = new Map<string, RecoProperty>();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let uploadTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function getProfile(): InterestProfile { return profile; }
export function getRecommendationVersion(): number { return version; }
export function isPersonalizationEnabled(): boolean { return enabled; }
export function getRecommendationSeed(): number { return sessionSeed; }
// بذرة الاستكشاف: ثابتة طوال تشغيل التطبيق (فيتغيّر المزيج بين جلسة وأخرى لكن لا يتقلب أثناء التصفّح).
const sessionSeed = Math.floor(Math.random() * 2 ** 31);

export function useRecommendationVersion(): number {
  return useSyncExternalStore(subscribe, getRecommendationVersion, getRecommendationVersion);
}
export function usePersonalizationEnabled(): boolean {
  return useSyncExternalStore(subscribe, isPersonalizationEnabled, isPersonalizationEnabled);
}

// ───────────── التخزين ─────────────
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (loadedFor !== userId) return; // ملف الذاكرة ليس لصاحب الحساب الحالى (تبديل حساب أثناء التحميل)
    AsyncStorage.setItem(profileKey(userId), JSON.stringify(profile)).catch(() => {});
  }, SAVE_DEBOUNCE_MS);
}

function scheduleUpload() {
  if (!userId || remoteMissing) return;
  dirtyRemote = true;
  if (uploadTimer) return;
  uploadTimer = setTimeout(() => { uploadTimer = null; void uploadNow(); }, UPLOAD_DEBOUNCE_MS);
}

function uploadNow(): Promise<void> {
  const p = doUpload().finally(() => { if (uploadInFlight === p) uploadInFlight = null; });
  uploadInFlight = p;
  return p;
}

async function doUpload() {
  if (!userId || remoteMissing || !dirtyRemote) return;
  if (loadedFor !== userId) return; // لا نرفع إلا ملف صاحب الحساب الحالى
  if (pendingDeletes.has(userId)) return; // حذف سابق لم يكتمل على الخادم: لا نُعيد رفع شيء قبل نجاحه
  const uid = userId;
  const snapshot = profile;
  dirtyRemote = false;
  try {
    const { error } = await supabase
      .from("user_interest_profiles")
      .upsert({ user_id: uid, profile: snapshot as unknown as Json, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) {
      if ((error as { code?: string }).code === "42P01" || /user_interest_profiles/.test(error.message ?? "")) remoteMissing = true;
      else dirtyRemote = true;
    }
  } catch {
    dirtyRemote = true;
  }
}

/** يحفظ فورًا (عند الخروج للخلفية). */
export function flushRecommendation() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (loadedFor === userId) AsyncStorage.setItem(profileKey(userId), JSON.stringify(profile)).catch(() => {});
  if (uploadTimer) { clearTimeout(uploadTimer); uploadTimer = null; }
  void uploadNow();
}

function mergeAdd(base: InterestProfile, extra: InterestProfile) {
  for (const [k, v] of Object.entries(extra.w)) base.w[k] = (base.w[k] ?? 0) + v;
  for (const [k, v] of Object.entries(extra.seen)) if (!base.seen[k] || base.seen[k].t < v.t) base.seen[k] = v;
  base.n += extra.n;
  base.updatedAt = Math.max(base.updatedAt, extra.updatedAt);
}

// ───────────── الحذف المعلّق من الخادم ─────────────
async function loadPendingDeletes(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_DELETE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(list)) for (const id of list) if (typeof id === "string") pendingDeletes.add(id);
  } catch { /* لا شيء معلّق */ }
}
async function persistPendingDeletes(): Promise<void> {
  try {
    if (pendingDeletes.size) await AsyncStorage.setItem(PENDING_DELETE_KEY, JSON.stringify([...pendingDeletes]));
    else await AsyncStorage.removeItem(PENDING_DELETE_KEY);
  } catch { /* ignore */ }
}

/** يحذف صف الحساب من الخادم ويفحص { error } (supabase-js لا يرمى الخطأ بل يرجّعه). true = تم الحذف (أو لا يوجد جدول). */
async function deleteRemoteProfile(uid: string): Promise<boolean> {
  try {
    const { error } = await supabase.from("user_interest_profiles").delete().eq("user_id", uid);
    if (error) {
      if ((error as { code?: string }).code === "42P01" || /user_interest_profiles/.test(error.message ?? "")) { remoteMissing = true; }
      else return false;
    }
    if (pendingDeletes.delete(uid)) await persistPendingDeletes();
    return true;
  } catch {
    return false;
  }
}

/** يعيد محاولة حذف معلّق لهذا الحساب (يُستدعى عند فتح التطبيق/الرجوع للواجهة). */
async function retryPendingDelete(uid: string | null): Promise<boolean> {
  if (!uid || !pendingDeletes.has(uid) || remoteMissing) return true;
  const ok = await deleteRemoteProfile(uid);
  if (ok && userId === uid && profile.n > 0) scheduleUpload(); // إشارات جديدة بعد المسح تُرفع الآن
  return ok;
}

let appStateSub: { remove: () => void } | null = null;

/** يُستدعى عند معرفة المستخدم الحالى (ومرة عند البداية بدون مستخدم). آمن للتكرار. */
export async function initRecommendation(uid: string | null): Promise<void> {
  if (initializedFor === uid) return;
  const prevInit = initializedFor;
  // نحفظ ملف المستخدم السابق قبل التبديل (حتى لا يضيع — flush يتجاهل أى ملف غير محمّل لصاحبه)، ولا ننقل أبدًا بيانات
  // مستخدم لمستخدم آخر على نفس الجهاز: الدمج فقط للإشارات التى حدثت قبل معرفة المستخدم (أول تهيئة).
  if (prevInit !== undefined) flushRecommendation();
  const pendingMemory = (prevInit === undefined || prevInit === null) && profile.n > 0 ? profile : null;
  const token = ++initToken;
  initializedFor = uid;
  userId = uid;
  loadedFor = undefined; // الملف فى الذاكرة لا يخص هذا الحساب حتى يكتمل التحميل
  if (prevInit) profile = emptyProfile(Date.now()); // لا نُبقى ملف الحساب السابق فى الذاكرة أثناء تحميل الحساب الجديد
  // ↔ أى await قد يمرّ خلاله تبديل حساب آخر: بعد كل await نتأكد أننا ما زلنا التهيئة الحالية وإلا نخرج بدون أى كتابة.
  const stale = () => token !== initToken;
  try {
    const flag = await AsyncStorage.getItem(ENABLED_KEY);
    enabled = flag !== "0";
  } catch { /* الافتراضى: مفعّل */ }
  if (stale()) return;
  await loadPendingDeletes();
  if (stale()) return;
  const now = Date.now();
  let local = emptyProfile(now);
  try {
    const raw = await AsyncStorage.getItem(profileKey(uid));
    if (raw) local = parseProfile(raw, now);
  } catch { /* ملف تالف: نبدأ من جديد */ }
  if (stale()) return;
  if (pendingMemory && pendingMemory !== local) mergeAdd(local, pendingMemory);
  profile = local;
  loadedFor = uid;
  emit();

  if (!appStateSub) {
    appStateSub = AppState.addEventListener("change", (s) => {
      if (s !== "active") flushRecommendation();
      else void retryPendingDelete(userId);
    });
  }

  // حذف سابق لم يكتمل على الخادم (إعادة ضبط بلا اتصال): نكمله أولًا، وما دام فاشلًا لا نسحب ملف الخادم القديم ولا نرفع شيئًا.
  if (uid && pendingDeletes.has(uid)) {
    const done = await retryPendingDelete(uid);
    if (stale()) return;
    if (!done) return;
  }

  if (uid && enabled && !remoteMissing) {
    try {
      const { data, error } = await supabase.from("user_interest_profiles").select("profile, updated_at").eq("user_id", uid).maybeSingle();
      if (stale()) return;
      if (error) {
        if ((error as { code?: string }).code === "42P01" || /user_interest_profiles/.test(error.message ?? "")) remoteMissing = true;
      } else if (data?.profile) {
        const remote = parseProfile(data.profile, now);
        const winner = pickNewer(profile, remote);
        if (winner !== profile) { profile = winner; emit(); scheduleSave(); }
        else scheduleUpload();
      } else if (profile.n > 0) {
        scheduleUpload();
      }
    } catch { /* بدون شبكة: نكمل بالملف المحلى */ }
  }
}

// ───────────── التحكم من الإعدادات ─────────────
export async function setPersonalizationEnabled(next: boolean): Promise<void> {
  enabled = next;
  emit();
  try { await AsyncStorage.setItem(ENABLED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
}

/**
 * مسح ملف الاهتمامات بالكامل (محليًا وعلى الحساب).
 * remoteDeleted=false يعنى أن الحذف من الخادم فشل (لا اتصال مثلًا): الملف المحلى انمسح فعلًا، والحذف من الخادم معلّق
 * ويُعاد تلقائيًا عند فتح التطبيق/الرجوع إليه، ولا يُرفع أى ملف جديد قبل نجاحه، فلا يرجع الملف القديم على جهاز آخر.
 */
export async function resetRecommendationProfile(): Promise<{ remoteDeleted: boolean }> {
  const uid = userId;
  profile = emptyProfile(Date.now());
  emit();
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (uploadTimer) { clearTimeout(uploadTimer); uploadTimer = null; }
  dirtyRemote = false;
  try { await AsyncStorage.removeItem(profileKey(uid)); } catch { /* ignore */ }
  if (!uid || remoteMissing) return { remoteDeleted: true };
  // نسجّل الحذف كمعلّق أولًا (يمنع أى رفع)، وننتظر أى رفع جارٍ حتى لا يصل بعد الحذف ويُعيد إنشاء الصف.
  pendingDeletes.add(uid);
  await persistPendingDeletes();
  if (uploadInFlight) { try { await uploadInFlight; } catch { /* ignore */ } }
  const ok = await deleteRemoteProfile(uid);
  return { remoteDeleted: ok };
}

// ───────────── سجل العقارات (لتحويل id إلى خصائص) ─────────────
export function registerProperties(list: RecoProperty[]) {
  for (const p of list) {
    if (!p?.id) continue;
    registry.delete(p.id);
    registry.set(p.id, p);
  }
  while (registry.size > REGISTRY_MAX) {
    const first = registry.keys().next().value;
    if (first === undefined) break;
    registry.delete(first);
  }
}
export function getRegisteredProperty(id: string): RecoProperty | undefined { return registry.get(id); }

function touched() {
  scheduleSave();
  scheduleUpload();
  emit();
}
const isOwn = (p: RecoProperty) => !!userId && p.seller?.id === userId; // لا نتعلّم من إعلانات المستخدم نفسه

// ───────────── الإشارات ─────────────
export function trackWatch(p: RecoProperty, info: WatchInfo) {
  if (!enabled || isOwn(p)) return;
  registerProperties([p]);
  applyWatch(profile, p, info, Date.now());
  touched();
}

export function trackSignal(kind: SignalKind, target: RecoProperty | string) {
  if (!enabled) return;
  const p = typeof target === "string" ? registry.get(target) : target;
  if (!p || isOwn(p)) return;
  applySignal(profile, p, kind, Date.now());
  touched();
}

export function trackSellerFollow(sellerId: string, following: boolean) {
  if (!enabled || !sellerId || sellerId === userId) return;
  applySellerFollow(profile, sellerId, following, Date.now());
  touched();
}

export function trackSearch(hint: SearchHint) {
  if (!enabled) return;
  const types = new Set(KNOWN_TYPES);
  for (const p of registry.values()) if (p.type) types.add(p.type);
  const before = profile.n;
  applySearch(profile, hint, { types: [...types], provinces: PROVINCES as unknown as string[] }, Date.now());
  if (profile.n !== before) touched();
}
