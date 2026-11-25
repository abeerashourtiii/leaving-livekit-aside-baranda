import { Text, StyleSheet, type StyleProp, type TextStyle } from "react-native";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors } from "../../lib/hooks/useThemeColors";
import { openTermsPage } from "../../lib/terms";

// ↔ الموافقة الضمنية بالاستمرار (بدل مربع الاختيار/الشاشة الإجبارية): عبارة توضيحية أسفل أزرار المتابعة/تسجيل الدخول/إنشاء الحساب
//   (app/index.tsx، app/auth-email.tsx، app/edit-profile.tsx فى وضع الإكمال بعد جوجل):
//   «من خلال الاستمرار، فإنك توافق على [الشروط والأحكام] و[سياسات العمل والخصوصية]» — العبارتان بين الأقواس روابط تفتح الصفحة الموحدة
//   https://shahir.site/terms (الأولى عند قسم الشروط، والثانية عند قسم الخصوصية، وفيها باقى السياسات). لا حجب ولا نافذة موافقة عند
//   تغيّر إصدار السياسات؛ وقت الاستمرار وإصدار السياسات يُسجَّلان فى profiles كما كان. أندرويد/آيفون/الويب/APK.
export function PolicyNotice({ tone = "default", style }: { tone?: "default" | "onDark"; style?: StyleProp<TextStyle> }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const onDark = tone === "onDark";
  return (
    <Text style={[styles.text, { color: onDark ? "#D5D8CB" : themeColors.textSubtle }, style]}>
      {t("من خلال الاستمرار، فإنك توافق على")}{" "}
      <Text
        style={[styles.link, { color: onDark ? "#FFFFFF" : "#22A652" }]}
        accessibilityRole="link"
        onPress={() => { void openTermsPage("terms"); }}
      >
        {t("الشروط والأحكام")}
      </Text>{" "}
      {t("و")}
      <Text
        style={[styles.link, { color: onDark ? "#FFFFFF" : "#22A652" }]}
        accessibilityRole="link"
        onPress={() => { void openTermsPage("privacy"); }}
      >
        {t("سياسات العمل والخصوصية")}
      </Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 12, fontWeight: "600", lineHeight: 19, textAlign: "center", paddingHorizontal: 8 },
  link: { fontWeight: "800", textDecorationLine: "underline" },
});
