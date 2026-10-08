import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabase";
import { queryClient } from "../queryClient";
import { resetAdminDB } from "./useAdminDB";
import { clearCompareSelection } from "./useCompareSelection";
import { getAuthSnapshot } from "./useCurrentUser";

const SKIP_KEY = "diarino:skip_auth";

let callbackSessionPromise: Promise<{ error: string | null }> | null = null;
let callbackUrl: string | null = null;
let intentionalSignOut = false;

export function consumeIntentionalSignOut(): boolean {
  const value = intentionalSignOut;
  intentionalSignOut = false;
  return value;
}

WebBrowser.maybeCompleteAuthSession();

export function translateOAuthError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("popup") && m.includes("closed")) return "تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.";
  if (m.includes("popup") && m.includes("block")) return "المتصفح منع النافذة المنبثقة. فعّل النوافذ لهذا الموقع وحاول مجدداً.";
  if (m.includes("unsupported provider") || m.includes("provider is not enabled"))
    return "مزوّد Google غير مفعّل في الخلفية. راجع إعدادات OAuth.";
  if (m.includes("redirect") && (m.includes("uri") || m.includes("mismatch")))
    return "عنوان إعادة التوجيه غير مطابق للمُسجَّل في Google Cloud.";
  if (m.includes("invalid_client") || m.includes("client_id"))
    return "بيانات اعتماد Google غير صحيحة (Client ID/Secret). حدّثها من صفحة الإعدادات.";
  if (m.includes("access_denied") || m.includes("denied")) return "تم رفض الإذن من قِبل المستخدم أو من قِبل Google.";
  if (m.includes("network") || m.includes("fetch")) return "تعذر الاتصال بالخادم. تحقق من الإنترنت.";
  if (m.includes("timeout") || m.includes("timed out")) return "انتهت مهلة الاتصال. حاول مرة أخرى.";
  if (m.includes("expired")) return "انقضت صلاحية الجلسة/الرمز. أعد المحاولة.";
  return raw || "تعذر تسجيل الدخول. حاول مرة أخرى.";
}

export async function completeOAuthCallback(rawUrl: string): Promise<{ error: string | null }> {
  console.log("[Auth] Processing OAuth callback.");
  if (callbackUrl === rawUrl && callbackSessionPromise) return callbackSessionPromise;
  callbackUrl = rawUrl;
  callbackSessionPromise = completeOAuthCallbackOnce(rawUrl);
  return callbackSessionPromise;
}

async function completeOAuthCallbackOnce(rawUrl: string): Promise<{ error: string | null }> {
  try {
    const url = new URL(rawUrl);
    const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    const accessToken = url.searchParams.get("access_token") || hashParams.get("access_token");
    const refreshToken = url.searchParams.get("refresh_token") || hashParams.get("refresh_token");

    if (accessToken && refreshToken) {
      console.log("[Auth] Found tokens in URL. Setting session in Supabase...");
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        console.error("[Auth] Supabase setSession Error:", error.message);
        return { error: translateOAuthError(error.message) };
      }
      console.log("[Auth] Session set successfully via tokens.");
      return { error: null };
    }

    const code = url.searchParams.get("code");
    if (code) {
      console.log("[Auth] Found auth code in URL. Exchanging code for session...");
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error("[Auth] Supabase exchangeCodeForSession Error:", error.message);
        return { error: translateOAuthError(error.message) };
      }
      console.log("[Auth] Code exchanged successfully.");
      return { error: null };
    }

    const errorDescription = url.searchParams.get("error_description") || hashParams.get("error_description");
    if (errorDescription) {
      console.error("[Auth] OAuth Callback Error Description:", errorDescription);
    } else {
      console.error("[Auth] OAuth Callback failed: No tokens, code, or error description found in URL.");
    }
    return { error: translateOAuthError(errorDescription || "") };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Auth] Exception during completeOAuthCallbackOnce:", message);
    return { error: translateOAuthError(message) };
  }
}

