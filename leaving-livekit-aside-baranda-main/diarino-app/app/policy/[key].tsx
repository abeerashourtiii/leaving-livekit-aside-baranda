import { router, useLocalSearchParams } from "expo-router";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { POLICIES, POLICIES_VERSION, isPolicyKey } from "../../data/policies";

// ↔ صفحة عرض نص سياسة (شروط الاستخدام / الخصوصية / البيع): بتتفتح من روابط الموافقة فى إنشاء الحساب
// وإكمال بيانات حساب جوجل. متاحة قبل تسجيل الدخول. النصوص من data/policies.ts.
export default function PolicyScreen() {
  const { key } = useLocalSearchParams<{ key?: string }>();
  const policyKey = Array.isArray(key) ? key[0] : key;
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const insets = useSafeAreaInsets();
  const policy = isPolicyKey(policyKey) ? POLICIES[policyKey] : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.closeBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={8}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={themeColors.text} strokeWidth={2}>
            <Path d="M18 6L6 18M6 6l12 12" />
          </Svg>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{policy ? t(policy.title) : t("السياسات")}</Text>
        <View style={{ width: 34 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {policy ? (
          <>
            {policy.body.map((p, i) =>
              p.startsWith("## ") ? (
                <Text key={i} style={styles.heading}>{p.slice(3)}</Text>
              ) : (
                <Text key={i} style={styles.paragraph}>{p}</Text>
              )
            )}
            <Text style={styles.version}>{t("الإصدار")} {POLICIES_VERSION}</Text>
          </>
        ) : (
          <Text style={styles.paragraph}>{t("السياسة غير موجودة.")}</Text>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: themeColors.background },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: themeColors.surface },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "800", color: themeColors.text },
    content: { padding: 20, gap: 14 },
    heading: { fontSize: 15.5, lineHeight: 26, color: themeColors.text, fontWeight: "800", marginTop: 10 },
    paragraph: { fontSize: 14, lineHeight: 24, color: themeColors.text, fontWeight: "500" },
    version: { fontSize: 11.5, color: themeColors.textSubtle, marginTop: 8 },
  });
}
