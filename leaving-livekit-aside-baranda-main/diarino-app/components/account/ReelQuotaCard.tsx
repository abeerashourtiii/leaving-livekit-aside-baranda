import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router, type Href } from "expo-router";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useReelPlanSettings, useReelQuota, planExtra } from "../../lib/hooks/useReelPlans";
import { ReelPlanModal } from "./ReelPlanModal";

// ↔ عدّاد الريلز فى «إدارة الحساب»: (الريلز المستخدمة / الحد الإجمالى المتاح) + شريط تقدّم + حالة الباقة وتاريخ انتهائها/فترة السماح
//   + زر ترقية/تجديد الباقة + طلب الباقة المعلّق (بانتظار السداد/المراجعة). الحد المجاني 20، ويرتفع بالباقات الشهرية (reel_plan_settings).
export function ReelQuotaCard() {
  const { t, language } = useLanguage();
  const locale = language === "ar" ? "ar-EG" : "en-US";
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { user } = useCurrentUser();
  const { settings } = useReelPlanSettings();
  const { data: quota } = useReelQuota(user?.id);
  const [open, setOpen] = useState(false);

  if (!user || !quota || quota.unavailable) return null;

  const fmt = (n: number) => n.toLocaleString(locale);
  const fmtDate = (iso: string | null) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }); } catch { return ""; }
  };
  const ratio = quota.cap > 0 ? Math.min(1, quota.used / quota.cap) : 0;
  const barColor = quota.used >= quota.cap ? "#DC2626" : ratio >= 0.8 ? "#D97706" : "#22A652";
  const over = quota.used > quota.cap;

  const stateLine = (() => {
    if (quota.state === "active" && quota.plan) return `${t("باقة")} +${fmt(planExtra(settings, quota.plan))} ${t("ريل")} — ${t("تنتهي")} ${fmtDate(quota.endsAt)}`;
    if (quota.state === "grace" && quota.plan) return `${t("انتهت باقتك — فترة سماح حتى")} ${fmtDate(quota.graceEndsAt)}. ${t("جدّد لتفادي إيقاف النشر.")}`;
    if (quota.state === "lapsed") return t("انتهت باقتك وفترة السماح — عاد الحد إلى الحد المجاني.");
    return `${t("الحد المجاني")}: ${fmt(quota.freeLimit)} ${t("ريل")}`;
  })();

  return (
    <>
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.title}>{t("ريلزك")}</Text>
          <Text style={[styles.count, { color: barColor }]}>{`${fmt(quota.used)} / ${fmt(quota.cap)}`}</Text>
        </View>
        <View style={styles.barBg}>
          <View style={[styles.barFill, { width: `${Math.max(2, Math.round(ratio * 100))}%`, backgroundColor: barColor }]} />
        </View>
        <Text style={styles.line}>{stateLine}</Text>
        {over ? <Text style={styles.warn}>{t("لديك ريلز أكثر من الحد المتاح: لا يمكنك نشر ريل جديد قبل حذف ما يكفي من ريلزك أو الاشتراك في باقة.")}</Text> : null}
        {!over && !quota.canPublish ? <Text style={styles.warn}>{t("وصلت للحد الأقصى: احذف ريلًا قديمًا لإتاحة مكان لإعلان جديد، أو اشترك في باقة شهرية.")}</Text> : null}
        {quota.pendingOrder ? (
          <Pressable onPress={() => router.push({ pathname: "/reel-plan-invoice", params: { id: quota.pendingOrder!.id } } as Href)}>
            <Text style={styles.link}>
              {quota.pendingOrder.status === "submitted" ? t("طلب باقتك قيد المراجعة — عرض الفاتورة") : t("لديك طلب باقة بانتظار السداد — عرض الفاتورة")}
            </Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.btn} onPress={() => setOpen(true)} accessibilityRole="button">
          <Text style={styles.btnText}>{quota.state === "active" || quota.state === "grace" ? t("ترقية / تجديد الباقة") : t("زيادة مساحة الريلز (باقات شهرية)")}</Text>
        </Pressable>
      </View>
      <ReelPlanModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 16, padding: 14, gap: 8, borderWidth: 1, borderColor: c.border, marginBottom: 12 },
    rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { fontSize: 14, fontWeight: "900", color: c.text },
    count: { fontSize: 16, fontWeight: "900" },
    barBg: { height: 8, borderRadius: 4, backgroundColor: c.surface, overflow: "hidden" },
    barFill: { height: 8, borderRadius: 4 },
    line: { fontSize: 12, color: c.textSubtle, lineHeight: 19 },
    warn: { fontSize: 12, color: "#B91C1C", fontWeight: "800", lineHeight: 19 },
    link: { color: "#22A652", fontWeight: "800", textDecorationLine: "underline", fontSize: 12.5 },
    btn: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 10, alignItems: "center", marginTop: 2 },
    btnText: { color: "white", fontWeight: "900", fontSize: 13 },
  });
}
