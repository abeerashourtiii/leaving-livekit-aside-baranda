import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Keyboard } from "react-native";
import { PROVINCES } from "../../data/locations";
import { FormInput } from "./FormControls";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ إصلاح: الضغط على محافظة من القائمة ماكانش بيحطها فى الخانة. السبب إن
// القائمة بتظهر والكيبورد مفتوح، وأول لمسة على أندرويد/آيفون كانت بتروح
// للـ ScrollView اللى بيقفل الكيبورد (blur) بدل ما توصل للصف، وبعدها بـ150ms
// القائمة بتختفى — فالمحافظة ماتتختارش. الحل مرحلتين: (1) ScrollView فى
// شاشات النشر بقى keyboardShouldPersistTaps="handled" فاللمسة توصل للصف،
// (2) هنا الاختيار بيتم بـ onPress (مش onPressIn اللى كان بيختار بمجرد بداية
// اللمس حتى لو المستخدم بيسحب الصفحة)، وإخفاء القائمة عند الـ blur بيستنى
// لو فيه ضغطة شغالة على صف (ترتيب blur/press بيختلف بين الويب والموبايل).
export function ProvinceAutocomplete({
  value, onChange, error,
}: { value: string; onChange: (v: string) => void; error?: boolean }) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const [focused, setFocused] = useState(false);
  const inputFocusedRef = useRef(false);
  const pressingRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestions = useMemo(() => {
    if (!value.trim()) return PROVINCES.slice(0, 6);
    return PROVINCES.filter((p) => p.includes(value.trim())).slice(0, 6);
  }, [value]);

  function clearHideTimer() {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  function scheduleHide() {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      if (!pressingRef.current && !inputFocusedRef.current) setFocused(false);
    }, 250);
  }

  useEffect(() => clearHideTimer, []);

  function select(province: string) {
    clearHideTimer();
    pressingRef.current = false;
    onChange(province);
    setFocused(false);
    Keyboard.dismiss();
  }

  return (
    <View>
      <FormInput
        value={value}
        onChangeText={onChange}
        onFocus={() => { inputFocusedRef.current = true; clearHideTimer(); setFocused(true); }}
        onBlur={() => { inputFocusedRef.current = false; scheduleHide(); }}
        placeholder={t("اختر المحافظة")}
        error={error}
      />
      {focused && suggestions.length > 0 && (
        <View style={styles.list}>
          {suggestions.map((s) => (
            <Pressable
              key={s}
              style={styles.row}
              onPressIn={() => { pressingRef.current = true; clearHideTimer(); }}
              onPressOut={() => { pressingRef.current = false; scheduleHide(); }}
              onPress={() => select(s)}
            >
              <Text style={styles.rowText}>{t(s)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    list: { backgroundColor: themeColors.card, borderWidth: 1, borderColor: themeColors.border, borderRadius: 10, marginTop: 4, overflow: "hidden" },
    row: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    rowText: { fontSize: 13, color: themeColors.textMuted, fontWeight: "700" },
  });
}
