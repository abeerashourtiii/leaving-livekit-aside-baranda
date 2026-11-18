import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, TextInputProps } from "react-native";
import Svg, { Path, Circle } from "react-native-svg";
import { physicalSide } from "../../lib/rtl";
import { ChipLabel } from "../shared/ChipLabel";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { PASSWORD_RULES } from "../../lib/password";

// ↔ الإجبارى بنجمة حمراء (*) بجوار الاسم، والاختيارى بدون أى علامة ولا كلمة «اختياري» (فى كل صفحات التطبيق).
// الخاصية optional قديمة وما بتعرض شيئًا (بنتركها عشان الاستدعاءات القديمة).
export function FormLabel({ text, required }: { text: string; required?: boolean; optional?: boolean }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  return (
    <Text style={styles.label}>
      {t(text)}
      {required && <Text style={styles.required}> *</Text>}
    </Text>
  );
}

// ↔ قائمة شروط كلمة المرور القوية (تتلوّن بالأخضر كل ما تحقق شرط) — فى إنشاء الحساب وتعيين كلمة مرور جديدة.
export function PasswordRules({ password, showErrors }: { password: string; showErrors?: boolean }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  return (
    <View style={{ gap: 3, marginTop: 2 }}>
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(password);
        const color = ok ? "#22A652" : showErrors ? "#ef4444" : themeColors.textSubtle;
        return (
          <Text key={r.key} style={{ fontSize: 11.5, fontWeight: "700", color }}>
            {ok ? "✓ " : "• "}{t(r.label)}
          </Text>
        );
      })}
    </View>
  );
}

export function FormError({ text, show }: { text: string; show: boolean }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  if (!show) return null;
  return <Text style={styles.error}>{t(text)}</Text>;
}

export function FormInput(props: TextInputProps & { error?: boolean }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { error, style, placeholder, ...rest } = props;
  return (
    <TextInput
      style={[styles.input, error && styles.inputError, style]}
      placeholderTextColor={themeColors.textSubtle}
      placeholder={placeholder ? t(placeholder) : placeholder}
      {...rest}
    />
  );
}

// ↔ حقل كلمة المرور مع زر العين لإظهار/إخفاء الكلمة (بيتستخدم فى كل شاشات كلمة المرور: تسجيل الدخول، إنشاء الحساب،
// تعيين كلمة مرور جديدة). الزر فى نهاية الحقل (يسار فى العربية / يمين فى الإنجليزية) على أندرويد/آيفون/الويب/APK،
// والحقل بياخد حشو فى الجهة دى عشان النص ما يدخلش تحت الأيقونة.
export function PasswordInput(props: Omit<TextInputProps, "secureTextEntry"> & { error?: boolean }) {
  const { t, language } = useLanguage();
  const themeColors = useThemeColors();
  const [visible, setVisible] = useState(false);
  const eyeLeft = language === "ar";
  const sideProp = physicalSide(eyeLeft);
  const padProp = sideProp === "left" ? "paddingLeft" : "paddingRight";
  const color = themeColors.textMuted;
  const { style, ...rest } = props;
  return (
    <View style={{ position: "relative", justifyContent: "center" }}>
      <FormInput
        {...rest}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        style={[{ [padProp]: 46 }, style]}
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={visible ? t("إخفاء كلمة المرور") : t("إظهار كلمة المرور")}
        style={{ position: "absolute", [sideProp]: 8, top: 0, bottom: 0, width: 36, alignItems: "center", justifyContent: "center" }}
      >
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <Circle cx={12} cy={12} r={3} />
          {!visible && <Path d="M3 3l18 18" />}
        </Svg>
      </Pressable>
    </View>
  );
}

export function ChipRow<T extends string>({
  options, value, onChange, labels,
}: { options: T[]; value: T | ""; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => (
        <Pressable key={opt} style={value === opt ? styles.chipActive : styles.chip} onPress={() => onChange(opt)}>
          <ChipLabel text={t(labels?.[opt] ?? opt)} active={value === opt} textStyle={styles.chipText} activeTextStyle={styles.chipActiveText} />
        </Pressable>
      ))}
    </View>
  );
}

export function MultiChipRow({
  options, values, onToggle,
}: { options: { key: string; label: string }[]; values: Set<string>; onToggle: (key: string) => void }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => (
        <Pressable key={opt.key} style={values.has(opt.key) ? styles.chipActive : styles.chip} onPress={() => onToggle(opt.key)}>
          <ChipLabel text={t(opt.label)} active={values.has(opt.key)} textStyle={styles.chipText} activeTextStyle={styles.chipActiveText} />
        </Pressable>
      ))}
    </View>
  );
}

export function HelpBox({ title, children }: { title: string; children: string }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  return (
    <View style={styles.helpBox}>
      <Text style={styles.helpTitle}>{t(title)}</Text>
      <Text style={styles.helpText}>{t(children)}</Text>
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    label: { fontSize: 12.5, fontWeight: "800", color: themeColors.textMuted, marginTop: 16, marginBottom: 6 },
    required: { color: "#ef4444" },
    optional: { color: themeColors.textSubtle, fontWeight: "700", fontSize: 11 },
    error: { color: "#ef4444", fontSize: 11, marginTop: 4 },
    input: { backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.border, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, fontSize: 13.5, color: themeColors.text },
    inputError: { borderColor: "#ef4444" },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { backgroundColor: themeColors.surface, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
    chipText: { fontSize: 12, fontWeight: "800", color: themeColors.textMuted },
    chipActive: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
    chipActiveText: { fontSize: 12, fontWeight: "800", color: "white" },
    helpBox: { backgroundColor: themeColors.isDark ? "rgba(34,166,82,0.15)" : "#ECFDF5", borderRadius: 12, padding: 12, marginBottom: 4 },
    helpTitle: { fontSize: 12.5, fontWeight: "900", color: themeColors.isDark ? "#6EE7B7" : "#065F46", marginBottom: 4 },
    helpText: { fontSize: 11.5, color: themeColors.isDark ? "#6EE7B7" : "#047857", lineHeight: 17 },
  });
}
