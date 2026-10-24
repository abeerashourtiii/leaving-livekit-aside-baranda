import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../lib/hooks/useThemeColors";
import { useCurrentUser } from "../lib/hooks/useCurrentUser";
import { useProfile } from "../lib/hooks/useProfile";
import { useDealSettings, useMyDeals, useConfirmDealPayment, DEAL_STATUS_LABELS, Deal } from "../lib/hooks/useDeals";
import { PaymentSection } from "../components/payments/PaymentSection";
import { showToast } from "../components/shared/Toast";

// ↔ صفحة «فاتورة رسوم الخدمة» (سياسة البيع والرسوم): بتتفتح بعد «تم البيع / تم الإيجار» ومن قائمة ⋮ على الإعلان المُغلق.
// السداد بإحدى 3 طرق (فودافون كاش / اتصالات كاش / إنستاباي) عبر components/payments/PaymentSection.tsx — وبعد التحويل
// يؤكد الناشر بعلامة «تم السداد» ويكتب اسم الراسل ثلاثيًا ورقم التواصل (بدون إيميل إنستاباي)، فتتحوّل الحالة إلى
// «بانتظار مراجعة التطبيق» وتراجعها الإدارة من قسم «الصفقات والرسوم».
// الصفحة شاشة عادية (مش Modal) فتشتغل بنفس الشكل على أندرويد وآيفون والويب وAPK.
function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
}

export default function InvoiceScreen() {
  const { propertyId: rawId } = useLocalSearchParams<{ propertyId?: string }>();
  const propertyId = Array.isArray(rawId) ? rawId[0] : rawId;
  const { t, language } = useLanguage();
  const locale = language === "ar" ? "ar-EG" : "en-US";
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const insets = useSafeAreaInsets();
  const { user } = useCurrentUser();
  const { profile } = useProfile();
  useDealSettings();
  const { data: myDeals, isLoading } = useMyDeals(user?.id);
  const confirm = useConfirmDealPayment();
  const [sentOnce, setSentOnce] = useState(false);

  const deal: Deal | undefined = propertyId ? myDeals?.get(propertyId) : undefined;
  const isPaid = deal?.status === "paid";
  const alreadySubmitted = deal?.status === "submitted";

  const feeText = deal ? deal.feeEgp.toLocaleString(locale) : "";
  const isRent = deal?.dealType === "rent";

  function onSubmit(v: { method: string; senderName: string; contactPhone: string }) {
    if (!deal) return;
    confirm.mutate(
      { dealId: deal.id, method: v.method, senderName: v.senderName, contactPhone: v.contactPhone },
      {
        onSuccess: () => {
          setSentOnce(true);
          showToast(t("تم إرسال تأكيد السداد، وسيراجعه فريق التطبيق"));
        },
        onError: (err) => {
          const code = err instanceof Error ? err.message : "";
          if (code === "deal_closed") showToast(t("هذه الفاتورة مغلقة بالفعل"));
          else if (code === "bad_sender_name") showToast(t("اكتب اسم الراسل ثلاثيًا"));
          else if (code === "bad_contact_phone") showToast(t("اكتب رقمًا صحيحًا للتواصل"));
          else if (code === "bad_method") showToast(t("اختر طريقة السداد"));
          else showToast(t("تعذر إرسال تأكيد السداد، حاول مرة أخرى"));
        },
      }
    );
  }

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/account" as Href);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable style={styles.closeBtn} onPress={close} hitSlop={8} accessibilityRole="button">
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={themeColors.text} strokeWidth={2}>
              <Path d="M18 6L6 18M6 6l12 12" />
            </Svg>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{t("فاتورة رسوم الخدمة")}</Text>
          <View style={{ width: 34 }} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {isLoading && !deal ? (
            <ActivityIndicator color="#22A652" style={{ marginTop: 40 }} />
          ) : !deal ? (
            <View style={styles.card}>
              <Text style={styles.paragraph}>{t("لا توجد فاتورة لهذا الإعلان. تظهر الفاتورة بعد تسجيل «تم البيع» أو «تم الإيجار».")}</Text>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.propertyTitle} numberOfLines={2}>{deal.propertyTitle || "—"}</Text>
                <Row styles={styles} k={t("نوع الصفقة")} v={isRent ? t("تم الإيجار") : t("تم البيع")} />
                <Row styles={styles} k={t("البند")} v={t("رسوم الخدمة")} />
                <Row styles={styles} k={t("المبلغ المستحق")} v={`${feeText} ${t("جنيه")}`} strong />
                <Row styles={styles} k={t("حالة الفاتورة")} v={t(DEAL_STATUS_LABELS[deal.status])} />
                {!!deal.dueAt && !isPaid && <Row styles={styles} k={t("آخر موعد للسداد")} v={formatDate(deal.dueAt, locale)} />}
                {!!deal.paidAt && <Row styles={styles} k={t("تاريخ السداد")} v={formatDate(deal.paidAt, locale)} />}
              </View>

              {isPaid ? (
                <View style={[styles.card, styles.okCard]}>
                  <Text style={styles.okTitle}>✅ {t("تم تأكيد السداد من التطبيق")}</Text>
                  <Text style={styles.paragraph}>{t("شكرًا لك. تم سداد رسوم الخدمة لهذه الصفقة.")}</Text>
                </View>
              ) : (
                <PaymentSection
                  key={`${deal.id}:${alreadySubmitted || sentOnce ? "s" : "n"}`}
                  submitting={confirm.isPending}
                  onSubmit={onSubmit}
                  initialPhone={profile?.phoneE164}
                  submitted={alreadySubmitted ? { method: deal.paymentMethod ?? null, senderName: deal.paymentSenderName ?? null, contactPhone: deal.paymentContactPhone ?? null } : null}
                  footnote={t("بعد الإرسال يراجع التطبيق التحويل ويؤكد السداد. تُحفظ هذه البيانات لمراجعة السداد فقط (سياسة الخصوصية).")}
                />
              )}

              <Pressable style={styles.linkBtn} onPress={() => router.push("/policy/sales" as Href)}>
                <Text style={styles.link}>{t("سياسة البيع والرسوم")}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function Row({ styles, k, v, strong }: { styles: ReturnType<typeof createStyles>; k: string; v: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowKey}>{k}</Text>
      <Text style={[styles.rowVal, strong && styles.rowValStrong]} selectable>{v}</Text>
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: themeColors.background },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: themeColors.surface },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "800", color: themeColors.text },
    content: { padding: 16, gap: 14 },
    card: { backgroundColor: themeColors.card, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: themeColors.border },
    okCard: { borderColor: "#22A652" },
    propertyTitle: { fontSize: 15, fontWeight: "900", color: themeColors.text, textAlign: "center" },
    paragraph: { fontSize: 13.5, lineHeight: 22, color: themeColors.text, fontWeight: "500" },
    row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
    rowKey: { fontSize: 12.5, color: themeColors.textSubtle, fontWeight: "700" },
    rowVal: { fontSize: 12.5, color: themeColors.text, fontWeight: "800", flexShrink: 1, textAlign: "right" },
    rowValStrong: { color: "#22A652", fontSize: 16 },
    okTitle: { fontSize: 14.5, fontWeight: "900", color: "#15803D" },
    linkBtn: { alignItems: "center", paddingVertical: 6 },
    link: { color: "#22A652", fontWeight: "800", textDecorationLine: "underline", fontSize: 13 },
  });
}
