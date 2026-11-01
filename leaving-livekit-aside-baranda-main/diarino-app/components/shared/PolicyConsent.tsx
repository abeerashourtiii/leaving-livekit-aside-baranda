import { View, Text, Pressable, StyleSheet } from "react-native";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { openTermsPage } from "../../lib/terms";

// ↔ موافقة المستخدم على الشروط والسياسات (إلزامية): مربع اختيار واحد فقط، ورابط (Hyperlink) على عبارة
// «الشروط والأحكام وسياسات الاستخدام» يفتح الصفحة الموحدة https://baranda.shop/terms (فيها: شروط الاستخدام + الخصوصية والأمان +
// البيع والرسوم + نشر الصور والفيديو + حقوق النشر). بتتستخدم فى إنشاء الحساب بالبريد وفى شاشة إكمال بيانات حساب جوجل.
// الموافقة بتتسجّل (وقتها وإصدار السياسات POLICIES_VERSION) فى profiles. شغّال على أندرويد/آيفون/الويب/APK.
export function PolicyConsent({
  checked, onChange, error, actionLabel = "إنشاء حساب",
}: { checked: boolean; onChange: (next: boolean) => void; error?: boolean; actionLabel?: string }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <Pressable
          onPress={() => onChange(!checked)}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={t("الموافقة على الشروط والأحكام وسياسات الاستخدام")}
          style={[styles.checkbox, checked && styles.checkboxOn, error && !checked && styles.checkboxError]}
        >
          {checked && <Text style={styles.checkMark}>✓</Text>}
        </Pressable>
        <Text style={styles.label} onPress={() => onChange(!checked)}>
          {t("بالضغط على")} {t(actionLabel)}{t("، فإنك توافق على")}{" "}
          <Text
            style={styles.link}
            accessibilityRole="link"
            onPress={(e) => { e?.stopPropagation?.(); void openTermsPage(); }}
          >
            {t("الشروط والأحكام وسياسات الاستخدام")}
          </Text>{" "}
          {t("الخاصة بالتطبيق.")}
        </Text>
      </View>
      {error && <Text style={styles.errorText}>{t("يجب الموافقة على الشروط والأحكام وسياسات الاستخدام للمتابعة")}</Text>}
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    box: { gap: 8, marginTop: 6, marginBottom: 6 },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: themeColors.textSubtle, alignItems: "center", justifyContent: "center", backgroundColor: themeColors.surface },
    checkboxOn: { backgroundColor: "#22A652", borderColor: "#22A652" },
    checkboxError: { borderColor: "#DC2626" },
    checkMark: { color: "white", fontSize: 14, fontWeight: "900", lineHeight: 16 },
    label: { flex: 1, fontSize: 13.5, fontWeight: "600", color: themeColors.text, lineHeight: 22 },
    link: { color: "#22A652", fontWeight: "800", textDecorationLine: "underline" },
    errorText: { color: "#DC2626", fontSize: 12, fontWeight: "700" },
  });
}
