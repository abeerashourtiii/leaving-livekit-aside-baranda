import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useThemeColors } from "../../lib/hooks/useThemeColors";
import { useLanguage } from "../../lib/hooks/useLanguage";

// ↔ نافذة تقدّم نشر الإعلان: بتعرض مراحل العملية بالترتيب (ضغط الفيديو ← رفع الملفات
// ← نشر الإعلان) مع نسبة المرحلة الحالية، وبتحذّر المستخدم إنه ما يقفلش التطبيق.
// Modal شفّاف بيحجب أي لمس تحته، وزر الرجوع على أندرويد متعطّل (onRequestClose فاضي)
// — فمفيش طريقة يخرج بيها بالغلط أثناء الضغط/الرفع. نفس الكومبوننت على أندرويد/آيفون/ويب.
export type UploadPhase = "compress" | "upload" | "publish";

const GREEN = "#22A652";

export function UploadProgressModal({
  visible, phase, progress, withCompression,
}: { visible: boolean; phase: UploadPhase; progress: number; withCompression: boolean }) {
  const themeColors = useThemeColors();
  const { t } = useLanguage();

  const steps: { key: UploadPhase; label: string }[] = [
    ...(withCompression ? [{ key: "compress" as const, label: t("ضغط الفيديو") }] : []),
    { key: "upload", label: t("رفع الملفات") },
    { key: "publish", label: t("جاري نشر الإعلان") },
  ];
  const activeIndex = steps.findIndex((s) => s.key === phase);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>
          <Text style={[styles.title, { color: themeColors.text }]}>{t("جاري تجهيز إعلانك")}</Text>

          {steps.map((step, i) => {
            const done = i < activeIndex;
            const active = i === activeIndex;
            const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
            return (
              <View key={step.key} style={styles.stepBlock}>
                <View style={styles.stepRow}>
                  <View style={[styles.dot, done && { backgroundColor: GREEN, borderColor: GREEN }, active && { borderColor: GREEN }]}>
                    {done && (
                      <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5}>
                        <Path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    )}
                  </View>
                  <Text
                    style={[styles.stepLabel, { color: done || active ? themeColors.text : themeColors.textSubtle }, active && { fontWeight: "900" }]}
                  >
                    {step.label}
                  </Text>
                  {active && step.key !== "publish" && <Text style={[styles.pct, { color: GREEN }]}>{pct}%</Text>}
                  {active && step.key === "publish" && <ActivityIndicator size="small" color={GREEN} />}
                </View>
                {active && step.key !== "publish" && (
                  <View style={[styles.track, { backgroundColor: themeColors.isDark ? "#2E3237" : "#E5E7EB" }]}>
                    <View style={[styles.fill, { width: `${pct}%` }]} />
                  </View>
                )}
              </View>
            );
          })}

          <Text style={[styles.warning, { color: themeColors.textSubtle }]}>
            {t("لا تغلق التطبيق ولا تغادر هذه الشاشة حتى يكتمل الرفع.")}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 420, borderRadius: 22, borderWidth: 1, padding: 20, gap: 14 },
  title: { fontSize: 17, fontWeight: "900", textAlign: "center", marginBottom: 2 },
  stepBlock: { gap: 8 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#9CA3AF", alignItems: "center", justifyContent: "center" },
  stepLabel: { flex: 1, fontSize: 14, fontWeight: "700" },
  pct: { fontSize: 13, fontWeight: "900" },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: GREEN, borderRadius: 4 },
  warning: { fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 4 },
});
