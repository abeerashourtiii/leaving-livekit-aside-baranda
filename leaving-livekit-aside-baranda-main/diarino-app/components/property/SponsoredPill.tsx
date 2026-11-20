import { View, Text, StyleSheet } from "react-native";
import { useLanguage } from "../../lib/hooks/useLanguage";

// ↔ شارة «ممول» على كارت الإعلان الممول — نفس شكل شارة صفحة البحث (app/(tabs)/search.tsx)، وبتظهر فى «إعلاناتي» وصفحة المعلن.
export function SponsoredPill() {
  const { t } = useLanguage();
  return (
    <View style={styles.pill}>
      <Text style={styles.text}>{t("ممول")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { backgroundColor: "rgba(217,119,6,0.95)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  text: { color: "white", fontSize: 10.5, fontWeight: "900" },
});
