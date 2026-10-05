import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { usePiPPreference } from "../../lib/hooks/usePiPPreference";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

type Props = { visible: boolean; onClose: () => void };

// ↔ "عرض التطبيق فوق التطبيقات الأخرى (زي يوتيوب)" — تفعيل/ليس الآن.
// مستخدم فى مكانين: app/settings.tsx وقايمة خيارات الريل بالضغط المطول
// (ReelOptionsSheet.tsx) — نفس المودال بالظبط، بيقرأ ويكتب نفس التفضيل
// المشترك (usePiPPreference).
export function PictureInPictureModal({ visible, onClose }: Props) {
  const { t } = useLanguage();
  const { preference, setPreference } = usePiPPreference();
  const isOn = preference === "enabled" || preference === "unset";
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  if (!visible) return null;

  // ↔ الخاصية شغّالة فعليًا دلوقتي (مفعّلة افتراضيًا) — مفيش رسالة "قريباً". الأزرار بتتغيّر
  // حسب الحالة الحالية: لو مفعّلة → "إبقاء التفعيل" / "إلغاء التفعيل"، ولو ملغاة → "تفعيل".
  function handle(next: "enabled" | "declined") {
    setPreference(next);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#22A652" strokeWidth={2}>
            <Rect x={3} y={3} width={18} height={14} rx={2} />
            <Rect x={12} y={11} width={7} height={5} rx={1} fill="#22A652" stroke="none" />
          </Svg>
        </View>
        <Text style={styles.title}>{t("عرض التطبيق فوق التطبيقات الأخرى")}</Text>
        <Text style={styles.body}>
          {t("للسماح باستمرار تشغيل الريلز والفيديوهات في نافذة صغيرة عند مغادرة التطبيق، زي يوتيوب.")}
        </Text>
        <Pressable style={styles.enableBtn} onPress={() => handle("enabled")}>
          <Text style={styles.enableBtnText}>{isOn ? t("إبقاء التفعيل") : t("تفعيل")}</Text>
        </Pressable>
        {isOn && (
          <Pressable style={styles.laterBtn} onPress={() => handle("declined")}>
            <Text style={styles.laterBtnText}>{t("إلغاء التفعيل")}</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
    card: {
      position: "absolute", left: 24, right: 24, top: "35%",
      backgroundColor: themeColors.card, borderRadius: 18, padding: 22, alignItems: "center",
      shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
    },
    iconWrap: {
      width: 56, height: 56, borderRadius: 28, backgroundColor: themeColors.isDark ? "rgba(34,166,82,0.18)" : "#EAF7EE",
      alignItems: "center", justifyContent: "center", marginBottom: 14,
    },
    title: { fontSize: 15, fontWeight: "900", color: themeColors.text, textAlign: "center", marginBottom: 8 },
    body: { fontSize: 12.5, fontWeight: "600", color: themeColors.textSubtle, textAlign: "center", lineHeight: 19, marginBottom: 18 },
    enableBtn: { width: "100%", backgroundColor: "#22A652", borderRadius: 12, paddingVertical: 13, alignItems: "center", marginBottom: 8 },
    enableBtnText: { color: "white", fontWeight: "900", fontSize: 13.5 },
    laterBtn: { width: "100%", paddingVertical: 10, alignItems: "center" },
    laterBtnText: { color: themeColors.textSubtle, fontWeight: "800", fontSize: 13 },
  });
}