export function getOAuthRedirectUri(): string {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/`;
  }
  return Linking.createURL("auth-callback");
}

export async function signInWithGoogle(): Promise<{ error: string | null }> {
  const isWeb = Platform.OS === "web";
  const redirectUri = getOAuthRedirectUri();

  console.log(`[Auth] Starting Google Sign-In. Platform: ${Platform.OS}, RedirectURI: ${redirectUri}`);

  try {
    // 1. التعامل مع بيئة الويب (Web)
    if (isWeb && typeof window !== "undefined") {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: false,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });

      if (error) {
        console.error("[Auth Web] Supabase OAuth Error:", error.message);
        return { error: translateOAuthError(error.message) };
      }
      if (data?.url) {
        console.log("[Auth Web] Redirecting to Supabase OAuth provider.");
        window.location.href = data.url;
      }
      return { error: null };
    }

    // 2. التعامل مع تطبيقات الموبايل والـ APK (Android / iOS)
    console.log("[Auth Native] Requesting OAuth URL from Supabase...");
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectUri,
        skipBrowserRedirect: true,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error || !data?.url) {
      console.error("[Auth Native] Supabase OAuth Request Failed:", error?.message || "No URL returned");
      return { error: translateOAuthError(error?.message || "") };
    }

    console.log("[Auth Native] Opening OAuth session in browser.");
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri, {
      showInRecents: true,
    });

    console.log("[Auth Native] WebBrowser session completed with result type:", result.type);

    let finalUrl: string | null = null;

    if (result.type === "success" && result.url) {
      finalUrl = result.url;
    } else if (result.type === "cancel") {
      console.log("[Auth Native] User cancelled or browser closed.");
      return { error: null };
    } else {
      // الاستفادة من Deep Link المباشر في حال إغلاق المتصفح أو تأخر الاستجابة
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl && initialUrl.includes("auth-callback")) {
        finalUrl = initialUrl;
      }
    }

    if (!finalUrl) {
      console.error("[Auth Native] Browser session failed or returned empty URL.");
      return { error: "تعذر تسجيل الدخول. حاول مرة أخرى." };
    }

    console.log("[Auth Native] Browser returned URL successfully. Completing OAuth callback...");
    const callbackResult = await completeOAuthCallback(finalUrl);
    if (callbackResult.error) {
      console.error("[Auth Native] Callback processing error:", callbackResult.error);
      return callbackResult;
    }

    const uid = getAuthSnapshot().user?.id;
    if (uid) {
      console.log("[Auth Native] User logged in. UID:", uid);
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle();
      supabase.from("user_activity_log").insert({
        user_id: uid, user_name: profile?.full_name ?? null, activity_type: "login",
      }).then(({ error: logErr }) => {
        if (logErr) console.warn("[Auth] Failed to log login activity:", logErr);
      });
    }

    console.log("[Auth Native] Google Sign-In finished successfully.");
    return { error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Auth] Unhandled exception in signInWithGoogle:", message);
    return { error: translateOAuthError(message) };
  }
}

export function translateEmailAuthError(raw: string): string {
  const m = raw.toLowerCase();
  // ↔ أخطاء إرسال رسالة التفعيل (إعدادات SMTP فى Supabase — راجع docs/email-signup-setup.md)
  if (m.includes("not authorized") || m.includes("email_address_not_authorized"))
    return "تعذر إرسال رسالة التفعيل: خدمة البريد غير مُهيّأة لهذا العنوان بعد. تواصل مع الدعم.";
  if (m.includes("error sending") || m.includes("sending confirmation") || m.includes("smtp"))
    return "تعذر إرسال رسالة التفعيل الآن. حاول مرة أخرى بعد قليل أو تواصل مع الدعم.";
  if (m.includes("email rate limit") || m.includes("over_email_send_rate_limit"))
    return "تم إرسال عدد كبير من رسائل التفعيل. انتظر قليلًا ثم أعد المحاولة.";
  if (m.includes("already registered") || m.includes("already exists") || m.includes("user already registered"))
    return "هذا البريد الإلكتروني مسجّل بالفعل. جرّب تسجيل الدخول بدلاً من ذلك.";
  if (m.includes("invalid login credentials") || m.includes("invalid_credentials"))
    return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  if (m.includes("email not confirmed") || m.includes("not confirmed"))
    return "لم يتم تفعيل البريد الإلكتروني بعد. تحقق من صندوق الوارد لديك.";
  if (m.includes("password") && (m.includes("short") || m.includes("6 characters") || m.includes("at least")))
    return "كلمة المرور يجب ألا تقل عن 6 أحرف.";
  if (m.includes("invalid email") || m.includes("unable to validate email"))
    return "صيغة البريد الإلكتروني غير صحيحة.";
  if (m.includes("network") || m.includes("fetch")) return "تعذر الاتصال بالخادم. تحقق من الإنترنت.";
  if (m.includes("rate limit") || m.includes("too many")) return "محاولات كثيرة جدًا. حاول مرة أخرى بعد قليل.";
  return raw || "حدث خطأ غير متوقع. حاول مرة أخرى.";
}

// ↔ التسجيل بالبريد الإلكتروني مستقل تمامًا عن Google: بيستخدم
// supabase.auth.signUp العادي، ومحفّز public.handle_new_user (انظر
// 20260722000002_create_profiles_table.sql) بيعمل صف profiles تلقائيًا
// آخذ full_name من نفس user_metadata اللي بنبعتها هنا.
// ↔ رابط التفعيل اللى بيتبعت فى الإيميل بيرجّع المستخدم لهنا بعد التأكيد:
//   • الويب: <origin>/auth-callback (الشاشة بتكمّل الجلسة من الرابط)
//   • أندرويد/آيفون/APK: <scheme>://auth-callback (deep link للتطبيق)
// لازم العنوانين يتضافوا فى Supabase ← Authentication ← URL Configuration ←
// Redirect URLs (docs/email-signup-setup.md)، وإلا Supabase بيرجّع لـ Site URL.
export function getEmailConfirmRedirectUri(): string {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/auth-callback`;
  }
  return Linking.createURL("auth-callback");
}

