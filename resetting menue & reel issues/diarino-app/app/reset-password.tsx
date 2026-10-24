import { useState } from "react";
import { router } from "expo-router";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FormLabel, FormError, PasswordInput } from "../components/publish/FormControls";
import { updatePassword, resolvePostAuthRoute } from "../lib/hooks/useAuth";
import { useCurrentUser } from "../lib/hooks/useCurrentUser";
import { useThemeColors, ThemeColors } from "../lib/hooks/useThemeColors";
import { useLanguage } from "../lib/hooks/useLanguage";
import { showToast } from "../components/shared/Toast";

// ↔ تعيين كلمة مرور جديدة بعد الضغط على رابط «نسيت كلمة المرور» فى الإيميل. الرابط بيفتح التطبيق/الويب على
// auth-callback اللى بتكوّن جلسة الاستعادة وتحوّل لهنا. من غير جلسة (رابط منتهى/مفتوح مرتين) بنعرض رسالة وزر لطلب رابط جديد.
export default function ResetPasswordScreen() {
  const { user, loading } = useCurrentUser();
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const styles = createStyles(themeColors);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setFormError(null);
    const bad = new Set<string>();
    if (password.length < 6) bad.add("password");
    if (confirmPassword !== password) bad.add("confirmPassword");
    setErrors(bad);
    if (bad.size > 0) return;
    setSubmitting(true);
    try {
      const res = await updatePassword(password);
      if (res.error) {
        setFormError(res.error);
        return;
      }
      showToast(t("تم تغيير كلمة المرور بنجاح"));
      const uid = user?.id;
      router.replace(uid ? await resolvePostAuthRoute(uid) : "/(tabs)");
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t("حدث خطأ غير متوقع. حاول مرة أخرى."));
    } finally {
      setSubmitting(false);
    }
  }

  const noSession = !loading && !user;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t("تعيين كلمة مرور جديدة")}</Text>
        </View>
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
          {loading ? (
            <ActivityIndicator color="#22A652" style={{ marginTop: 40 }} />
          ) : noSession ? (
            <View style={styles.centerBox}>
              <Text style={styles.title}>{t("انتهت صلاحية الرابط")}</Text>
              <Text style={styles.text}>{t("رابط استعادة كلمة المرور غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.")}</Text>
              <Pressable style={styles.primaryBtn} onPress={() => router.replace("/auth-email?mode=forgot")}>
                <Text style={styles.primaryBtnText}>{t("طلب رابط جديد")}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.text}>{t("اكتب كلمة المرور الجديدة لحسابك.")}</Text>
              <View style={styles.field}>
                <FormLabel text={t("كلمة المرور الجديدة")} required />
                <PasswordInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t("6 أحرف على الأقل")}
                  error={errors.has("password")}
                />
                <FormError text={t("كلمة المرور يجب ألا تقل عن 6 أحرف")} show={errors.has("password")} />
              </View>
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
              {!!formError && <Text style={styles.formError}>{t(formError)}</Text>}
              <Pressable style={styles.primaryBtn} onPress={handleSubmit} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>{t("حفظ كلمة المرور")}</Text>}
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
    header: { alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    headerTitle: { fontSize: 15, fontWeight: "800", color: themeColors.text },
    scrollContent: { padding: 20, gap: 16 },
    field: { gap: 6 },
    centerBox: { alignItems: "center", gap: 14, paddingTop: 30 },
    title: { fontSize: 17, fontWeight: "800", color: themeColors.text },
    text: { fontSize: 13.5, color: themeColors.textSubtle, textAlign: "center", lineHeight: 21 },
    formError: { color: "#E5484D", fontSize: 12.5, fontWeight: "700", textAlign: "center" },
    primaryBtn: { backgroundColor: "#22A652", borderRadius: 14, paddingVertical: 15, paddingHorizontal: 28, alignItems: "center", justifyContent: "center", marginTop: 4 },
    primaryBtnText: { color: "#fff", fontSize: 14.5, fontWeight: "800" },
  });
}
