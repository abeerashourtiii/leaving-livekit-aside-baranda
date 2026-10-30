import { View, Text, StyleSheet } from "react-native";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { useRequestById } from "../../lib/hooks/useRequests";
import { fmtPrice } from "../../lib/types";
import { timeAgo } from "../../lib/timeAgo";

// ↔ تفاصيل الطلب كاملة (النوع والغرض والميزانية والموقع والمساحة والغرف والحمامات والوصف وصاحب الطلب) داخل محادثة «عرض على طلب»،
// بدل السطر المختصر «نوع - منطقة». نفس بيانات كارت الطلب فى تبويب الطلبات. لو الطلب لم يعد متاحًا بنعرض العنوان المختصر فقط.
// شغّال بنفس الكود على أندرويد/آيفون/الويب/APK.
export function RequestDetailsCard({ requestId, fallbackTitle }: { requestId: string; fallbackTitle?: string | null }) {
  const { t, language } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { data: r } = useRequestById(requestId);

  if (!r) {
    if (!fallbackTitle) return null;
    return (
      <View style={styles.card}>
        <Text style={styles.kind}>{t("طلب")}</Text>
        <Text style={styles.title} numberOfLines={2}>{fallbackTitle}</Text>
      </View>
    );
  }

  const hasRooms = !!r.rooms && r.rooms !== "-";
  const hasBaths = !!r.baths && r.baths !== "-";
  const hasArea = !!r.area && r.area !== "-";

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.kind}>{t("الطلب")}</Text>
        <View style={styles.purposeChip}>
          <Text style={styles.purposeText}>{r.purpose === "sale" ? t("للبيع") : t("للإيجار")}</Text>
        </View>
      </View>
      <Text style={styles.title}>{t(r.type)} {r.purpose === "sale" ? t("للبيع") : t("للإيجار")}</Text>
      <Text style={styles.price}>
        {t("الميزانية حتى")} {r.priceMax ? fmtPrice(r.priceMax) : "—"} {t("ج.م")} {r.purpose === "rent" ? t("/ شهر") : ""}
      </Text>
      <Text style={styles.loc}>📍 {[r.province && t(r.province), r.location && t(r.location)].filter(Boolean).join(" · ")}</Text>
      {(hasArea || hasRooms || hasBaths) && (
        <View style={styles.specs}>
          {hasArea && <Text style={styles.spec}>📐 {r.area} {t("م²")}</Text>}
          {hasRooms && <Text style={styles.spec}>🛏 {r.rooms} {t("غرف")}</Text>}
          {hasBaths && <Text style={styles.spec}>🛁 {r.baths} {t("حمام")}</Text>}
        </View>
      )}
      {!!r.description && <Text style={styles.desc}>{t(r.description)}</Text>}
      <Text style={styles.footer}>
        {r.requesterName ? `${t("صاحب الطلب")}: ${t(r.requesterName)} · ` : ""}{timeAgo(new Date(r.createdAt).toISOString(), language)}
      </Text>
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: themeColors.card, borderRadius: 12, padding: 12, marginBottom: 6, gap: 5, borderWidth: 1, borderColor: themeColors.border },
    topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    kind: { fontSize: 12, fontWeight: "900", color: "#22A652" },
    purposeChip: { backgroundColor: "#22A652", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
    purposeText: { color: "white", fontSize: 10.5, fontWeight: "900" },
    title: { fontSize: 15, fontWeight: "900", color: themeColors.text, lineHeight: 22 },
    price: { fontSize: 14, fontWeight: "900", color: "#22A652" },
    loc: { fontSize: 12.5, fontWeight: "700", color: themeColors.textMuted },
    specs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
    spec: { fontSize: 12, fontWeight: "800", color: themeColors.text, backgroundColor: themeColors.surface, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden" },
    desc: { fontSize: 12.5, lineHeight: 20, color: themeColors.text, marginTop: 2 },
    footer: { fontSize: 11, color: themeColors.textSubtle, marginTop: 2 },
  });
}
