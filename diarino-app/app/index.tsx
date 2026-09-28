import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Animated, Easing, Alert, Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Rect, Path } from "react-native-svg";
import { completeOAuthCallback, signInWithGoogle, signInAsGuest } from "../lib/hooks/useAuth";
import { getAuthSnapshot, subscribeAuthState, useCurrentUser } from "../lib/hooks/useCurrentUser";
import { supabase } from "../lib/supabase";
import { useThemeColors, ThemeColors } from "../lib/hooks/useThemeColors";

const SKIP_KEY = "diarino:skip_auth";
const INTRO_DURATION_MS = 1600;

function hasOAuthCallbackParams(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.slice(1));
  return ["access_token", "refresh_token", "code", "error", "error_description"].some(
    (key) => url.searchParams.has(key) || hashParams.has(key),
  );
}

export default function AuthGateScreen() {
  const [showIntro, setShowIntro] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signingInGuest, setSigningInGuest] = useState(false);
  const [isCompletingOAuth, setIsCompletingOAuth] = useState(hasOAuthCallbackParams);
  const [error, setError] = useState<string | null>(null);
  const { user: currentUser, loading: authLoading } = useCurrentUser();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  useEffect(() => {
    const timer = setTimeout(() => setShowIntro(false), INTRO_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(SKIP_KEY).then(async (v) => {
      if (!mounted || v !== "1") return;
      if (!getAuthSnapshot().user) {
        await signInAsGuest().catch(() => {});
      }
      if (mounted) setSkipped(true);
    });

    const unsubscribe = subscribeAuthState(() => {
      const session = getAuthSnapshot();
      if (!mounted) return;
      if (session.user) {
        setHasSession(true);
        setSkipped(false);
        AsyncStorage.removeItem(SKIP_KEY);
      } else {
        setHasSession(false);
      }
    });

    setHasSession(!!currentUser);
    setLoading(authLoading);

    return () => { mounted = false; unsubscribe(); };
  }, [authLoading, currentUser]);

  useEffect(() => {
    if (!isCompletingOAuth || Platform.OS !== "web" || typeof window === "undefined") return;

    let mounted = true;
    const callbackUrl = window.location.href;
    window.history.replaceState({}, document.title, window.location.pathname);

    completeOAuthCallback(callbackUrl)
      .then(({ error: callbackError }) => {
        if (mounted && callbackError) setError(callbackError);
      })
      .catch((callbackError: unknown) => {
        if (!mounted) return;
        setError(callbackError instanceof Error ? callbackError.message : "تعذر إكمال تسجيل الدخول.");
      })
      .finally(() => {
        if (mounted) setIsCompletingOAuth(false);
      });

    return () => { mounted = false; };
  }, [isCompletingOAuth]);

  useEffect(() => {
    if (loading || (!hasSession && !skipped)) return;

    let mounted = true;
    async function routeAuthenticatedUser() {
      if (!hasSession || skipped) {
        if (mounted) router.replace("/(tabs)");
        return;
      }

      const { data: role } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", currentUser?.id ?? "")
        .eq("role", "admin")
        .maybeSingle();

      if (mounted) router.replace(role?.role === "admin" ? "/admin" : "/(tabs)");
    }

    routeAuthenticatedUser();
    return () => { mounted = false; };
  }, [loading, hasSession, skipped]);

  async function handleGoogleSignIn() {
    setSigningIn(true);
    setError(null);
    console.log("[AuthGateScreen] Google Sign-In Button Pressed");

    try {
      const res = await signInWithGoogle();
      const err = res?.error;

      if (err) {
        console.error("[AuthGateScreen] Google Sign-In returned error:", err);
        
        let errorMsg = "حدث خطأ أثناء تسجيل الدخول";
        if (typeof err === "string") {
          errorMsg = err;
        } else if (typeof err === "object" && err !== null && "message" in err) {
          errorMsg = String((err as { message?: unknown }).message);
        } else {
          errorMsg = JSON.stringify(err);
        }

        setError(errorMsg);
        
        if (Platform.OS === "web") {
          console.warn("[AuthGateScreen] Error Alert:", errorMsg);
        } else {
          Alert.alert("خطأ في تسجيل الدخول", errorMsg);
        }
      } else {
        console.log("[AuthGateScreen] Google Sign-In initiated successfully");
      }
    } catch (err: unknown) {
      console.error("[AuthGateScreen] Exception in handleGoogleSignIn:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      
      if (Platform.OS === "web") {
        console.warn("[AuthGateScreen] Exception Alert:", errorMsg);
      } else {
        Alert.alert("خطأ في تسجيل الدخول", errorMsg);
      }
    } finally {
      setSigningIn(false);
    }
  }

  // ↔ التسجيل بالإيميل وتسجيل الدخول بالإيميل مستقلّان تمامًا عن جوجل —
  // كل واحد بيوديك لنفس شاشة app/auth-email.tsx بس بوضع مختلف
  function handleEmailSignup() {
    router.push("/auth-email?mode=signup");
  }

  function handleEmailLogin() {
    router.push("/auth-email?mode=login");
  }

  async function handleSkip() {
    setSigningInGuest(true);
    setError(null);
    console.log("[AuthGateScreen] Guest Sign-In Pressed");

    try {
      const { error: err } = await signInAsGuest();
      if (err) {
        console.error("[AuthGateScreen] Guest Sign-In Error:", err);
        setError(String(err));
        return;
      }
      await AsyncStorage.setItem(SKIP_KEY, "1");
      setSkipped(true);
    } catch (err: unknown) {
      console.error("[AuthGateScreen] Guest Sign-In Exception:", err);
    } finally {
      setSigningInGuest(false);
    }
  }

  if (showIntro) {
    return <IntroSplash />;
  }

  if (loading || isCompletingOAuth) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#22A652" size="large" />
      </View>
    );
  }

  if (hasSession || skipped) {
    return <View style={styles.loadingContainer} />;
  }

  return (
    <LoginScreen
      onGoogle={handleGoogleSignIn}
      onSkip={handleSkip}
      onEmailSignup={handleEmailSignup}
      onEmailLogin={handleEmailLogin}
      signingIn={signingIn}
      signingInGuest={signingInGuest}
      error={error}
    />
  );
}

