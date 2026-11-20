import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { physicalSide } from "../../lib/rtl";

// ↔ كارت «احمي استثمارك» (كان «وكيلك القانونى»): علامة تعجب «!» فى الركن الأعلى الأيمن + نافذة صغيرة بتوضّح الغرض من الخدمة
// وزر «تواصل معانا» (أخضر) بيفتح الواتساب بنفس منطق الكارت (handleMenuPress فى app/(tabs)/menu.tsx).
// شغّال بنفس الكود على أندرويد/آيفون/الويب/APK — الركن «الأيمن» فعليًا على كل المنصات عبر physicalSide.
export const INFO_BADGE_SIZE = 20;
// مساحة إضافية حوالين الكارت (أعلى + يمين) لاستيعاب العلامة جوه حدود الـ View الأب — لأن أندرويد ما بيستقبلش لمس خارج حدود الأب،
// فالعلامة لازم تبقى جوه الحدود عشان تتضغط بالكامل. الكارت نفسه بيتصغّر بالمقدار ده فقط.
export const INFO_BADGE_GUTTER = 11;

export function InfoBadge({ onPress, label }: { onPress: () => void; label: string }) {
  const side = physicalSide(false); // الجهة اللى بتظهر «يمين» فعليًا
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.badge, { top: 0, [side]: 0 }]}
    >
      <Text style={styles.badgeText}>!</Text>
    </Pressable>
  );
}

export function ProtectInfoModal({ visible, onClose, onContact }: { visible: boolean; onClose: () => void; onContact: () => void }) {
  const { t } = useLanguage();
  const points = [
    t("احمي استثمارك مع وكيلك القانوني"),
    t("خليك في الأمان وهنساعدك في التحري من العقود"),
    t("هنكون معاك في كل خطوة حتى إتمام التعاقد"),
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("إغلاق")} />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.card}>
          <Pressable style={[styles.closeBtn, { [physicalSide(true)]: 12 }]} onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("إغلاق")}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>

          <View style={styles.list}>
            {points.map((p, i) => (
              <View key={i} style={styles.row}>
                <View style={styles.bullet} />
                <Text style={[styles.point, i === 0 && styles.pointMain]}>{p}</Text>
              </View>
            ))}
          </View>

          {/* زر «تواصل معانا»: بخلفية خضراء — بيفتح الواتساب زى الضغط على الكارت */}
          <Pressable style={styles.cta} onPress={onContact} accessibilityRole="button" accessibilityLabel={t("تواصل معانا")}>
            <Text style={styles.ctaText}>{t("تواصل معانا")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    width: INFO_BADGE_SIZE,
    height: INFO_BADGE_SIZE,
    borderRadius: INFO_BADGE_SIZE / 2,
    backgroundColor: "#5B2A12", // بنى الكارت
    borderWidth: 1.5,
    borderColor: "#E9BC78", // ذهبى الإطار
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
    elevation: 6,
  },
  badgeText: { color: "#FFF1D0", fontSize: 13, fontWeight: "900", lineHeight: 16, includeFontPadding: false, textAlign: "center" },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  wrap: { flex: 1, justifyContent: "center", paddingHorizontal: 26 },
  card: { backgroundColor: "#FFFDF8", borderRadius: 20, padding: 20, paddingTop: 44, gap: 18, borderWidth: 1.5, borderColor: "#E9BC78" },
  closeBtn: { position: "absolute", top: 12, width: 28, height: 28, borderRadius: 14, backgroundColor: "#F3E7D0", alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 13, color: "#5B2A12", fontWeight: "900" },
  list: { gap: 12 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bullet: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#B9852F", marginTop: 8 },
  point: { flex: 1, fontSize: 14.5, lineHeight: 24, color: "#2C1A10", fontWeight: "700" },
  pointMain: { fontSize: 16, fontWeight: "900", color: "#4A2410" },
  cta: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 13, alignItems: "center" },
  ctaText: { color: "white", fontSize: 15, fontWeight: "900" },
});
