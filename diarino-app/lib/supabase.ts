import "react-native-url-polyfill/auto";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { createClient } from "@supabase/supabase-js";
import { Database } from "../src/types/supabase";

const expoExtra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
const getExpoExtraString = (key: string): string | undefined => {
  const value = expoExtra?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? getExpoExtraString("supabaseUrl");
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  getExpoExtraString("supabaseAnonKey") ??
  getExpoExtraString("supabasePublishableKey");

function isValidSupabaseUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname;
  } catch {
    return false;
  }
}

function isPlaceholder(value: string | undefined): boolean {
  return !value || /PASTE_|REPLACE_ME|YOUR_/i.test(value);
}

const hasValidConfiguration =
  isValidSupabaseUrl(SUPABASE_URL) &&
  !isPlaceholder(SUPABASE_URL) &&
  !isPlaceholder(SUPABASE_ANON_KEY);

export const supabaseConfigurationError = hasValidConfiguration
  ? null
  : "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to valid project values.";

export const isSupabaseConfigured = hasValidConfiguration;

// Keep imports safe so the app can show setup instructions instead of crashing
// before React mounts. RootLayout prevents app features from using this client
// until real project credentials are available.
const clientUrl = SUPABASE_URL ?? "https://configuration-required.invalid";
const clientAnonKey = SUPABASE_ANON_KEY ?? "configuration-required-anon-key";

let authClient: ReturnType<typeof createClient<Database>> | null = null;
let refreshFailureHandled = false;
// ↔ إصلاح «تعليق تسجيل الدخول / الاضطرار لإعادة الدخول أكثر من مرة»: فشل تجديد جلسة *قديمة* كان بيعمل signOut محلى
// حتى لو وصل ردّه بعد ما المستخدم دخل بحساب جديد (مثلًا بعد تبديل حساب جوجل) — فكان بيطيّر الجلسة الجديدة وترجع شاشة الدخول.
// authEpoch بيزيد مع كل دخول/خروج، وبنتجاهل فشل التجديد لو الجلسة اتغيّرت وقت ما الطلب كان شغّال.
let authEpoch = 0;

// ↔ إصلاح: طلبات الحفظ كانت بترجع 401/42501 (RLS) لأن تجديد الجلسة
// (refresh token) كان بيفشل بشكل متكرر ومتلاحق (رصدنا فى الـ console
// عشرات محاولات إعادة المحاولة السريعة على /auth/v1/token، لحد ما
// Supabase رجّع 429 Too Many Requests بسبب الحد الأقصى لمعدل الطلبات).
// كل كود سابق كان بيتعامل بس مع 400/401 على التجديد؛ 429 كان بيتجاهله
// تمامًا فيسيب المؤقت الداخلي لـ supabase-js يحاول يجدد تاني وتاني بسرعة
// من غير أي مهلة — عاصفة طلبات تتصاعد لحد الحظر المؤقت. دلوقتي أي 429
// على التجديد بيتم تسجيله برضه كفشل (زي 400/401 بالظبط) عشان يوقف
// المحاولات المتلاحقة فورًا بدل ما يسيبها تتصاعد.
const REFRESH_FAILURE_STATUSES = new Set([400, 401, 429]);

const fetchWithAuthRecovery: typeof fetch = async (input, init) => {
  const epochAtStart = authEpoch;
  const response = await fetch(input, init);
  const requestUrl = typeof input === "string"
    ? input
    : typeof Request !== "undefined" && input instanceof Request
      ? input.url
      : String(input);
  const isRefreshRequest = requestUrl.includes("/auth/v1/token?grant_type=refresh_token");

  // A rejected refresh token must not be retried forever by the auth timer.
  // Clear only the local session; the next explicit login can establish a new one.
  if (isRefreshRequest && REFRESH_FAILURE_STATUSES.has(response.status)) {
    if (epochAtStart !== authEpoch) {
      // جلسة جديدة اتكوّنت أثناء الطلب — الفشل يخص الجلسة القديمة فقط، فلا نمس الجلسة الحالية.
      return response;
    }
    if (!refreshFailureHandled) {
      refreshFailureHandled = true;
      void authClient?.auth.signOut({ scope: "local" });
    }
  } else if (isRefreshRequest && response.ok) {
    refreshFailureHandled = false;
  }

  return response;
};

export const supabase = (authClient = createClient<Database>(clientUrl, clientAnonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithAuthRecovery },
}));

// ↔ callback متزامن بدون أى نداء لـ supabase جواه (علشان ما يحصلش deadlock على قفل الجلسة).
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
    authEpoch += 1;
    // دخول جديد = نبدأ من صفحة نظيفة: لو التجديد فشل قبل كده ما نمنعش التعامل مع فشل جديد لاحقًا.
    if (event === "SIGNED_IN") refreshFailureHandled = false;
  }
});

// ↔ أندرويد/آيفون: المؤقّت الداخلى لتجديد الجلسة لازم يشتغل والتطبيق ظاهر فقط. بدون ده، بعد ما التطبيق يقعد فى الخلفية
// فترة كانت أول الطلبات بتطلع بتوكن منتهى (بيانات فاضية / RLS) لحد ما التطبيق يتقفل ويتفتح. (توصية Supabase الرسمية للـ React Native.)
if (Platform.OS !== "web" && isSupabaseConfigured) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}