export async function signUpWithEmail(
  email: string, password: string, fullName: string
): Promise<{ error: string | null; needsEmailConfirmation: boolean; alreadyRegistered?: boolean }> {
  console.log("[Auth] Starting Email Sign-Up...");
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: fullName.trim() }, emailRedirectTo: getEmailConfirmRedirectUri() },
  });

  if (error) {
    console.error("[Auth] Email Sign-Up Error:", error.message);
    return { error: translateEmailAuthError(error.message), needsEmailConfirmation: false };
  }

  // ↔ إصلاح: لما البريد مسجّل قبل كده (مثلًا دخل بجوجل بنفس الإيميل أو أنشأ حساب قبل
  // كده) Supabase مبيرجّعش خطأ — بيرجّع "مستخدم" وهمى identities فيه فاضية ومبيبعتش أى
  // إيميل (حماية من تخمين الحسابات). قبل كده التطبيق كان بيقول "أرسلنا رابط تفعيل" مع إن
  // مفيش رسالة ولا حساب جديد اتعمل. دلوقتى بنكشفها ونوجّه المستخدم لتسجيل الدخول.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    console.warn("[Auth] Email Sign-Up: email already registered (empty identities).");
    return {
      error: "هذا البريد الإلكتروني مسجّل بالفعل. سجّل الدخول بدلاً من إنشاء حساب جديد (أو استخدم تسجيل الدخول بجوجل إن كنت سجّلت به من قبل).",
      needsEmailConfirmation: false,
      alreadyRegistered: true,
    };
  }

  // لو مشروع Supabase مفعّل فيه تأكيد البريد، بترجع من غير session فورية
  const needsEmailConfirmation = !data.session;
  console.log("[Auth] Email Sign-Up finished. needsEmailConfirmation:", needsEmailConfirmation);
  return { error: null, needsEmailConfirmation };
}

// ↔ تسجيل الدخول لحساب موجود بالفعل بالبريد وكلمة المرور، مستقل عن جوجل
export async function signInWithEmailPassword(
  email: string, password: string
): Promise<{ error: string | null; notConfirmed?: boolean }> {
  console.log("[Auth] Starting Email Sign-In...");
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    console.error("[Auth] Email Sign-In Error:", error.message);
    // ↔ الحساب اتعمل لكن البريد لسه ماتفعّلش ← الشاشة بتعرض زر "إعادة إرسال رابط التفعيل".
    const notConfirmed = /not confirmed|email_not_confirmed/i.test(error.message);
    return { error: translateEmailAuthError(error.message), notConfirmed };
  }
  console.log("[Auth] Email Sign-In Successful.");
  return { error: null };
}

// ↔ إعادة إرسال رابط تفعيل البريد (لو الرسالة ماوصلتش أو انتهت صلاحية الرابط).
export async function resendSignupConfirmation(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email.trim(),
    options: { emailRedirectTo: getEmailConfirmRedirectUri() },
  });
  if (error) {
    console.error("[Auth] Resend confirmation error:", error.message);
    return { error: translateEmailAuthError(error.message) };
  }
  return { error: null };
}

// ↔ بعد أي نوع تسجيل دخول ناجح (جوجل / إيميل)، نفس منطق التوجيه المستخدم
// فى app/index.tsx: أدمن يروح للوحة التحكم، غيره يروح للتطبيق العادي.
export async function resolvePostAuthRoute(userId: string): Promise<"/admin" | "/(tabs)"> {
  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return role?.role === "admin" ? "/admin" : "/(tabs)";
}

export async function signInAsGuest(): Promise<{ error: string | null }> {
  console.log("[Auth] Starting Guest Sign-In...");
  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error("[Auth] Guest Sign-In Error:", error.message);
    return { error: translateOAuthError(error.message) };
  }
  console.log("[Auth] Guest Sign-In Successful.");
  return { error: null };
}

export async function signOut(): Promise<void> {
  console.log("[Auth] Signing out...");
  intentionalSignOut = true;
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
  }
  await AsyncStorage.removeItem(SKIP_KEY).catch(() => {});
  queryClient.clear();
  resetAdminDB();
  clearCompareSelection();
  console.log("[Auth] Sign-Out Completed.");
}