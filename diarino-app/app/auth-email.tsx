import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FormLabel, FormError, FormInput, PasswordInput } from "../components/publish/FormControls";
import { ProfileFields, ProfileFormValue, EMPTY_PROFILE_FORM, checkProfileForm } from "../components/account/ProfileFields";
import { PolicyConsent } from "../components/shared/PolicyConsent";
import { POLICIES_VERSION } from "../data/policies";
import { signUpWithEmail, signInWithEmailPassword, resendSignupConfirmation, resolvePostAuthRoute, requestPasswordReset } from "../lib/hooks/useAuth";
import { getAuthSnapshot } from "../lib/hooks/useCurrentUser";
import { useThemeColors, ThemeColors } from "../lib/hooks/useThemeColors";
import { useLanguage } from "../lib/hooks/useLanguage";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthEmailScreen() {
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<"signup" | "login" | "forgot">(modeParam === "login" ? "login" : modeParam === "forgot" ? "forgot" : "signup");
  const isSignup = mode === "signup";
  // ↔ «نسيت كلمة المرور»: بنبعت رابط استعادة للبريد المسجّل (requestPasswordReset) والرابط بيفتح صفحة تعيين كلمة مرور جديدة.
  const isForgot = mode === "forgot";
  const [resetSent, setResetSent] = useState(false);
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const styles = createStyles(themeColors);

  // ↔ إنشاء الحساب بنفس بيانات «تعديل بيانات الحساب» (نوع الحساب إجبارى + الاسم + الميلاد + الجنس + الجنسية +
  // الإقامة + الهاتف) + الموافقة الإلزامية على شروط الاستخدام وسياسة الخصوصية وسياسة البيع.
  const [form, setForm] = useState<ProfileFormValue>(EMPTY_PROFILE_FORM);
  const [consent, setConsent] = useState(false);
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

  async function handleResendReset() {
    if (resending || resendCooldown > 0) return;
    setResending(true);
    setResendMessage(null);
    const res = await requestPasswordReset(email);
    setResending(false);
    if (res.error) { setResendMessage(res.error); return; }
    setResendMessage("تم إرسال الرابط مرة أخرى. تحقق من صندوق الوارد والبريد المزعج.");
    setResendCooldown(RESEND_COOLDOWN_S);
  }

  function switchMode(next: "signup" | "login" | "forgot") {
    setMode(next);
    setResetSent(false);
    setErrors(new Set());
    setFormError(null);
    setConfirmationSent(false);
    setResendMessage(null);
    setShowResendInLogin(false);
  }

  function validate(): boolean {
    const bad = new Set<string>();
    if (isSignup && form.firstName.trim().length < 2) bad.add("firstName");
    if (isSignup && !form.accountType) bad.add("accountType");
    if (isSignup && !consent) bad.add("consent");
    if (!EMAIL_RE.test(email.trim())) bad.add("email");
    if (!isForgot && password.length < 6) bad.add("password");
    if (isSignup && confirmPassword !== password) bad.add("confirmPassword");
    setErrors(bad);
    return bad.size === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    setShowResendInLogin(false);
    if (!validate()) return;
    if (isForgot) {
      setSubmitting(true);
      try {
        const res = await requestPasswordReset(email);
        if (res.error) { setFormError(res.error); return; }
        setResendMessage(null);
        setResendCooldown(RESEND_COOLDOWN_S);
        setResetSent(true);
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : t("حدث خطأ غير متوقع. حاول مرة أخرى."));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    let extraProfile: Record<string, string> = {};
    let fullName = "";
    if (isSignup) {
      const check = checkProfileForm(form, t);
      if (!check.ok) {
        setFormError(`${check.title}: ${check.message}`);
        return;
      }
      const first = form.firstName.trim();
      const last = form.lastName.trim();
      fullName = [first, last].filter(Boolean).join(" ");
      const entries: Record<string, string | undefined> = {
        first_name: first, last_name: last || undefined, birth_date: check.birthDate,
        gender: form.gender || undefined, nationality: form.nationalityCode || undefined,
        residence: form.residence.trim() || undefined,
        phone_e164: check.phone.phoneE164, phone_country_code: check.phone.phoneCountryCode, phone_country_name: check.phone.phoneCountryName,
        account_type: form.accountType, policies_version: POLICIES_VERSION,
      };
      extraProfile = Object.fromEntries(Object.entries(entries).filter(([, v]) => !!v)) as Record<string, string>;
    }
    setSubmitting(true);
    try {
      if (isSignup) {
        const res = await signUpWithEmail(email, password, fullName, extraProfile);
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
          <Text style={styles.headerTitle}>{isSignup ? t("إنشاء حساب بالبريد الإلكتروني") : isForgot ? t("استعادة كلمة المرور") : t("تسجيل الدخول")}</Text>
          <View style={{ width: 34 }} />
        </View>

        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
          {isForgot && resetSent ? (
            <View style={styles.confirmBox}>
              <Text style={styles.confirmTitle}>{t("تحقق من بريدك الإلكتروني")}</Text>
              <Text style={styles.confirmText}>
                {t("إذا كان البريد")} {email.trim()} {t("مسجّلًا لدينا فقد أرسلنا إليه رابطًا لإعادة تعيين كلمة المرور. افتح الرسالة واضغط الرابط لتعيين كلمة مرور جديدة.")}
              </Text>
              <Text style={styles.confirmHint}>{t("لم تجد الرسالة؟ تحقق من البريد المزعج (Spam) أو أعد الإرسال.")}</Text>
              <Pressable style={styles.secondaryBtn} onPress={handleResendReset} disabled={resending || resendCooldown > 0}>
                {resending ? (
                  <ActivityIndicator color="#22A652" size="small" />
                ) : (
                  <Text style={[styles.secondaryBtnText, resendCooldown > 0 && { opacity: 0.5 }]}>
                    {resendCooldown > 0 ? `${t("إعادة الإرسال بعد")} ${resendCooldown} ${t("ثانية")}` : t("إعادة إرسال الرابط")}
                  </Text>
                )}
              </Pressable>
              {!!resendMessage && <Text style={styles.confirmHint}>{t(resendMessage)}</Text>}
              <Pressable style={styles.primaryBtn} onPress={() => switchMode("login")}>
                <Text style={styles.primaryBtnText}>{t("العودة لتسجيل الدخول")}</Text>
              </Pressable>
            </View>
          ) : confirmationSent ? (
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
                <ProfileFields
                  value={form}
                  onChange={(patch) => { setForm((f) => ({ ...f, ...patch })); if (patch.accountType) setErrors((e) => { const n = new Set(e); n.delete("accountType"); return n; }); }}
                  accountTypeError={errors.has("accountType")}
                  firstNameRequired
                  firstNameError={errors.has("firstName")}
                />
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

              {isForgot && <Text style={styles.confirmHint}>{t("اكتب بريدك الإلكتروني المسجّل وسنرسل لك رابطًا لتعيين كلمة مرور جديدة.")}</Text>}

              {!isForgot && (
              <View style={styles.field}>
                <FormLabel text={t("كلمة المرور")} required />
                <PasswordInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t("6 أحرف على الأقل")}
                  error={errors.has("password")}
                />
                <FormError text={t("كلمة المرور يجب ألا تقل عن 6 أحرف")} show={errors.has("password")} />
              </View>
              )}

              {mode === "login" && (
                <Pressable style={styles.forgotBtn} onPress={() => switchMode("forgot")} disabled={submitting}>
                  <Text style={styles.forgotText}>{t("هل نسيت كلمة المرور؟")}</Text>
                </Pressable>
              )}

              {isSignup && (
                <View style={styles.field}>
                  <FormLabel text={t("تأكيد كلمة المرور")} required />
                  <PasswordInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder={t("أعد كتابة كلمة المرور")}
                    error={errors.has("confirmPassword")}
                  />
                  <FormError text={t("كلمتا المرور غير متطابقتين")} show={errors.has("confirmPassword")} />
                </View>
              )}

              {isSignup && (
                <View>
                  <PolicyConsent
                    checked={consent}
                    actionLabel="إنشاء حساب"
                    onChange={(v) => { setConsent(v); setErrors((e) => { const n = new Set(e); n.delete("consent"); return n; }); }}
                    error={errors.has("consent")}
                  />
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
                  <Text style={styles.primaryBtnText}>{isSignup ? t("إنشاء الحساب") : isForgot ? t("إرسال رابط الاستعادة") : t("تسجيل الدخول")}</Text>
                )}
              </Pressable>

              <Pressable style={styles.switchModeBtn} onPress={() => switchMode(isSignup || isForgot ? "login" : "signup")} disabled={submitting}>
                <Text style={styles.switchModeText}>
                  {isForgot ? t("العودة لتسجيل الدخول") : isSignup ? t("عندك حساب بالفعل؟ سجّل الدخول") : t("لسه معندكش حساب؟ أنشئ حساب جديد")}
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
    forgotBtn: { alignSelf: "flex-start", paddingVertical: 2 },
    forgotText: { color: "#22A652", fontSize: 12.5, fontWeight: "800" },
    switchModeBtn: { alignItems: "center", paddingVertical: 10 },
    switchModeText: { color: themeColors.isDark ? "#9FB0BE" : "#5B6B75", fontSize: 12.5, fontWeight: "700" },
    confirmBox: { alignItems: "center", gap: 14, paddingTop: 30 },
    confirmTitle: { fontSize: 17, fontWeight: "800", color: themeColors.text },
    confirmText: { fontSize: 13.5, color: themeColors.textSubtle, textAlign: "center", lineHeight: 21 },
  });
}
