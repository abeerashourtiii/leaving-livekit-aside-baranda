import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../lib/hooks/useThemeColors";
import { useCurrentUser } from "../lib/hooks/useCurrentUser";
import { useProfile } from "../lib/hooks/useProfile";
import {
  PROMO_KIND_LABELS, PROMO_STATUS_LABELS, ageGroupLabel, useCancelPromotion, useConfirmPromotionPayment, useMyPromotions,
} from "../lib/hooks/usePromotions";
import { PaymentSection } from "../components/payments/PaymentSection";
import { showToast } from "../components/shared/Toast";

// ↔ فاتورة «الترويج المدفوع» (اجعل الإعلان افتتاحي / مميز): تفاصيل الطلب + السداد بإحدى 3 طرق (PaymentSection) ثم تأكيد السداد
// (طريقة الدفع + اسم الراسل ثلاثيًا + رقم التواصل) ← مراجعة التطبيق ← التفعيل لمدة 7 أيام. شاشة عادية تشتغل على كل المنصات.
function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
}

export default function PromotionInvoiceScreen() {
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const { t, language } = useLanguage();
  const locale = language === "ar" ? "ar-EG" : "en-US";
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const insets = useSafeAreaInsets();
  const { user } = useCurrentUser();
  const { profile } = useProfile();
  const { data: promos, isLoading } = useMyPromotions(user?.id);
  const confirm = useConfirmPromotionPayment();
  const cancel = useCancelPromotion();

  const promo = promos?.find((p) => p.id === id);
  const canPay = promo?.status === "pending_payment" || promo?.status === "submitted" || promo?.status === "rejected";

  function onSubmit(v: { method: string; senderName: string; contactPhone: string }) {
    if (!promo) return;
    confirm.mutate(
      { id: promo.id, method: v.method, senderName: v.senderName, contactPhone: v.contactPhone },
      {
        onSuccess: () => showToast(t("تم إرسال تأكيد السداد، وسيراجعه فريق التطبيق")),
        onError: (err) => {
          const code = err instanceof Error ? err.message : "";
          if (code === "order_closed") showToast(t("هذا الطلب مغلق بالفعل"));
          else if (code === "bad_sender_name") showToast(t("اكتب اسم الراسل ثلاثيًا"));
          else if (code === "bad_contact_phone") showToast(t("اكتب رقمًا صحيحًا للتواصل"));
          else if (code === "bad_method") showToast(t("اختر طريقة السداد"));
          else showToast(t("تعذر إرسال تأكيد السداد، حاول مرة أخرى"));
        },
      }
    );
  }

  function onCancel() {
    if (!promo) return;
    cancel.mutate(promo.id, {
      onSuccess: () => { showToast(t("تم إلغاء طلب الترويج")); close(); },
      onError: () => showToast(t("تعذر إلغاء الطلب")),
    });
  }

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/account" as Href);
  }

  const fmt = (n: number) => n.toLocaleString(locale);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable style={styles.closeBtn} onPress={close} hitSlop={8} accessibilityRole="button">
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={themeColors.text} strokeWidth={2}>
              <Path d="M18 6L6 18M6 6l12 12" />
            </Svg>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{t("فاتورة الترويج")}</Text>
          <View style={{ width: 34 }} />
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {isLoading && !promo ? (
            <ActivityIndicator color="#22A652" style={{ marginTop: 40 }} />
          ) : !promo ? (
            <View style={styles.card}>
              <Text style={styles.paragraph}>{t("لم يتم العثور على طلب الترويج.")}</Text>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.propertyTitle} numberOfLines={2}>{promo.propertyTitle || "—"}</Text>
                <Row styles={styles} k={t("نوع الترويج")} v={t(PROMO_KIND_LABELS[promo.kind])} />
                {promo.kind === "intro" && promo.reachGoal != null && (
                  <Row styles={styles} k={t("الهدف")} v={`${fmt(promo.reachGoal)} ${t("شخص")}`} />
                )}
                <Row styles={styles} k={t("الفئة العمرية")} v={t(ageGroupLabel(promo.ageMin, promo.ageMax))} />
                <Row styles={styles} k={t("مدة الترويج")} v={`${promo.durationDays} ${t("أيام")}`} />
                <Row styles={styles} k={t("المبلغ المطلوب")} v={`${fmt(promo.priceEgp)} ${t("جنيه")}`} strong />
                <Row styles={styles} k={t("حالة الطلب")} v={t(PROMO_STATUS_LABELS[promo.status])} />
                {promo.status === "active" && !!promo.endsAt && <Row styles={styles} k={t("مفعّل حتى")} v={formatDate(promo.endsAt, locale)} />}
                {promo.status === "active" && promo.kind === "intro" && promo.reachGoal != null && (
                  <Row styles={styles} k={t("الوصول حتى الآن")} v={`${fmt(promo.currentReach)} / ${fmt(promo.reachGoal)}`} />
                )}
              </View>

              {promo.status === "active" && (
                <View style={[styles.card, styles.okCard]}>
                  <Text style={styles.okTitle}>✅ {t("تم تفعيل الترويج")}</Text>
                  <Text style={styles.paragraph}>{t("يظهر إعلانك الآن حسب النوع المختار والفئة العمرية المستهدفة حتى انتهاء المدة.")}</Text>
                </View>
              )}
              {promo.status === "rejected" && (
                <View style={[styles.card, styles.badCard]}>
                  <Text style={styles.badTitle}>{t("تم رفض الطلب")}</Text>
                  {!!promo.adminNote && <Text style={styles.paragraph}>{promo.adminNote}</Text>}
                  <Text style={styles.paragraph}>{t("يمكنك تصحيح بيانات السداد وإعادة إرسالها.")}</Text>
                </View>
              )}
              {(promo.status === "expired" || promo.status === "cancelled") && (
                <View style={styles.card}>
                  <Text style={styles.paragraph}>{promo.status === "expired" ? t("انتهت مدة هذا الترويج.") : t("تم إلغاء هذا الطلب.")}</Text>
                </View>
              )}

              {canPay && (
                <PaymentSection
                  key={`${promo.id}:${promo.status}`}
                  submitting={confirm.isPending}
                  onSubmit={onSubmit}
                  initialPhone={profile?.phoneE164}
                  submitted={promo.status === "submitted" ? { method: promo.paymentMethod, senderName: promo.paymentSenderName, contactPhone: promo.paymentContactPhone } : null}
                  footnote={t("بعد الإرسال يراجع التطبيق التحويل ويفعّل الترويج. تُحفظ هذه البيانات لمراجعة السداد فقط (سياسة الخصوصية).")}
                />
              )}

              {promo.status === "pending_payment" && (
                <Pressable style={styles.linkBtn} onPress={onCancel} disabled={cancel.isPending}>
                  <Text style={styles.dangerLink}>{t("إلغاء طلب الترويج")}</Text>
                </Pressable>
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
    badCard: { borderColor: "#DC2626" },
    propertyTitle: { fontSize: 15, fontWeight: "900", color: themeColors.text, textAlign: "center" },
    paragraph: { fontSize: 13.5, lineHeight: 22, color: themeColors.text, fontWeight: "500" },
    row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
    rowKey: { fontSize: 12.5, color: themeColors.textSubtle, fontWeight: "700" },
    rowVal: { fontSize: 12.5, color: themeColors.text, fontWeight: "800", flexShrink: 1, textAlign: "right" },
    rowValStrong: { color: "#22A652", fontSize: 16 },
    okTitle: { fontSize: 14.5, fontWeight: "900", color: "#15803D" },
    badTitle: { fontSize: 14.5, fontWeight: "900", color: "#DC2626" },
    linkBtn: { alignItems: "center", paddingVertical: 6 },
    link: { color: "#22A652", fontWeight: "800", textDecorationLine: "underline", fontSize: 13 },
    dangerLink: { color: "#DC2626", fontWeight: "800", textDecorationLine: "underline", fontSize: 13 },
  });
}
