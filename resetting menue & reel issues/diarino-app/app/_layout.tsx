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
import { Platform } from "react-native";
import { getAuthSnapshot, subscribeAuthState } from "../lib/hooks/useCurrentUser";
import { applyPersistedRTLAtStartup } from "../lib/hooks/useLanguage";
import { usePushNotifications } from "../lib/hooks/usePushNotifications";
import { ErrorBoundary } from "../components/shared/ErrorBoundary";
import { ToastHost } from "../components/shared/Toast";
import { LaunchVideoSplash } from "../components/launch/LaunchVideoSplash";
import { showToast } from "../components/shared/Toast";
import { router } from "expo-router";

SplashScreen.preventAutoHideAsync().catch(() => {
  /* no-op if already hidden */
});

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  // ↔ فيديو الإقلاع (لوجو + اسم Baranda): بيتعرض مرة واحدة فوق التطبيق بعد الـ splash
  // الأصلي الأخضر مباشرة، وبعدين بيختفي ويظهر التطبيق (راجع LaunchVideoSplash.tsx).
  const [showLaunch, setShowLaunch] = useState(true);
  usePushNotifications();

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
        router.replace("/");
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

  useEffect(() => {
    applyPersistedRTLAtStartup().finally(() => {
      setIsReady(true);
    });
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
              <Stack.Screen name="edit-profile" options={{ presentation: "modal" }} />
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
          </QueryClientProvider>
        </SafeAreaProvider>
        {showLaunch && <LaunchVideoSplash onDone={() => setShowLaunch(false)} />}
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}