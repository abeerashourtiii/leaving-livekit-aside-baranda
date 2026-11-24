import { useEffect, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, type Href } from "expo-router";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import {
  ReelPlanKey, planExtra, planPrice, useCreateReelPlanOrder, useReelPlanSettings, useReelQuota,
} from "../../lib/hooks/useReelPlans";
import { showToast } from "../shared/Toast";

// ↔ اختيار باقة الريلز الشهرية (تُفتح من عدّاد الريلز فى «إدارة الحساب» ومن نافذة بلوغ الحد عند النشر):
//   باقة 1: +30 ريل (إجمالى 50) · باقة 2: +100 ريل (إجمالى 120) — أسعار الباقتين من reel_plan_settings (300 / 800 ج.م شهريًا افتراضيًا).
//   «متابعة الدفع» تُنشئ الطلب (أو تعيد الطلب المفتوح لنفس الباقة) وتفتح فاتورة السداد (app/reel-plan-invoice.tsx): فودافون كاش / اتصالات كاش / إنستاباي،
//   والتفعيل بعد مراجعة التطبيق للسداد. الاشتراك 30 يومًا ثم فترة سماح 30 يومًا (سياسة البيع والرسوم، بند باقات الريلز).
type Props = { visible: boolean; onClose: () => void };

export function ReelPlanModal({ visible, onClose }: Props) {
  const { t, language } = useLanguage();
  const locale = language === "ar" ? "ar-EG" : "en-US";
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { user } = useCurrentUser();
  const { settings } = useReelPlanSettings();
  const { data: quota } = useReelQuota(user?.id);
  const create = useCreateReelPlanOrder();
  const [plan, setPlan] = useState<ReelPlanKey>("plan1");

  useEffect(() => {
    if (visible) setPlan(quota?.plan ?? "plan1");
  }, [visible, quota?.plan]);

  const fmt = (n: number) => n.toLocaleString(locale);
  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }); } catch { return ""; }
  };

  function submit() {
    if (create.isPending) return;
    create.mutate(plan, {
      onSuccess: ({ id }) => {
        onClose();
        setTimeout(() => router.push({ pathname: "/reel-plan-invoice", params: { id } } as Href), 350);
      },
      onError: (err) => {
        const code = err instanceof Error ? err.message : "";
        if (code === "not_owner") showToast(t("سجّل الدخول بحسابك لشراء باقة"));
        else showToast(t("تعذر إصدار الفاتورة، حاول مرة أخرى"));
      },
    });
  }

  const renew = quota && (quota.state === "active" || quota.state === "grace") && quota.plan === plan;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.card}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>{t("باقات الريلز الشهرية")}</Text>
            <Text style={styles.sub}>{`${t("الحد المجاني")}: ${fmt(settings.freeLimit)} ${t("ريل")}`}</Text>

            {(["plan1", "plan2"] as ReelPlanKey[]).map((k) => {
              const on = plan === k;
              return (
                <Pressable
                  key={k}
                  style={[styles.option, on && styles.optionOn]}
                  onPress={() => setPlan(k)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.optionTitle, on && styles.optionTitleOn]}>{`+${fmt(planExtra(settings, k))} ${t("ريل")}`}</Text>
                  <Text style={styles.optionDesc}>{`${t("الإجمالي")}: ${fmt(settings.freeLimit + planExtra(settings, k))} ${t("ريل")}`}</Text>
                  <Text style={styles.optionPrice}>{`${fmt(planPrice(settings, k))} ${t("جنيه شهريًا")}`}</Text>
                  {quota?.plan === k && (quota.state === "active" || quota.state === "grace") ? (
                    <Text style={styles.current}>
                      {quota.state === "active" ? `${t("باقتك الحالية — تنتهي")} ${fmtDate(quota.endsAt)}` : `${t("باقتك الحالية في فترة السماح حتى")} ${fmtDate(quota.graceEndsAt)}`}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}

            <Text style={styles.small}>
              {t("مدة الاشتراك 30 يومًا. بعد انتهائه دون تجديد تبقى مساحة الباقة 30 يومًا (فترة سماح) تستمر خلالها ريلزك الإضافية في الظهور، ثم يعود الحد إلى الحد المجاني ويُمنع نشر ريلز جديدة حتى التجديد أو حذف ما يكفي من ريلزك. السداد عبر فودافون كاش أو اتصالات كاش أو إنستاباي ويُفعَّل الاشتراك بعد مراجعة السداد.")}
            </Text>

            <View style={styles.actionsRow}>
              <Pressable style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelBtnText}>{t("إغلاق")}</Text>
              </Pressable>
              <Pressable style={[styles.confirmBtn, create.isPending && styles.confirmBtnDisabled]} onPress={submit} disabled={create.isPending}>
                {create.isPending ? <ActivityIndicator color="white" /> : <Text style={styles.confirmBtnText}>{renew ? t("تجديد ومتابعة الدفع") : t("متابعة الدفع")}</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: { flex: 1, justifyContent: "center", paddingHorizontal: 18 },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    card: { backgroundColor: c.card, borderRadius: 18, padding: 18, maxHeight: "90%" },
    title: { fontSize: 16, fontWeight: "900", color: c.text, textAlign: "center" },
    sub: { fontSize: 12.5, color: c.textSubtle, textAlign: "center", marginTop: 4, marginBottom: 12 },
    option: { borderWidth: 1.5, borderColor: c.border, borderRadius: 14, padding: 12, marginBottom: 8, backgroundColor: c.surface, gap: 3 },
    optionOn: { borderColor: "#22A652", backgroundColor: c.isDark ? "rgba(34,166,82,0.16)" : "#ecfdf3" },
    optionTitle: { fontSize: 15, fontWeight: "900", color: c.text },
    optionTitleOn: { color: "#15803D" },
    optionDesc: { fontSize: 12, color: c.textSubtle },
    optionPrice: { fontSize: 13.5, fontWeight: "900", color: "#22A652", marginTop: 2 },
    current: { fontSize: 11.5, color: "#B45309", fontWeight: "800", marginTop: 2 },
    small: { fontSize: 11.5, color: c.textSubtle, lineHeight: 18, marginTop: 6, marginBottom: 12 },
    actionsRow: { flexDirection: "row", gap: 10 },
    cancelBtn: { flex: 0.8, borderRadius: 999, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: c.border },
    cancelBtnText: { fontSize: 13, fontWeight: "900", color: c.textMuted },
    confirmBtn: { flex: 1.4, borderRadius: 999, paddingVertical: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#22A652" },
    confirmBtnDisabled: { opacity: 0.5 },
    confirmBtnText: { fontSize: 13, fontWeight: "900", color: "white", textAlign: "center" },
  });
}
