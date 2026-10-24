import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { View, Text, Pressable, ScrollView, StyleSheet, Alert, ActivityIndicator, Platform, BackHandler } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Svg, { Path, Circle } from "react-native-svg";
import * as ImagePicker from "expo-image-picker";
import { useLanguage } from "../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../lib/hooks/useThemeColors";
import { useCurrentUser } from "../lib/hooks/useCurrentUser";
import { useProfile } from "../lib/hooks/useProfile";
import { useLogMedia } from "../lib/hooks/useMedia";
import { uploadToCloudinary, cldOptimized } from "../lib/cloudinary";
import { ProfileFields, ProfileFormValue, EMPTY_PROFILE_FORM, formFromProfile, checkProfileForm } from "../components/account/ProfileFields";
import { PolicyConsent, EMPTY_CONSENT, allPoliciesAccepted, PolicyConsentValue } from "../components/shared/PolicyConsent";
import { POLICIES_VERSION } from "../data/policies";
import { logAndGetSafeMessage } from "../lib/errors";
import { signOut } from "../lib/hooks/useAuth";
import { showToast } from "../components/shared/Toast";

export default function EditProfileScreen() {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { user, loading: userLoading } = useCurrentUser();
  const { profile, isLoading, update } = useProfile();
  const logMedia = useLogMedia();
  const insets = useSafeAreaInsets();
  // ↔ وضع الإكمال الإجبارى بعد أول تسجيل دخول بجوجل (app/(tabs)/_layout.tsx → useAccountTypeGate):
  // نوع الحساب لازم يتحدد، مفيش زر إغلاق ولا رجوع، وزر «استمر» ثابت فى أسفل الصفحة بخلفية خضراء.
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const isOnboarding = (Array.isArray(onboarding) ? onboarding[0] : onboarding) === "1";

  useEffect(() => {
    if (!isOnboarding || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [isOnboarding]);

  useEffect(() => {
    if (userLoading) return;
    if (!user || user.is_anonymous) {
      signOut().finally(() => router.replace("/"));
    }
  }, [user, userLoading]);

  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormValue>(EMPTY_PROFILE_FORM);
  const patchForm = (patch: Partial<ProfileFormValue>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (patch.accountType) setAccountTypeError(false);
  };
  const [accountTypeError, setAccountTypeError] = useState(false);
  // ↔ موافقة الشروط والسياسات: بتظهر وبتتطلب فى وضع الإكمال بعد جوجل بس (مش فى التعديل من الإعدادات).
  const [consent, setConsent] = useState<PolicyConsentValue>(EMPTY_CONSENT);
  const [consentError, setConsentError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || !profile) return;
    setAvatarUri(profile.avatarUrl);
    setForm(formFromProfile(profile, isOnboarding));
    setHydrated(true);
  }, [profile, hydrated, isOnboarding]);

  function deriveUsername(first: string, last: string, userId: string): string | undefined {
    const base = `${first}${last}`
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\u0600-\u06FF]/g, "");
    if (!base) return undefined;
    const suffix = userId.replace(/-/g, "").slice(-4);
    return `${base}${suffix}`;
  }

  async function pickAvatar() {
    if (!user?.id) return;

    if (Platform.OS !== "web") {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(t("الصلاحية مطلوبة"), t("يرجى إعطاء صلاحية الوصول للصور لاختيار صورة البروفايل."));
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled) return;
    const uri = result.assets[0].uri;
    try {
      const uploadResult = await uploadToCloudinary(uri, "image");
      logMedia.mutate({ ownerId: user.id, type: "image", context: "avatar", result: uploadResult });
      setAvatarUri(uploadResult.url);
      await update.mutateAsync({ avatarUrl: uploadResult.url });
    } catch {
      showToast(`${t("تعذر رفع الصورة")} — ${t("حاول مرة أخرى.")}`);
    }
  }

  async function handleSave() {
    if (!user || user.is_anonymous) {
      Alert.alert(t("تسجيل الدخول مطلوب"), t("سجّل الدخول أولاً لتعديل بيانات حسابك."));
      await signOut();
      router.replace("/");
      return;
    }
    if (!form.accountType) {
      setAccountTypeError(true);
      showToast(t("اختر نوع الحساب أولاً"));
      return;
    }
    const check = checkProfileForm(form, t);
    if (!check.ok) {
      Alert.alert(check.title, check.message);
      return;
    }
    if (isOnboarding && !allPoliciesAccepted(consent)) {
      setConsentError(true);
      showToast(t("يجب الموافقة على جميع الشروط والسياسات للمتابعة"));
      return;
    }
    setSaving(true);

    try {
      const firstName = form.firstName.trim();
      const lastName = form.lastName.trim();
      const basePayload = {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        fullName: [firstName, lastName].filter(Boolean).join(" ") || undefined,
        birthDate: check.birthDate,
        gender: form.gender || undefined,
        nationality: form.nationalityCode || undefined,
        residence: form.residence.trim() || undefined,
        accountType: form.accountType,
        ...check.phone,
        ...(isOnboarding ? { policiesVersion: POLICIES_VERSION } : {}),
      };
      const derivedUsername = deriveUsername(firstName, lastName, user.id);

      try {
        await update.mutateAsync({ ...basePayload, username: derivedUsername });
      } catch (e: unknown) {
        const errorWithCode = e as { message?: string; code?: string };
        const isUsernameConflict = errorWithCode.code === "23505" || errorWithCode.message?.includes("duplicate");
        if (isUsernameConflict && derivedUsername) {
          await update.mutateAsync({ ...basePayload, username: `${derivedUsername}${Math.floor(Math.random() * 90 + 10)}` });
        } else {
          throw e;
        }
      }
      // ↔ الإكمال الإجبارى: «استمر» بتنقله للتطبيق (لو مفيش شاشة قبله، مثلًا تحديث صفحة الويب، نفتح الرئيسية).
      if (isOnboarding) {
        if (router.canGoBack()) router.back();
        else router.replace("/(tabs)");
      } else {
        router.back();
      }
    } catch (e: unknown) {
      const msg = logAndGetSafeMessage("EditProfile.save", e, t("تعذر حفظ البيانات، تحقق من تسجيل الدخول وحاول مرة أخرى"));
      showToast(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {isOnboarding ? (
          <View style={styles.headerSpacer} />
        ) : (
          <Pressable style={styles.closeBtn} onPress={() => router.back()} hitSlop={8}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={themeColors.text} strokeWidth={2}>
              <Path d="M18 6L6 18M6 6l12 12" />
            </Svg>
          </Pressable>
        )}
        <Text style={styles.headerTitle}>{isOnboarding ? t("أكمل بيانات حسابك") : t("تعديل بيانات الحساب")}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {isLoading && !hydrated ? (
        <View style={styles.loadingWrap}><ActivityIndicator color="#22A652" /></View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Pressable style={styles.avatarWrap} onPress={pickAvatar}>
            {avatarUri ? (
              <Image source={{ uri: cldOptimized(avatarUri, "w_300,h_300,c_fill,q_auto,f_auto") }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke="#22A652" strokeWidth={2}>
                <Circle cx={12} cy={8} r={4} /><Path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
              </Svg>
            )}
            <View style={styles.avatarEditBadge}>
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
                <Path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </Svg>
            </View>
          </Pressable>

          <ProfileFields value={form} onChange={patchForm} accountTypeError={accountTypeError} />

          {isOnboarding && (
            <>
              <Text style={styles.consentTitle}>{t("الموافقة على الشروط والسياسات")}</Text>
              <PolicyConsent value={consent} onChange={(v) => { setConsent(v); setConsentError(false); }} error={consentError} />
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ↔ زر الحفظ فى أسفل الصفحة (مش فى الأعلى) بنفس أخضر الشارة المختارة (ذكر/أنثى): «حفظ» فى تعديل البيانات
          من الإعدادات، و«استمر» فى الإكمال الإجبارى بعد جوجل. */}
      {!(isLoading && !hydrated) && (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
          <Pressable style={[styles.continueBtn, saving && { opacity: 0.7 }]} onPress={handleSave} disabled={saving} accessibilityRole="button">
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.continueText}>{isOnboarding ? t("استمر") : t("حفظ")}</Text>}
          </Pressable>
        </View>
      )}
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: themeColors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingTop: Platform.OS === "ios" ? 58 : Platform.OS === "android" ? 42 : 20,
      paddingBottom: 14,
      backgroundColor: themeColors.background,
    },
    closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: themeColors.surface, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 15, fontWeight: "900", color: themeColors.text },
    headerSpacer: { width: 34, height: 34 },
    footer: { paddingHorizontal: 16, paddingTop: 12, backgroundColor: themeColors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: themeColors.border },
    continueBtn: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
    continueText: { color: "white", fontSize: 15.5, fontWeight: "900" },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    scroll: { padding: 16, paddingBottom: 40 },
    avatarWrap: {
      width: 96, height: 96, borderRadius: 48, backgroundColor: themeColors.isDark ? "rgba(34,166,82,0.18)" : "#ecfdf5",
      alignItems: "center", justifyContent: "center", overflow: "hidden", alignSelf: "center", marginBottom: 24, position: "relative",
    },
    avatarEditBadge: { position: "absolute", bottom: 2, right: 2, width: 26, height: 26, borderRadius: 13, backgroundColor: "#111827", borderWidth: 2, borderColor: themeColors.background, alignItems: "center", justifyContent: "center" },
    consentTitle: { fontSize: 13.5, fontWeight: "900", color: themeColors.text, marginTop: 18, marginBottom: 6 },
  });
}