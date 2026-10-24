import { View, Text, Pressable, StyleSheet } from "react-native";
import { router, type Href } from "expo-router";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { POLICIES, POLICY_KEYS, PolicyKey } from "../../data/policies";

// ↔ موافقة المستخدم على الشروط والسياسات (إلزامية): الشروط + الخصوصية والأمان + البيع والرسوم + نشر الصور والفيديو + حقوق النشر (data/policies.ts).
// كل سياسة صندوق اختيار مستقل ورابط يفتح نصها (app/policy/[key].tsx). بتتستخدم فى إنشاء الحساب بالبريد
// وفى شاشة إكمال بيانات حساب جوجل. الموافقة بتتسجّل (وقتها وإصدار السياسات) فى profiles.
export type PolicyConsentValue = Record<PolicyKey, boolean>;
export const EMPTY_CONSENT: PolicyConsentValue = Object.fromEntries(POLICY_KEYS.map((k) => [k, false])) as PolicyConsentValue;
export const allPoliciesAccepted = (v: PolicyConsentValue) => POLICY_KEYS.every((k) => v[k]);

export function PolicyConsent({
  value, onChange, error,
}: { value: PolicyConsentValue; onChange: (next: PolicyConsentValue) => void; error?: boolean }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  return (
    <View style={styles.box}>
      {POLICY_KEYS.map((k) => {
        const checked = value[k];
        return (
          <View key={k} style={styles.row}>
            <Pressable
              onPress={() => onChange({ ...value, [k]: !checked })}
              hitSlop={8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              style={[styles.checkbox, checked && styles.checkboxOn, error && !checked && styles.checkboxError]}
            >
              {checked && <Text style={styles.checkMark}>✓</Text>}
            </Pressable>
            <Text style={styles.label} onPress={() => onChange({ ...value, [k]: !checked })}>
              {t("أوافق على")}{" "}
              <Text style={styles.link} onPress={() => router.push(`/policy/${k}` as Href)}>
                {t(POLICIES[k].title)}
              </Text>
            </Text>
          </View>
        );
      })}
      {error && <Text style={styles.errorText}>{t("يجب الموافقة على جميع الشروط والسياسات للمتابعة")}</Text>}
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    box: { gap: 12, marginTop: 6, marginBottom: 6 },
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
