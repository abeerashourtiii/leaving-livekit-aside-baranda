import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FormLabel, FormError, FormInput } from "../components/publish/FormControls";
import { signUpWithEmail, signInWithEmailPassword, resendSignupConfirmation, resolvePostAuthRoute } from "../lib/hooks/useAuth";
import { getAuthSnapshot } from "../lib/hooks/useCurrentUser";
import { useThemeColors, ThemeColors } from "../lib/hooks/useThemeColors";
import { useLanguage } from "../lib/hooks/useLanguage";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthEmailScreen() {
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<"signup" | "login">(modeParam === "login" ? "login" : "signup");
  const isSignup = mode === "signup";
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const styles = createStyles(themeColors);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  // ↔ إعادة إرسال رابط التفعيل: زر بمهلة 60 ثانية (Supabase بيحدّ عدد الرسائل) —
  // بيظهر بعد التسجيل وبعد محاولة دخول بحساب لسه ماتفعّلش.
  const RESEND_COOLDOWN_S = 60;
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [showResendInLogin, setShowResendInLogin] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  async function handleResend() {
    if (resending || resendCooldown > 0) return;
    setResending(true);
    setResendMessage(null);
    const res = await resendSignupConfirmation(email);
    setResending(false);
    if (res.error) {
      setResendMessage(res.error);
      return;
    }
    setResendMessage("تم إرسال رابط التفعيل مرة أخرى. تحقق من صندوق الوارد والبريد المزعج.");
    setResendCooldown(RESEND_COOLDOWN_S);
  }

  function switchMode(next: "signup" | "login") {
    setMode(next);
    setErrors(new Set());
    setFormError(null);
    setConfirmationSent(false);
    setResendMessage(null);
    setShowResendInLogin(false);
  }

  function validate(): boolean {
    const bad = new Set<string>();
    if (isSignup && fullName.trim().length < 2) bad.add("fullName");
    if (!EMAIL_RE.test(email.trim())) bad.add("email");
    if (password.length < 6) bad.add("password");
    if (isSignup && confirmPassword !== password) bad.add("confirmPassword");
    setErrors(bad);
    return bad.size === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    setShowResendInLogin(false);
    if (!validate()) return;
    setSubmitting(true);
    try {
      if (isSignup) {
        const res = await signUpWithEmail(email, password, fullName);
        if (res.alreadyRegistered) {
          // ↔ البريد مسجّل قبل كده: نحوّله لتسجيل الدخول (بنفس البريد) مع الرسالة.
          setMode("login");
          setErrors(new Set());
          setFormError(res.error);
          return;
        }
        if (res.error) { setFormError(res.error); return; }
        if (res.needsEmailConfirmation) {
          setResendMessage(null);
          setResendCooldown(RESEND_COOLDOWN_S);
          setConfirmationSent(true);
          return;
        }
      } else {
        const res = await signInWithEmailPassword(email, password);
        if (res.error) {
          setFormError(res.error);
          setShowResendInLogin(!!res.notConfirmed);
          return;
        }
      }

      const uid = getAuthSnapshot().user?.id;
      if (uid) {
        const route = await resolvePostAuthRoute(uid);
        router.replace(route);
      } else {
        router.replace("/(tabs)");
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t("حدث خطأ غير متوقع. حاول مرة أخرى."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable style={styles.closeBtn} onPress={() => router.back()} hitSlop={8}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={themeColors.text} strokeWidth={2}>
              <Path d="M18 6L6 18M6 6l12 12" />
            </Svg>
          </Pressable>
          <Text style={styles.headerTitle}>{isSignup ? t("إنشاء حساب بالبريد الإلكتروني") : t("تسجيل الدخول")}</Text>
          <View style={{ width: 34 }} />
        </View>

        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
          {confirmationSent ? (
            <View style={styles.confirmBox}>
              <Text style={styles.confirmTitle}>{t("تحقق من بريدك الإلكتروني")}</Text>
              <Text style={styles.confirmText}>
                {t("أرسلنا رابط تفعيل إلى")} {email.trim()}. {t("افتح بريدك الإلكتروني وفعّل الحساب، ثم سجّل الدخول من هنا.")}
              </Text>
              <Text style={styles.confirmHint}>{t("لم تجد الرسالة؟ تحقق من البريد المزعج (Spam) أو أعد الإرسال.")}</Text>
              <Pressable style={styles.primaryBtn} onPress={() => switchMode("login")}>
                <Text style={styles.primaryBtnText}>{t("الذهاب لتسجيل الدخول")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={handleResend} disabled={resending || resendCooldown > 0}>
                {resending ? (
                  <ActivityIndicator color="#22A652" size="small" />
                ) : (
                  <Text style={[styles.secondaryBtnText, resendCooldown > 0 && { opacity: 0.5 }]}>
                    {resendCooldown > 0 ? `${t("إعادة الإرسال بعد")} ${resendCooldown} ${t("ثانية")}` : t("إعادة إرسال رابط التفعيل")}
                  </Text>
                )}
              </Pressable>
              {!!resendMessage && <Text style={styles.confirmHint}>{t(resendMessage)}</Text>}
              <Pressable onPress={() => { setConfirmationSent(false); setResendMessage(null); }}>
                <Text style={styles.switchModeText}>{t("تعديل البريد الإلكتروني")}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {isSignup && (
                <View style={styles.field}>
                  <FormLabel text={t("الاسم الكامل")} required />
                  <FormInput
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder={t("مثال: أحمد محمد")}
                    error={errors.has("fullName")}
                    autoCapitalize="words"
                  />
                  <FormError text={t("من فضلك أدخل اسمًا صحيحًا")} show={errors.has("fullName")} />
                </View>
              )}

              <View style={styles.field}>
                <FormLabel text={t("البريد الإلكتروني")} required />
                <FormInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="example@email.com"
                  error={errors.has("email")}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <FormError text={t("من فضلك أدخل بريدًا إلكترونيًا صحيحًا")} show={errors.has("email")} />
              </View>

              <View style={styles.field}>
                <FormLabel text={t("كلمة المرور")} required />
                <FormInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t("6 أحرف على الأقل")}
                  error={errors.has("password")}
                  secureTextEntry
                  autoCapitalize="none"
                />
                <FormError text={t("كلمة المرور يجب ألا تقل عن 6 أحرف")} show={errors.has("password")} />
              </View>

              {isSignup && (
                <View style={styles.field}>
                  <FormLabel text={t("تأكيد كلمة المرور")} required />
                  <FormInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder={t("أعد كتابة كلمة المرور")}
                    error={errors.has("confirmPassword")}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  <FormError text={t("كلمتا المرور غير متطابقتين")} show={errors.has("confirmPassword")} />
                </View>
              )}

              {!!formError && <Text style={styles.formError}>{t(formError)}</Text>}

              {!isSignup && showResendInLogin && (
                <>
                  <Pressable style={styles.secondaryBtn} onPress={handleResend} disabled={resending || resendCooldown > 0}>
                    {resending ? (
                      <ActivityIndicator color="#22A652" size="small" />
                    ) : (
                      <Text style={[styles.secondaryBtnText, resendCooldown > 0 && { opacity: 0.5 }]}>
                        {resendCooldown > 0 ? `${t("إعادة الإرسال بعد")} ${resendCooldown} ${t("ثانية")}` : t("إعادة إرسال رابط التفعيل")}
                      </Text>
                    )}
                  </Pressable>
                  {!!resendMessage && <Text style={styles.confirmHint}>{t(resendMessage)}</Text>}
                </>
              )}

              <Pressable style={styles.primaryBtn} onPress={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>{isSignup ? t("إنشاء الحساب") : t("تسجيل الدخول")}</Text>
                )}
              </Pressable>

              <Pressable style={styles.switchModeBtn} onPress={() => switchMode(isSignup ? "login" : "signup")} disabled={submitting}>
                <Text style={styles.switchModeText}>
                  {isSignup ? t("عندك حساب بالفعل؟ سجّل الدخول") : t("لسه معندكش حساب؟ أنشئ حساب جديد")}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, backgroundColor: themeColors.background },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: themeColors.border,
    },
    closeBtn: {
      width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
      backgroundColor: themeColors.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
    },
    headerTitle: { fontSize: 15, fontWeight: "800", color: themeColors.text },
    scrollContent: { padding: 20, gap: 16 },
    field: { gap: 6 },
    formError: { color: "#E5484D", fontSize: 12.5, fontWeight: "700", textAlign: "center" },
    primaryBtn: {
      backgroundColor: "#22A652", borderRadius: 14, paddingVertical: 15, paddingHorizontal: 28,
      alignItems: "center", justifyContent: "center", marginTop: 4,
    },
    secondaryBtn: {
      borderWidth: 1.5, borderColor: "#22A652", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24,
      alignItems: "center", justifyContent: "center", minWidth: 180,
    },
    secondaryBtnText: { color: "#22A652", fontSize: 13.5, fontWeight: "800" },
    confirmHint: { fontSize: 12, color: themeColors.textSubtle, textAlign: "center", lineHeight: 19 },
    primaryBtnText: { color: "#fff", fontSize: 14.5, fontWeight: "800" },
    switchModeBtn: { alignItems: "center", paddingVertical: 10 },
    switchModeText: { color: themeColors.isDark ? "#9FB0BE" : "#5B6B75", fontSize: 12.5, fontWeight: "700" },
    confirmBox: { alignItems: "center", gap: 14, paddingTop: 30 },
    confirmTitle: { fontSize: 17, fontWeight: "800", color: themeColors.text },
    confirmText: { fontSize: 13.5, color: themeColors.textSubtle, textAlign: "center", lineHeight: 21 },
  });
}
