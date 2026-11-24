import { useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { router, type Href } from "expo-router";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "../lib/hooks/useLanguage";
import { useThemeColors } from "../lib/hooks/useThemeColors";
import { useCurrentUser } from "../lib/hooks/useCurrentUser";
import { useCreateCompanyPlanOrder, useDeleteMyCompany, useMyCompany, type MyCompany } from "../lib/hooks/useCompanies";
import {
  COMPANY_PLANS, COMPANY_PLAN_STATUS_LABELS, COMPANY_STATUS_LABELS, CompanyPlanKey, companyCategoryLabel, companyPlanLabel,
  daysUntil, formatCompanyDate,
} from "../lib/companies";
import { cldOptimized } from "../lib/cloudinary";
import { ConfirmModal } from "../components/shared/ConfirmModal";
import { showToast } from "../components/shared/Toast";
import { createCompanyStyles, SERVICES_GREEN_LIGHT } from "../components/companies/companyStyles";
import { CompanyScreenHeader } from "../components/companies/CompanyScreenHeader";

// ↔ «إدارة شركتي» (من صفحة إدارة الحساب): حالة الشركة، تنبيهات انتهاء الفترة المجانية/الاشتراك، تفعيل باقات الـ100 ج.م
//   (هاتف / صور / الاثنان 200)، تعديل البيانات والصور، حذف الشركة. الدفع بنفس آلية الفواتير فى التطبيق (إصدار فاتورة ← تأكيد سداد ← مراجعة الأدمن).
export default function MyCompanyScreen() {
  const { t, language } = useLanguage();
  const locale = language === "ar" ? "ar-EG" : "en-US";
  const colors = useThemeColors();
  const styles = createCompanyStyles(colors);
  const insets = useSafeAreaInsets();
  const { user, loading: authLoading } = useCurrentUser();
  const isGuest = !user || !!user.is_anonymous;
  const { data: c, isLoading, refetch } = useMyCompany(isGuest ? undefined : user?.id);
  const createOrder = useCreateCompanyPlanOrder();
  const del = useDeleteMyCompany();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fmt = (n: number) => n.toLocaleString(locale);

  function priceOf(plan: CompanyPlanKey, co: MyCompany): number {
    return plan === "phone" ? co.settings.phonePriceEgp : plan === "photos" ? co.settings.photosPriceEgp : co.settings.bothPriceEgp;
  }

  function subscribe(plan: CompanyPlanKey) {
    if (createOrder.isPending) return;
    createOrder.mutate(plan, {
      onSuccess: (row) => router.push({ pathname: "/company-plan-invoice", params: { orderId: row.id } } as Href),
      onError: (err) => {
        const code = err instanceof Error ? err.message : "";
        if (code === "company_not_approved") showToast(t("الاشتراك متاح بعد اعتماد الشركة من الإدارة"));
        else showToast(t("تعذر إصدار الفاتورة، حاول مرة أخرى"));
      },
    });
  }

  function onDelete() {
    del.mutate(undefined, {
      onSuccess: () => {
        setConfirmDelete(false);
        showToast(t("تم حذف الشركة"));
        router.replace("/(tabs)/account" as Href);
      },
      onError: (err) => {
        setConfirmDelete(false);
        const code = err instanceof Error ? err.message : "";
        showToast(code === "has_open_fees" ? t("لديك تأكيد سداد قيد المراجعة، انتظر قرار الإدارة أولًا") : t("تعذر حذف الشركة"));
      },
    });
  }

  function featureRow(label: string, active: boolean, until: string | null) {
    const left = daysUntil(until);
    return (
      <View style={styles.row}>
        <Text style={styles.rowKey}>{label}</Text>
        <View style={styles.rowValWrap}>
          <Text style={[styles.rowVal, { color: active ? "#15803D" : "#DC2626" }]}>
            {active ? `${t("مفعّل حتى")} ${formatCompanyDate(until, locale)}` : t("غير مفعّل — مخفي عن الزوار")}
          </Text>
          {active && left !== null && left <= 7 && <Text style={[styles.small, { color: "#B45309" }]}>{t("متبقي")} {Math.max(left, 0)} {t("يومًا")}</Text>}
        </View>
      </View>
    );
  }

  const warnings: string[] = [];
  if (c && c.status === "approved") {
    const freeLeft = daysUntil(c.freeUntil);
    for (const [feature, active, until, label] of [
      ["phone", c.phoneActive, c.phoneUntil, t("إظهار رقم الهاتف")],
      ["photos", c.photosActive, c.photosUntil, t("معرض صور الأعمال")],
    ] as const) {
      const left = daysUntil(until);
      const inFree = freeLeft !== null && freeLeft > 0 && until === c.freeUntil;
      if (!active) warnings.push(`${t("انتهت مدة")} ${label} — ${t("فعّل الاشتراك ليعود للظهور للزوار.")}`);
      else if (left !== null && left <= 7) warnings.push(`${inFree ? t("تنتهي الفترة المجانية لـ") : t("ينتهى اشتراك ")}${label} ${t("خلال")} ${Math.max(left, 0)} ${t("يومًا — فعّل/جدّد الاشتراك لاستمرار الظهور.")}`);
      void feature;
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <CompanyScreenHeader title={t("إدارة شركتي")} color={colors.text} styles={styles} fallback="/(tabs)/account" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40, alignSelf: "center", width: "100%", maxWidth: 760 }]} showsVerticalScrollIndicator={false}>
        {authLoading || (!isGuest && isLoading) ? (
          <ActivityIndicator color={SERVICES_GREEN_LIGHT} style={{ marginTop: 40 }} />
        ) : isGuest ? (
          <View style={styles.card}>
            <Text style={styles.paragraph}>{t("سجّل الدخول بحسابك لإدارة شركتك.")}</Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.replace("/" as Href)}><Text style={styles.primaryBtnText}>{t("تسجيل الدخول")}</Text></Pressable>
          </View>
        ) : !c ? (
          <View style={styles.card}>
            <Text style={styles.paragraph}>{t("لا توجد شركة مسجّلة بحسابك بعد.")}</Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.replace("/company-form" as Href)}><Text style={styles.primaryBtnText}>{t("أضف شركتك")}</Text></Pressable>
          </View>
        ) : (
          <>
            <View style={[styles.card, { flexDirection: "row", gap: 12, alignItems: "center" }]}>
              <Image source={{ uri: cldOptimized(c.logoUrl, "w_240,q_auto,f_auto") }} style={{ width: 72, height: 72, borderRadius: 14, backgroundColor: colors.surface }} contentFit="cover" />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.sectionTitle} numberOfLines={2}>{c.name}</Text>
                <Text style={styles.small} numberOfLines={2}>{t(companyCategoryLabel(c.category))}</Text>
              </View>
            </View>

            <View style={[styles.card, c.status === "approved" ? styles.okCard : c.status === "rejected" ? styles.badCard : styles.warnCard]}>
              <Text style={c.status === "approved" ? styles.okTitle : c.status === "rejected" ? styles.badTitle : styles.warnTitle}>{t(COMPANY_STATUS_LABELS[c.status])}</Text>
              {c.status === "pending" && <Text style={styles.paragraph}>{t("تراجع الإدارة بيانات شركتك قبل ظهورها للجمهور. ستصلك رسالة عند اتخاذ القرار، وتبدأ الفترة المجانية من تاريخ الموافقة.")}</Text>}
              {c.status === "rejected" && (
                <>
                  {!!c.rejectReason && <Text style={styles.paragraph}>{c.rejectReason}</Text>}
                  <Text style={styles.small}>{t("عدّل البيانات ثم احفظ لإعادة إرسالها للمراجعة.")}</Text>
                </>
              )}
              {c.status === "hidden" && <Text style={styles.paragraph}>{t("تم إخفاء شركتك من قسم «الخدمات» بقرار الإدارة. تواصل مع الدعم للاستفسار.")}</Text>}
              {c.status === "approved" && (
                <Pressable style={styles.outlineBtn} onPress={() => router.push(`/company/${c.id}` as Href)}>
                  <Text style={styles.outlineBtnText}>{t("عرض صفحة شركتي كما يراها الزوار")}</Text>
                </Pressable>
              )}
            </View>

            {warnings.length > 0 && (
              <View style={[styles.card, styles.warnCard]}>
                <Text style={styles.warnTitle}>⚠️ {t("تنبيه")}</Text>
                {warnings.map((w) => <Text key={w} style={styles.paragraph}>{w}</Text>)}
              </View>
            )}

            {c.status === "approved" && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("الميزات والاشتراكات")}</Text>
                <Text style={styles.small}>
                  {t("بيانات شركتك الأساسية (الاسم والصورة والنشاط والوصف والعنوان) ظاهرة للجميع مجانًا دائمًا. أول")} {c.settings.freeDays} {t("يومًا من الموافقة: إظهار الهاتف ومعرض الصور مجانًا، وبعدها اشتراك شهري.")}
                </Text>
                {featureRow(t("إظهار رقم الهاتف"), c.phoneActive, c.phoneUntil)}
                {featureRow(t("معرض صور الأعمال"), c.photosActive, c.photosUntil)}
                <View style={{ gap: 8, marginTop: 4 }}>
                  {COMPANY_PLANS.map((p) => (
                    <Pressable
                      key={p.key}
                      style={[styles.outlineBtn, { paddingVertical: 11 }, createOrder.isPending && styles.btnDisabled]}
                      onPress={() => subscribe(p.key)}
                      disabled={createOrder.isPending}
                      accessibilityRole="button"
                    >
                      <Text style={styles.outlineBtnText}>{t(p.label)} — {fmt(priceOf(p.key, c))} {t("جنيه")} / {c.settings.periodDays} {t("يومًا")}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.small}>{t("يبدأ الاشتراك من انتهاء المدة الحالية فلا يضيع عليك أى وقت مدفوع. الدفع بفودافون كاش / اتصالات كاش / إنستاباي ثم مراجعة الإدارة.")}</Text>
              </View>
            )}

            {c.orders.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("طلبات الاشتراك")}</Text>
                {c.orders.map((o) => (
                  <Pressable key={o.id} style={styles.row} onPress={() => router.push({ pathname: "/company-plan-invoice", params: { orderId: o.id } } as Href)}>
                    <Text style={[styles.rowKey, { flex: 1, color: colors.textMuted }]} numberOfLines={2}>
                      {t(companyPlanLabel(o.plan))} · {fmt(o.priceEgp)} {t("جنيه")} — {t(COMPANY_PLAN_STATUS_LABELS[o.status])}
                    </Text>
                    <Text style={styles.link}>{t("عرض")}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Pressable style={styles.primaryBtn} onPress={() => router.push("/company-form" as Href)}>
              <Text style={styles.primaryBtnText}>{t("تعديل البيانات والصور")}</Text>
            </Pressable>
            <Pressable style={styles.dangerBtn} onPress={() => setConfirmDelete(true)} disabled={del.isPending}>
              <Text style={styles.dangerBtnText}>{t("حذف الشركة")}</Text>
            </Pressable>
            <Pressable style={styles.linkBtn} onPress={() => router.push("/policy/sales" as Href)}>
              <Text style={styles.link}>{t("سياسة البيع والرسوم")}</Text>
            </Pressable>
            <Pressable style={styles.linkBtn} onPress={() => void refetch()}>
              <Text style={styles.small}>{t("تحديث")}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <ConfirmModal
        visible={confirmDelete}
        title={t("حذف الشركة")}
        text={t("سيتم حذف شركتك وصورها نهائيًا من قسم «الخدمات». لا يمكن التراجع. هل أنت متأكد؟")}
        confirmLabel={t("حذف")}
        danger
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </View>
  );
}
