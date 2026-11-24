import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "../lib/hooks/useLanguage";
import { useThemeColors } from "../lib/hooks/useThemeColors";
import { useCurrentUser } from "../lib/hooks/useCurrentUser";
import { useProfile } from "../lib/hooks/useProfile";
import { useCancelCompanyPlanOrder, useConfirmCompanyPlanPayment, useMyCompany } from "../lib/hooks/useCompanies";
import { COMPANY_PLAN_STATUS_LABELS, companyPlanLabel, formatCompanyDate } from "../lib/companies";
import { PaymentSection } from "../components/payments/PaymentSection";
import { showToast } from "../components/shared/Toast";
import { createCompanyStyles, SERVICES_GREEN_LIGHT } from "../components/companies/companyStyles";
import { CompanyScreenHeader } from "../components/companies/CompanyScreenHeader";

// ↔ فاتورة اشتراك الشركة (إظهار الهاتف / معرض الصور / الاثنان): نفس آلية فاتورة المساحة الإعلانية وباقات الريلز —
//   فودافون كاش / اتصالات كاش / إنستاباي + اسم الراسل ثلاثيًا ← مراجعة الأدمن ← التفعيل (30 يومًا تبدأ بعد نهاية المدة الحالية/المجانية).
export default function CompanyPlanInvoiceScreen() {
  const { orderId: raw } = useLocalSearchParams<{ orderId?: string }>();
  const orderId = Array.isArray(raw) ? raw[0] : raw;
  const { t, language } = useLanguage();
  const locale = language === "ar" ? "ar-EG" : "en-US";
  const colors = useThemeColors();
  const styles = createCompanyStyles(colors);
  const insets = useSafeAreaInsets();
  const { user } = useCurrentUser();
  const isGuest = !user || !!user.is_anonymous;
  const { profile } = useProfile();
  const { data: company, isLoading } = useMyCompany(isGuest ? undefined : user?.id);
  const confirm = useConfirmCompanyPlanPayment();
  const cancel = useCancelCompanyPlanOrder();
  const order = company?.orders.find((o) => o.id === orderId);
  const canPay = order?.status === "pending_payment" || order?.status === "submitted" || order?.status === "rejected";
  const fmt = (n: number) => n.toLocaleString(locale);

  function onSubmitPayment(v: { method: string; senderName: string; contactPhone: string }) {
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

  function onCancelOrder() {
    if (!order) return;
    cancel.mutate(order.id, {
      onSuccess: () => { showToast(t("تم إلغاء الطلب")); router.replace("/my-company" as Href); },
      onError: () => showToast(t("تعذر إلغاء الطلب")),
    });
  }

  const Row = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => (
    <View style={styles.row}>
      <Text style={styles.rowKey}>{k}</Text>
      <View style={styles.rowValWrap}><Text style={[styles.rowVal, strong && styles.rowValStrong]}>{v}</Text></View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <CompanyScreenHeader title={t("فاتورة اشتراك الشركة")} color={colors.text} styles={styles} fallback="/my-company" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40, alignSelf: "center", width: "100%", maxWidth: 760 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {isGuest ? (
          <View style={styles.card}>
            <Text style={styles.paragraph}>{t("سجّل الدخول بحسابك أولًا.")}</Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.replace("/" as Href)}><Text style={styles.primaryBtnText}>{t("تسجيل الدخول")}</Text></Pressable>
          </View>
        ) : isLoading && !order ? (
          <ActivityIndicator color={SERVICES_GREEN_LIGHT} style={{ marginTop: 40 }} />
        ) : !order || !company ? (
          <View style={styles.card}><Text style={styles.paragraph}>{t("لم يتم العثور على الطلب.")}</Text></View>
        ) : (
          <>
            <View style={styles.card}>
              <Row k={t("الشركة")} v={company.name} />
              <Row k={t("الاشتراك")} v={t(companyPlanLabel(order.plan))} />
              <Row k={t("المدة")} v={`${order.periodDays} ${t("يومًا")}`} />
              <Row k={t("المبلغ المطلوب")} v={`${fmt(order.priceEgp)} ${t("جنيه")}`} strong />
              <Row k={t("حالة الطلب")} v={t(COMPANY_PLAN_STATUS_LABELS[order.status])} />
              {order.status === "active" && !!order.endsAt && <Row k={t("مفعّل حتى")} v={formatCompanyDate(order.endsAt, locale)} />}
              <Text style={styles.small}>{t("تبدأ المدة بعد انتهاء الفترة المجانية/الاشتراك الحالى لنفس الميزة، فلا يضيع عليك أى وقت مدفوع.")}</Text>
            </View>

            {order.status === "active" && (
              <View style={[styles.card, styles.okCard]}>
                <Text style={styles.okTitle}>✅ {t("تم تفعيل الاشتراك")}</Text>
                <Text style={styles.paragraph}>{t("الميزة المشتركة ظاهرة الآن للزوار فى صفحة شركتك حتى انتهاء المدة.")}</Text>
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
                <Text style={styles.paragraph}>{order.status === "expired" ? t("انتهت مدة هذا الاشتراك.") : t("تم إلغاء هذا الطلب.")}</Text>
              </View>
            )}

            {canPay && (
              <PaymentSection
                key={`${order.id}:${order.status}`}
                submitting={confirm.isPending}
                onSubmit={onSubmitPayment}
                initialPhone={profile?.phoneE164}
                submitted={order.status === "submitted" ? { method: order.paymentMethod, senderName: order.paymentSenderName, contactPhone: order.paymentContactPhone } : null}
                footnote={t("بعد الإرسال تراجع الإدارة التحويل ثم تفعّل الاشتراك. تُحفظ هذه البيانات لمراجعة السداد فقط (سياسة الخصوصية).")}
              />
            )}
            {order.status === "pending_payment" && (
              <Pressable style={styles.linkBtn} onPress={onCancelOrder} disabled={cancel.isPending}>
                <Text style={styles.dangerLink}>{t("إلغاء الطلب")}</Text>
              </Pressable>
            )}
          </>
        )}

        <Pressable style={styles.linkBtn} onPress={() => router.push("/policy/sales" as Href)}>
          <Text style={styles.link}>{t("سياسة البيع والرسوم")}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
