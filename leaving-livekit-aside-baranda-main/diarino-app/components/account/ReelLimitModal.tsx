import { useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { router, type Href } from "expo-router";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useReelPlanSettings, useReelQuota } from "../../lib/hooks/useReelPlans";
import { ReelPlanModal } from "./ReelPlanModal";

// ↔ تظهر عند محاولة نشر ريل جديد بعد بلوغ الحد (20 مجانًا أو حد الباقة): تخيّر المعلن بين
//   (١) حذف إعلان قديم لإتاحة مكان لإعلان جديد (يفتح «إعلاناتي» فى إدارة الحساب)  أو  (٢) الترقية بباقة شهرية.
export function ReelLimitModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, language } = useLanguage();
  const locale = language === "ar" ? "ar-EG" : "en-US";
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { user } = useCurrentUser();
  const { data: quota } = useReelQuota(user?.id);
  const { settings } = useReelPlanSettings();
  const [plansOpen, setPlansOpen] = useState(false);
  const fmt = (n: number) => n.toLocaleString(locale);

  return (
    <>
      <Modal visible={visible && !plansOpen} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.wrap}>
          <Pressable style={styles.backdrop} onPress={onClose} />
          <View style={styles.card}>
            <Text style={styles.title}>{t("وصلت للحد الأقصى من الريلز")}</Text>
            {quota ? <Text style={styles.count}>{`${fmt(quota.used)} / ${fmt(quota.cap)}`}</Text> : null}
            <Text style={styles.text}>{t("لنشر ريل جديد اختر أحد الحلّين:")}</Text>
            <Pressable
              style={styles.optionBtn}
              onPress={() => { onClose(); setTimeout(() => router.push("/(tabs)/account?tab=ads" as Href), 250); }}
              accessibilityRole="button"
            >
              <Text style={styles.optionTitle}>{t("حذف إعلان قديم")}</Text>
              <Text style={styles.optionDesc}>{t("احذف أحد إعلاناتك من «إعلاناتي» ليتاح مكانه لإعلان جديد فورًا.")}</Text>
            </Pressable>
            <Pressable style={[styles.optionBtn, styles.optionPrimary]} onPress={() => setPlansOpen(true)} accessibilityRole="button">
              <Text style={[styles.optionTitle, { color: "white" }]}>{t("الترقية بباقة شهرية")}</Text>
              <Text style={[styles.optionDesc, { color: "rgba(255,255,255,0.9)" }]}>{`${t("زِد مساحة ريلزك")}: +${fmt(settings.plan1Extra)} ${t("ريل")} (${fmt(settings.plan1PriceEgp)} ${t("جنيه شهريًا")}) ${t("أو")} +${fmt(settings.plan2Extra)} ${t("ريل")} (${fmt(settings.plan2PriceEgp)} ${t("جنيه شهريًا")})`}</Text>
            </Pressable>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeText}>{t("إغلاق")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <ReelPlanModal visible={visible && plansOpen} onClose={() => { setPlansOpen(false); onClose(); }} />
    </>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: { flex: 1, justifyContent: "center", paddingHorizontal: 22 },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
    card: { backgroundColor: c.card, borderRadius: 18, padding: 18, gap: 10 },
    title: { fontSize: 16, fontWeight: "900", color: c.text, textAlign: "center" },
    count: { fontSize: 22, fontWeight: "900", color: "#DC2626", textAlign: "center" },
    text: { fontSize: 13, color: c.textSubtle, textAlign: "center" },
    optionBtn: { borderWidth: 1.5, borderColor: c.border, borderRadius: 14, padding: 12, gap: 3, backgroundColor: c.surface },
    optionPrimary: { backgroundColor: "#22A652", borderColor: "#22A652" },
    optionTitle: { fontSize: 14, fontWeight: "900", color: c.text },
    optionDesc: { fontSize: 12, color: c.textSubtle, lineHeight: 18 },
    closeBtn: { alignItems: "center", paddingVertical: 8 },
    closeText: { fontSize: 13, fontWeight: "800", color: c.textMuted },
  });
}