function IntroSplash() {
  const opacity = useRef(new Animated.Value(0)).current;
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== "web" }).start();
  }, []);

  return (
    <View style={styles.introContainer}>
      <Animated.Image
        source={require("../assets/intro-splash.png")}
        style={[StyleSheet.absoluteFill, { opacity }]}
        resizeMode="cover"
      />
    </View>
  );
}

function LoginScreen({
  onGoogle, onSkip, onEmailSignup, onEmailLogin, signingIn, signingInGuest, error,
}: {
  onGoogle: () => void; onSkip: () => void; onEmailSignup: () => void; onEmailLogin: () => void;
  signingIn: boolean; signingInGuest: boolean; error: string | null;
}) {
  const bgOpacity = useRef(new Animated.Value(0)).current;
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const styles = createStyles(themeColors);
  const busy = signingIn || signingInGuest;

  useEffect(() => {
    Animated.timing(bgOpacity, {
      toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== "web",
    }).start();
  }, []);

  return (
    <View style={styles.container}>
      <Animated.Image
        source={require("../assets/onboarding-bg.jpg")}
        style={[StyleSheet.absoluteFill, { opacity: bgOpacity }]}
        resizeMode="cover"
      />
      <LinearGradient
        colors={["rgba(46,58,36,0)", "rgba(40,52,31,0.55)", "rgba(27,36,20,0.94)"]}
        locations={[0, 0.45, 1]}
        style={styles.bottomGradient}
        pointerEvents="none"
      />

      <View style={[styles.bottomBlock, { paddingBottom: insets.bottom + 78 }]}>
        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable style={styles.googleBtn} onPress={onGoogle} disabled={busy}>
          {signingIn ? (
            <ActivityIndicator color="#14293C" size="small" />
          ) : (
            <>
              <GoogleIcon />
              <Text style={styles.googleBtnText}>المتابعة باستخدام جوجل</Text>
            </>
          )}
        </Pressable>

        <Pressable style={styles.emailBtn} onPress={onEmailSignup} disabled={busy}>
          <MailIcon />
          <Text style={styles.emailBtnText}>إنشاء حساب بالبريد الإلكتروني</Text>
        </Pressable>

        <Pressable style={styles.loginBtn} onPress={onEmailLogin} disabled={busy}>
          <Text style={styles.loginBtnText}>تسجيل الدخول</Text>
        </Pressable>
      </View>

      <Pressable style={[styles.skipBtn, { bottom: insets.bottom + 20 }]} onPress={onSkip} disabled={busy}>
        {signingInGuest ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.skipBtnText}>تخطي</Text>
        )}
      </Pressable>
    </View>
  );
}

function GoogleIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18">
      <Path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z" />
      <Path fill="#34A853" d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.8618-3.0477.8618-2.3436 0-4.3282-1.5831-5.0359-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z" />
      <Path fill="#FBBC05" d="M3.9641 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.9641 10.71z" />
      <Path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9641 7.29C4.6718 5.1627 6.6564 3.5795 9 3.5795z" />
    </Svg>
  );
}

function MailIcon() {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#E7EBDD" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3} y={5} width={18} height={14} rx={2} />
      <Path d="M3 7l9 6 9-6" />
    </Svg>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    loadingContainer: { flex: 1, backgroundColor: themeColors.isDark ? "#0F1B28" : "#EFEBE3", alignItems: "center", justifyContent: "center" },
    introContainer: { flex: 1, backgroundColor: themeColors.isDark ? "#0F1B28" : "#EFEBE3", alignItems: "center", justifyContent: "center" },
    container: { flex: 1, backgroundColor: "#1B2414" },
    // ↔ التدرّج الزيتوني الشفاف اللي بيغطي تلت الشاشة السفلي فوق صورة
    // الخلفية — نفس أسلوب التصميم المرجعي (صورة بلكونة + طبقة خضراء
    // شفافة تحمل الأزرار).
    bottomGradient: { position: "absolute", left: 0, right: 0, bottom: 0, height: "46%" },
    bottomBlock: { paddingHorizontal: 24, paddingTop: 24, gap: 12, marginTop: "auto" },
    errorText: { color: "#FCA5A5", fontSize: 12, textAlign: "center", marginBottom: 4, fontWeight: "700" },
    googleBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
      backgroundColor: "#F3F1E7", borderRadius: 28, paddingVertical: 15,
      shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2,
    },
    googleBtnText: { color: "#1F2937", fontSize: 14.5, fontWeight: "800" },
    emailBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
      backgroundColor: "rgba(20,26,15,0.55)", borderRadius: 28, paddingVertical: 15,
      borderWidth: 1, borderColor: "rgba(231,235,221,0.25)",
    },
    emailBtnText: { color: "#E7EBDD", fontSize: 14, fontWeight: "800" },
    loginBtn: {
      alignItems: "center", justifyContent: "center",
      backgroundColor: "rgba(20,26,15,0.35)", borderRadius: 28, paddingVertical: 15,
      borderWidth: 1, borderColor: "rgba(231,235,221,0.2)",
    },
    loginBtnText: { color: "#E7EBDD", fontSize: 14, fontWeight: "800" },
    skipBtn: {
      position: "absolute", right: 24, alignItems: "center", justifyContent: "center",
      paddingVertical: 9, paddingHorizontal: 22, borderRadius: 20,
      backgroundColor: "rgba(20,26,15,0.4)", borderWidth: 1, borderColor: "rgba(231,235,221,0.3)",
    },
    skipBtnText: { color: "#E7EBDD", fontSize: 13, fontWeight: "700" },
  });
}