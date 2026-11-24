import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { KeyboardAvoid } from "../components/shared/KeyboardAvoid";
import { router, useLocalSearchParams, type Href } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../lib/hooks/useThemeColors";
import { useCurrentUser } from "../lib/hooks/useCurrentUser";
import { useProfile } from "../lib/hooks/useProfile";
import {
  REEL_PLAN_STATUS_LABELS, useCancelReelPlanOrder, useConfirmReelPlanPayment, useMyReelPlanOrders, useReelPlanSettings,
} from "../lib/hooks/useReelPlans";
import { PaymentSection } from "../components/payments/PaymentSection";
import { showToast } from "../components/shared/Toast";

// ↔ فاتورة «باقة الريلز الشهرية»: تفاصيل الباقة + السداد بإحدى 3 طرق (فودافون كاش / اتصالات كاش / إنستاباي) عبر PaymentSection نفسه المستخدم فى
// فاتورة الترويج والمساحة الإعلانية، ثم تأكيد السداد (طريقة الدفع + اسم الراسل ثلاثيًا + رقم التواصل) ← مراجعة التطبيق ← التفعيل لمدة شهر
// (30 يومًا) + فترة سماح 30 يومًا بعد الانتهاء. شاشة عادية تشتغل على كل المنصات (أندرويد/آيفون/ويب/APK).
function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
}

