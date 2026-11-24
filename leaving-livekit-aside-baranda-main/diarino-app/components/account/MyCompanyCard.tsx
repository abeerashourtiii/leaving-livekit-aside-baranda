import { View, Text, Pressable, StyleSheet } from "react-native";
import { router, type Href } from "expo-router";
import { Image } from "expo-image";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors } from "../../lib/hooks/useThemeColors";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useMyCompany } from "../../lib/hooks/useCompanies";
import { COMPANY_STATUS_LABELS, daysUntil } from "../../lib/companies";
import { cldOptimized } from "../../lib/cloudinary";

// ↔ زر/كارت «إدارة شركتي» فى صفحة إدارة الحساب — يظهر فقط لصاحب شركة مسجّلة (قسم «الخدمات»).
//   علامة تنبيه لو الفترة المجانية/الاشتراك على وشك الانتهاء (≤ 7 أيام) أو انتهت (الهاتف/الصور مخفيان)، وتفاصيلها فى شاشة /my-company.
export function MyCompanyCard() {
  const { t } = useLanguage();
  const colors = useThemeColors();
  const { user } = useCurrentUser();
  const isGuest = !user || !!user.is_anonymous;
  const { data: c } = useMyCompany(isGuest ? undefined : user?.id);
  if (!c) return null;

  const phoneLeft = daysUntil(c.phoneUntil);
  const photosLeft = daysUntil(c.photosUntil);
  const alert =
    c.status === "approved" &&
    (!c.phoneActive || !c.photosActive || (phoneLeft !== null && phoneLeft <= 7) || (photosLeft !== null && photosLeft <= 7));

  return (
    <Pressable
      style={[styles.card, { backgroundColor: colors.card, borderColor: alert ? "#F59E0B" : colors.border }]}
      onPress={() => router.push("/my-company" as Href)}
      accessibilityRole="button"
      accessibilityLabel={t("إدارة شركتي")}
    >
      <Image source={{ uri: cldOptimized(c.logoUrl, "w_160,q_auto,f_auto") }} style={[styles.logo, { backgroundColor: colors.surface }]} contentFit="cover" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.title, { color: colors.text }]}>🏢 {t("إدارة شركتي")}</Text>
        <Text style={[styles.sub, { color: colors.textSubtle }]} numberOfLines={1}>{c.name} · {t(COMPANY_STATUS_LABELS[c.status])}</Text>
        {alert && <Text style={styles.alert} numberOfLines={2}>⚠️ {t("يلزم تفعيل/تجديد الاشتراك لاستمرار ظهور الهاتف والصور")}</Text>}
      </View>
      <Text style={styles.chev}>‹</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 16, borderWidth: 1.5 },
  logo: { width: 52, height: 52, borderRadius: 12 },
  title: { fontSize: 14.5, fontWeight: "900" },
  sub: { fontSize: 12, fontWeight: "600" },
  alert: { fontSize: 11.5, fontWeight: "800", color: "#B45309", lineHeight: 17 },
  chev: { fontSize: 26, color: "#22A652", fontWeight: "900" },
});
