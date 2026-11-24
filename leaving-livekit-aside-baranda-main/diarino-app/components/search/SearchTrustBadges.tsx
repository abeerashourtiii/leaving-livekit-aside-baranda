import { View, Text, StyleSheet } from "react-native";
import Svg, { Path, Circle, Rect, Ellipse, Line } from "react-native-svg";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ ٣ شارات ثقة فى صفحة البحث فقط (قبل «إعلانات مميزة»): بدون عمولة • تواصل مباشر مع المعلن • معاينة حية بالفيديو.
//   الترتيب من اليمين لليسار فى العربى كما فى التصميم (الشارة الأولى «بدون عمولة» على اليمين).
export function SearchTrustBadges() {
  const { t } = useLanguage();
  const c = useThemeColors();
  const items = [
    { key: "nocomm", label: "بدون عمولة", flex: 1, icon: <NoCommissionIcon /> },
    { key: "contact", label: "تواصل مباشر مع المعلن", flex: 1.3, icon: <PhoneIcon /> }, // أعرض قليلًا ليظهر النص فى سطر واحد
    { key: "live", label: "معاينة حية بالفيديو", flex: 1.05, icon: <VideoIcon /> },
  ];
  return (
    <View style={styles.row}>
      {items.map((it) => (
        <View key={it.key} style={[styles.badge, { flex: it.flex, backgroundColor: c.card, borderColor: c.border }]}>
          {it.icon}
          <Text style={[styles.label, { color: c.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{t(it.label)}</Text>
        </View>
      ))}
    </View>
  );
}

function VideoIcon() {
  return (
    <Svg width={ICON} height={ICON} viewBox="0 0 24 24">
      <Rect x={2} y={6} width={13} height={12} rx={3} fill="#1D6FD8" />
      <Path d="M16.5 10.2L22 7v10l-5.5-3.2z" fill="#1D6FD8" />
    </Svg>
  );
}

function PhoneIcon() {
  return (
    <Svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="#1D6FD8" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 3h4l2 5-2.5 1.5a11 11 0 005 5L15 12.5l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z" />
      <Path d="M15 3.5a5.5 5.5 0 015.5 5.5M15 6.5a2.5 2.5 0 012.5 2.5" />
    </Svg>
  );
}

function NoCommissionIcon() {
  return (
    <Svg width={ICON} height={ICON} viewBox="0 0 24 24">
      <Ellipse cx={12} cy={9} rx={6} ry={2.2} fill="#F5B301" />
      <Path d="M6 9v3c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V9" fill="#E59E00" />
      <Path d="M6 12v3c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2v-3" fill="#F5B301" />
      <Circle cx={12} cy={12} r={10} fill="none" stroke="#E11D48" strokeWidth={2} />
      <Line x1={5} y1={5} x2={19} y2={19} stroke="#E11D48" strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

// ↔ مقاسات موحّدة للشارات الثلاث (نصف الحجم السابق تقريبًا): نفس الأيقونة ونفس الخط ونفس الارتفاع.
const ICON = 18;

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, paddingHorizontal: 14, marginTop: 6 },
  badge: {
    minHeight: 46, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 5, paddingHorizontal: 4,
    shadowColor: "#1E3A8A", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  label: { fontSize: 10.5, fontWeight: "800", textAlign: "center", lineHeight: 14 },
});
