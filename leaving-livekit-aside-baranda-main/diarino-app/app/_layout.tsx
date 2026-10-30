// ↔ ترقيع DOMException واستدعاء registerGlobals() بتاع LiveKit اتنقلوا
// لملف index.js فى جذر المشروع (نقطة الدخول الحقيقية للتطبيق، قبل
// expo-router نفسه — راجع "main" فى package.json والشرح التفصيلي هناك).
// هذا الملف (_layout.tsx) بيتحمّل عن طريق الراوتر بعد ما index.js يكون
// خلص التسجيلات دي بالفعل، فمفيش داعي لتكرارها هنا.
import { useState, useCallback, useEffect, useRef } from "react";
import { Stack } from "expo-router";
import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient";
import { completeOAuthCallback, consumeIntentionalSignOut } from "../lib/hooks/useAuth";
import * as Linking from "expo-linking";
import { AppState, Platform } from "react-native";
import { usePathname, useGlobalSearchParams, useSegments } from "expo-router";
import { saveResumeRoute, peekResumeRoute } from "../lib/sessionRestore";
import { getAuthSnapshot, subscribeAuthState } from "../lib/hooks/useCurrentUser";
import { applyPersistedRTLAtStartup } from "../lib/hooks/useLanguage";
import { usePushNotifications } from "../lib/hooks/usePushNotifications";
import { ErrorBoundary } from "../components/shared/ErrorBoundary";
import { ToastHost } from "../components/shared/Toast";
import { GuestLoginPromptHost } from "../components/shared/GuestLoginPrompt";
import { LaunchVideoSplash } from "../components/launch/LaunchVideoSplash";
import { showToast } from "../components/shared/Toast";
import { router } from "expo-router";
import {
  isSupabaseConfigured,
  supabaseConfigurationError,
} from "../lib/supabase";
import { SupabaseConfigurationNotice } from "../components/shared/SupabaseConfigurationNotice";

SplashScreen.preventAutoHideAsync().catch(() => {
  /* no-op if already hidden */
});

export default function RootLayout() {
  if (!isSupabaseConfigured) {
    return (
      <SupabaseConfigurationNotice
        message={supabaseConfigurationError ?? "Supabase configuration is invalid."}
      />
    );
  }
  return <ConfiguredRootLayout />;
}

// ↔ يحفظ آخر صفحة مفتوحة (المسار + الباراميترات) لاستئناف التطبيق منها لو العملية اتقتلت فى الخلفية (lib/sessionRestore.ts).
function useResumeRouteSaver() {
  const pathname = usePathname();
  const segments = useSegments();
  const params = useGlobalSearchParams<Record<string, string | string[]>>();
  const hrefRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let path = pathname;
    // تبويب الريلز الرئيسى (app/(tabs)/index) و شاشة الدخول (app/index) الاتنين مسارهم "/": بنفرّق بالـ segments.
    if (segments[0] === "(tabs)") path = path === "/" ? "/(tabs)" : `/(tabs)${path}`;
    // الباراميترات النصية فقط، من غير مفتاح المسار الديناميكى (id) وأى حاجة حساسة.
    const qs = Object.entries(params)
      .filter(([k, v]) => typeof v === "string" && v && !["id", "token", "access_token", "refresh_token", "code"].includes(k))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
      .join("&");
    const href = qs ? `${path}?${qs}` : path;
    hrefRef.current = href;
    const t = setTimeout(() => { void saveResumeRoute(href); }, 350);
    return () => clearTimeout(t);
  }, [pathname, segments, params]);

  // لحظة الخروج من التطبيق: نحفظ فورًا (الحفظ المؤجّل ممكن ما يلحقش لو العملية اتقتلت).
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" && hrefRef.current) void saveResumeRoute(hrefRef.current);
    });
    return () => sub.remove();
  }, []);
}