export default function ReelPlanInvoiceScreen() {
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const { t, language } = useLanguage();
  const locale = language === "ar" ? "ar-EG" : "en-US";
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const insets = useSafeAreaInsets();
  const { user } = useCurrentUser();
  const { profile } = useProfile();
  const { settings } = useReelPlanSettings();
  const { data: orders, isLoading } = useMyReelPlanOrders(user?.id);
  const confirm = useConfirmReelPlanPayment();
  const cancel = useCancelReelPlanOrder();

  const order = orders?.find((o) => o.id === id);
  const canPay = order?.status === "pending_payment" || order?.status === "submitted" || order?.status === "rejected";

  function onSubmit(v: { method: string; senderName: string; contactPhone: string }) {
    if (!order) return;
    confirm.mutate(
      { id: order.id, method: v.method, senderName: v.senderName, contactPhone: v.contactPhone },
      {
        onSuccess: () => showToast(t("تم إرسال تأكيد السداد وقيد المراجعة")),
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
    if (!order) return;
    cancel.mutate(order.id, {
      onSuccess: () => { showToast(t("تم إلغاء طلب الباقة")); close(); },
      onError: () => showToast(t("تعذر إلغاء الطلب")),
    });
  }

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/account" as Href);
  }

  const fmt = (n: number) => n.toLocaleString(locale);

  return (
    <KeyboardAvoid style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable style={styles.closeBtn} onPress={close} hitSlop={8} accessibilityRole="button">
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={themeColors.text} strokeWidth={2}>
              <Path d="M18 6L6 18M6 6l12 12" />
            </Svg>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{t("فاتورة باقة الريلز")}</Text>
          <View style={{ width: 34 }} />
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {isLoading && !order ? (
            <ActivityIndicator color="#22A652" style={{ marginTop: 40 }} />
          ) : !order ? (
            <View style={styles.card}>
              <Text style={styles.paragraph}>{t("لم يتم العثور على طلب الباقة.")}</Text>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.planTitle}>{`${t("باقة الريلز")} +${fmt(order.extraReels)} ${t("ريل")}`}</Text>
                <Row styles={styles} k={t("حدك بعد التفعيل")} v={`${fmt(settings.freeLimit + order.extraReels)} ${t("ريل")}`} />
                <Row styles={styles} k={t("مدة الاشتراك")} v={`${order.periodDays} ${t("يومًا")}`} />
                <Row styles={styles} k={t("المبلغ المطلوب")} v={`${fmt(order.priceEgp)} ${t("جنيه")}`} strong />
                <Row styles={styles} k={t("حالة الطلب")} v={t(REEL_PLAN_STATUS_LABELS[order.status])} />
                {order.status === "active" && !!order.endsAt && <Row styles={styles} k={t("مفعّلة حتى")} v={formatDate(order.endsAt, locale)} />}
                {order.status === "active" && !!order.graceEndsAt && <Row styles={styles} k={t("نهاية فترة السماح")} v={formatDate(order.graceEndsAt, locale)} />}
              </View>

              {order.status === "active" && (
                <View style={[styles.card, styles.okCard]}>
                  <Text style={styles.okTitle}>✅ {t("تم تفعيل الباقة")}</Text>
                  <Text style={styles.paragraph}>{t("تم رفع حد ريلزك. للتجديد قبل الانتهاء اختر الباقة نفسها من صفحة إدارة الحساب وتبدأ فترتها الجديدة بعد انتهاء الحالية.")}</Text>
                </View>
              )}
              {order.status === "rejected" && (
                <View style={[styles.card, styles.badCard]}>
                  <Text style={styles.badTitle}>{t("تم رفض الطلب")}</Text>
                  {!!order.payerNote && <Text style={styles.paragraph}>{order.payerNote}</Text>}
                  <Text style={styles.paragraph}>{t("يمكنك تصحيح بيانات السداد وإعادة إرسالها.")}</Text>
                </View>
              )}
              {(order.status === "expired" || order.status === "cancelled") && (
                <View style={styles.card}>
                  <Text style={styles.paragraph}>{order.status === "expired" ? t("انتهت هذه الباقة.") : t("تم إلغاء هذا الطلب.")}</Text>
                </View>
              )}

              {canPay && (
                <PaymentSection
                  key={`${order.id}:${order.status}`}
                  submitting={confirm.isPending}
                  onSubmit={onSubmit}
                  initialPhone={profile?.phoneE164}
                  submitted={order.status === "submitted" ? { method: order.paymentMethod, senderName: order.paymentSenderName, contactPhone: order.paymentContactPhone } : null}
                  footnote={t("بعد الإرسال يراجع التطبيق التحويل ويفعّل الباقة. تُحفظ هذه البيانات لمراجعة السداد فقط (سياسة الخصوصية).")}
                />
              )}

              {order.status === "pending_payment" && (
                <Pressable style={styles.linkBtn} onPress={onCancel} disabled={cancel.isPending}>
                  <Text style={styles.dangerLink}>{t("إلغاء طلب الباقة")}</Text>
                </Pressable>
              )}

              <Pressable style={styles.linkBtn} onPress={() => router.push("/policy/sales" as Href)}>
                <Text style={styles.link}>{t("سياسة البيع والرسوم")}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoid>
  );
}

function Row({ styles, k, v, strong }: { styles: ReturnType<typeof createStyles>; k: string; v: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowKey}>{k}</Text>
      <View style={styles.rowValWrap}>
        <Text style={[styles.rowVal, strong && styles.rowValStrong]} selectable>{v}</Text>
      </View>
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
    planTitle: { fontSize: 15, fontWeight: "900", color: themeColors.text, textAlign: "center" },
    paragraph: { fontSize: 13.5, lineHeight: 22, color: themeColors.text, fontWeight: "500" },
    row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
    rowKey: { fontSize: 12.5, color: themeColors.textSubtle, fontWeight: "700" },
    rowValWrap: { flex: 1, alignItems: "flex-end" },
    rowVal: { fontSize: 12.5, color: themeColors.text, fontWeight: "800", textAlign: "right" },
    rowValStrong: { color: "#22A652", fontSize: 16 },
    okTitle: { fontSize: 14.5, fontWeight: "900", color: "#15803D" },
    badTitle: { fontSize: 14.5, fontWeight: "900", color: "#DC2626" },
    linkBtn: { alignItems: "center", paddingVertical: 6 },
    link: { color: "#22A652", fontWeight: "800", textDecorationLine: "underline", fontSize: 13 },
    dangerLink: { color: "#DC2626", fontWeight: "800", textDecorationLine: "underline", fontSize: 13 },
  });
}