function ConfiguredRootLayout() {
  const [isReady, setIsReady] = useState(false);
  // ↔ فيديو الإقلاع (لوجو + اسم Baranda): بيتعرض مرة واحدة فوق التطبيق بعد الـ splash
  // الأصلي الأخضر مباشرة، وبعدين بيختفي ويظهر التطبيق (راجع LaunchVideoSplash.tsx).
  const [showLaunch, setShowLaunch] = useState(true);
  usePushNotifications();
  useResumeRouteSaver();

  // ↔ رابط تفعيل البريد (أو أى رابط auth) على أندرويد/آيفون/APK: الرابط بيفتح التطبيق
  // على <scheme>://auth-callback#access_token=... — بنكمّل الجلسة من الرابط ده فى أى حالة
  // (التطبيق مقفول: getInitialURL، أو شغّال فى الخلفية: حدث url) فالمستخدم يدخل تلقائيًا
  // بعد التفعيل. completeOAuthCallback بيتجاهل نفس الرابط لو اتنفذ قبل كده (جوجل مثلًا).
  // الويب بتتعامل معاه شاشة auth-callback نفسها من window.location.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const handle = (url: string | null) => {
      if (url && url.includes("auth-callback") && /access_token=|[?&]code=/.test(url)) {
        void completeOAuthCallback(url);
      }
    };
    void Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener("url", ({ url }) => handle(url));
    return () => sub.remove();
  }, []);
  // ↔ بند 5+6 (القائمة مش بتتحمّل / لوحة الأدمن مش بتظهر إلا بعد إعادة
  // التشغيل): السبب الجذري المشترك — queries زي useActiveMenuItems/
  // useActiveAdBanners/useActiveLives (وأي query تاني مقفول بسياسة RLS
  // `to authenticated`) مش مربوطة بحالة تسجيل الدخول، فلو اتنفذت أول مرة
  // قبل ما جلسة Supabase تتحمّل بالكامل من التخزين المحلي (سباق توقيت
  // معروف عند الإقلاع البارد)، بيرجع نتيجة فاضية وبتتخزّن فى كاش
  // React Query لحد ما تقفل التطبيق تمامًا وتفتحه تاني. useIsAdmin نفسه
  // بيتحدّث صح لما اليوزر يتغيّر، لكن ده مش كفاية لو الشاشة اتحمّلت أصلاً
  // بنتيجة فاضية من طلبات تانية معتمدة على نفس الجلسة.
  // الحل: أي تغيير حقيقي فى حالة تسجيل الدخول (دخول/خروج/تبديل حساب)
  // بيعمل invalidateQueries() على كل الكاش مرة واحدة، فأي شاشة متاحة أو
  // هتتاح بعد كده بتجيب بياناتها من جديد بالجلسة الصحيحة — مفيش داعي
  // لإعادة تشغيل التطبيق تاني.
  const lastUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    return subscribeAuthState(() => {
      const session = getAuthSnapshot();
      const nextUserId = session.user?.id ?? null;
      if (!session.user && lastUserIdRef.current && !consumeIntentionalSignOut()) {
        lastUserIdRef.current = null;
        queryClient.clear();
        showToast("انتهت الجلسة، سجّل دخولك مجدداً");
        // ↔ إصلاح «شاشة بيضاء عند فتح التطبيق»: لو الحدث ده حصل أثناء الإقلاع قبل جاهزية الـ navigator، router.replace كان بيرمى
        // استثناء جوه مستمع الحالة (غير ممسوك) فيوقع التطبيق/يسيبه فاضى. دلوقتي ممسوك مع إعادة محاولة بعد لحظة.
        try {
          router.replace("/");
        } catch {
          setTimeout(() => { try { router.replace("/"); } catch { /* الشاشة الرئيسية بتتفتح لوحدها بدون جلسة */ } }, 500);
        }
        return;
      }
      if (lastUserIdRef.current === undefined) {
        // أول حدث بعد الإقلاع (استعادة الجلسة المحفوظة) — مش تغيير فعلي،
        // فمفيش داعي لإعادة تحميل كل حاجة من الصفر.
        lastUserIdRef.current = nextUserId;
        return;
      }
      if (lastUserIdRef.current !== nextUserId) {
        lastUserIdRef.current = nextUserId;
        queryClient.invalidateQueries();
      }
    });
  }, []);

  // ↔ إصلاح «شاشة بيضاء عند الفتح»: `if (!isReady) return null` كانت بتفضل لحد ما applyPersistedRTLAtStartup() تخلص — ولو علقت (التخزين
  // أو Updates.reloadAsync) التطبيق يفضل فاضى للأبد. مؤقّت أمان 4 ثوانٍ يفتح التطبيق فى كل الأحوال.
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setIsReady(true);
    };
    const safety = setTimeout(finish, 4000);
    applyPersistedRTLAtStartup()
      .catch((err) => console.warn("applyPersistedRTLAtStartup failed:", err))
      // ↔ لو فيه صفحة محفوظة حديثة (التطبيق اتقتل فى الخلفية ورجع) نستأنف مباشرة من غير فيديو الإقلاع (زى يوتيوب).
      .then(() => peekResumeRoute())
      .then((resume) => { if (resume) setShowLaunch(false); })
      .catch(() => {})
      .finally(() => {
        clearTimeout(safety);
        finish();
      });
    return () => clearTimeout(safety);
  }, []);

  // ↔ رجوع التطبيق من الخلفية بعد أكتر من 30 ثانية: نعيد جلب البيانات النشطة (الجلسة اتجدّدت أو التوكن كان منتهى فى الخلفية)،
  // فالشاشات ما تفضلش فاضية أو قديمة لحد ما المستخدم يقفل التطبيق ويفتحه.
  useEffect(() => {
    let backgroundedAt = 0;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        backgroundedAt = Date.now();
      } else if (state === "active" && backgroundedAt) {
        const away = Date.now() - backgroundedAt;
        backgroundedAt = 0;
        if (away > 30_000) void queryClient.invalidateQueries();
      }
    });
    return () => sub.remove();
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (isReady) {
      await SplashScreen.hideAsync();
    }
  }, [isReady]);

  if (!isReady) {
    return null;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="live" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen
                name="property/[id]"
                // ↔ صفحة التفاصيل بقت شيت مرسوم داخل الشاشة نفسها (backdrop + لوحة
                // + سحب لأسفل للإغلاق من أي مكان — app/property/[id].tsx) بدل
                // formSheet الأصلى، فمفيش أنيميشن نظام هنا (animation: none) لأن
                // الشاشة بتنزلق بنفسها فتح/إغلاق، وgestureEnabled: false عشان
                // إيماءة النظام ماتتعارضش مع سحب الإغلاق.
                options={{
                  presentation: "transparentModal",
                  animation: "none",
                  gestureEnabled: false,
                  contentStyle: { backgroundColor: "transparent" },
                }}
              />
              <Stack.Screen name="property/[id]/reel" options={{ presentation: "fullScreenModal" }} />
              <Stack.Screen name="seller/[id]" options={{ presentation: "modal" }} />
              <Stack.Screen name="chat" options={{ presentation: "modal" }} />
              <Stack.Screen name="publish" options={{ presentation: "modal" }} />
              <Stack.Screen name="coming-soon" options={{ presentation: "modal" }} />
              <Stack.Screen name="settings" options={{ presentation: "modal" }} />
              {/* ↔ فاتورة رسوم الخدمة (InstaPay) — app/invoice.tsx */}
              <Stack.Screen name="invoice" options={{ presentation: "modal" }} />
              {/* ↔ فاتورة الترويج المدفوع (افتتاحي / مميز) — app/promotion-invoice.tsx */}
              <Stack.Screen name="promotion-invoice" options={{ presentation: "modal" }} />
              {/* ↔ حجز المساحة الإعلانية (بانر القائمة/البحث) — app/ad-space.tsx */}
              <Stack.Screen name="ad-space" options={{ presentation: "modal" }} />
              {/* ↔ وضع الإكمال الإجبارى (?onboarding=1): بدون سحب لإغلاق الشاشة على آيفون. */}
              <Stack.Screen
                name="edit-profile"
                options={({ route }) => ({
                  presentation: "modal",
                  gestureEnabled: (route.params as { onboarding?: string } | undefined)?.onboarding !== "1",
                })}
              />
              <Stack.Screen name="auth-email" options={{ presentation: "modal" }} />
              <Stack.Screen name="admin" />
              <Stack.Screen
                name="+not-found"
                options={{ headerShown: true, title: "Not Found" }}
              />
            </Stack>
            {/* ↔ نُقل هنا (بدل ما يتكرر فى كل شاشة على حدة) عشان
                showToast() يشتغل من أي مكان فى التطبيق — زي مودال الـ
                PiP وقايمة خيارات الريل، اللي بيظهروا فى شاشات تانية غير
                settings.tsx. */}
            <ToastHost />
            <GuestLoginPromptHost />
          </QueryClientProvider>
        </SafeAreaProvider>
        {showLaunch && <LaunchVideoSplash onDone={() => setShowLaunch(false)} />}
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}