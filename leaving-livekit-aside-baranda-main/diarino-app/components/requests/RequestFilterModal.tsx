import { useMemo, useState } from "react";
import { useDragToClose } from "../../lib/hooks/useDragToClose";
import { KeyboardAvoid } from "../../components/shared/KeyboardAvoid";
import { ChipLabel } from "../shared/ChipLabel";
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, Animated,
} from "react-native";
import { PROVINCES } from "../../data/locations";
import { useProvinceSuggestions, useRecordProvinceSearchAttempt } from "../../lib/hooks/useKnownProvinces";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ modal-req-filter / state.reqFilters in app-viewer.html.
export type RequestFilters = { province: string; location: string; type: string; purpose: "all" | "sale" | "rent" };
export const DEFAULT_REQUEST_FILTERS: RequestFilters = { province: "", location: "", type: "all", purpose: "all" };

const TYPES = ["all", "شقة", "فيلا", "بنتهاوس", "تاون هاوس", "تجاري", "إداري", "طبي", "أرض"];

type Props = { visible: boolean; value: RequestFilters; onApply: (f: RequestFilters) => void; onClose: () => void };

export function RequestFilterModal({ visible, value, onApply, onClose }: Props) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<RequestFilters>(value);
  const [provinceQuery, setProvinceQuery] = useState("");
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  // ↔ إصلاح "فلترة المحافظة بتعرض كل المحافظات كشرائح جوه الصفحة" —
  // بدّلناها بخانة بحث بالكتابة + اقتراحات، بنفس أسلوب SearchFilterModal
  // بالظبط، بس هنا الاختيار واحد بس (province: string مش مصفوفة)، فمفيش
  // داعي لعرض شرائح متعددة مختارة — شريحة واحدة بس بتتبدّل.
  const rawSuggestions = useProvinceSuggestions(provinceQuery, t);
  const suggestions = useMemo(() => rawSuggestions.filter((p) => p !== draft.province), [rawSuggestions, draft.province]);
  const recordProvinceAttempt = useRecordProvinceSearchAttempt();
  const showAddCustom =
    provinceQuery.trim().length > 0 && suggestions.length === 0 && provinceQuery.trim() !== draft.province;

  function selectProvince(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setDraft((d) => ({ ...d, province: trimmed }));
    if (!PROVINCES.includes(trimmed)) recordProvinceAttempt.mutate(trimmed);
    setProvinceQuery("");
  }
  function clearProvince() {
    setDraft((d) => ({ ...d, province: "" }));
    setProvinceQuery("");
  }

  // ↔ السحب لأسفل لإغلاق الصفحة من أى مكان (لما المحتوى فى الأعلى) — منطق مشترك فى lib/hooks/useDragToClose.ts.
  const { translateY, backdropOpacity, panHandlers, onScroll: handleScroll } = useDragToClose(onClose, { visible });

  function reset() {
    setDraft(DEFAULT_REQUEST_FILTERS);
    onApply(DEFAULT_REQUEST_FILTERS);
    onClose();
  }
  function apply() {
    onApply(draft);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><KeyboardAvoid style={{ flex: 1 }} mode="sheet">
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]} {...panHandlers}>
        <View style={styles.dragHandle} />
        <ScrollView showsVerticalScrollIndicator={false} onScroll={handleScroll} scrollEventThrottle={16}>
          <Text style={styles.section}>{t("الغرض")}</Text>
          <View style={styles.chipsRow}>
            {(["all", "sale", "rent"] as const).map((p) => (
              <Pressable key={p} style={draft.purpose === p ? styles.chipActive : styles.chip} onPress={() => setDraft((d) => ({ ...d, purpose: p }))}>
                <ChipLabel text={p === "all" ? t("الكل") : p === "sale" ? t("بيع") : t("إيجار")} active={draft.purpose === p} textStyle={styles.chipText} activeTextStyle={styles.chipActiveText} />
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>{t("نوع العقار")}</Text>
          <View style={styles.chipsRow}>
            {TYPES.map((ty) => (
              <Pressable key={ty} style={draft.type === ty ? styles.chipActive : styles.chip} onPress={() => setDraft((d) => ({ ...d, type: ty }))}>
                <ChipLabel text={ty === "all" ? t("الكل") : t(ty)} active={draft.type === ty} textStyle={styles.chipText} activeTextStyle={styles.chipActiveText} />
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>{t("المحافظة")}</Text>
          <View style={styles.chipsRow}>
            <Pressable style={draft.province === "" ? styles.chipActive : styles.chip} onPress={clearProvince}>
              <ChipLabel text={t("الكل")} active={draft.province === ""} textStyle={styles.chipText} activeTextStyle={styles.chipActiveText} />
            </Pressable>
            {draft.province !== "" && (
              <Pressable style={styles.chipActive} onPress={clearProvince}>
                <ChipLabel text={`${t(draft.province)} ×`} active textStyle={styles.chipText} activeTextStyle={styles.chipActiveText} />
              </Pressable>
            )}
          </View>
          <TextInput
            style={styles.input}
            value={provinceQuery}
            onChangeText={setProvinceQuery}
            onSubmitEditing={() => { if (showAddCustom) selectProvince(provinceQuery); }}
            placeholder={t("ابحث عن محافظة...")}
            placeholderTextColor={themeColors.textSubtle}
            returnKeyType="done"
          />
          {suggestions.length > 0 && (
            <View style={styles.suggestionBox}>
              {suggestions.map((s) => (
                <Pressable key={s} style={styles.suggestionRow} onPress={() => selectProvince(s)}>
                  <Text style={styles.suggestionText}>{t(s)}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {showAddCustom && (
            <View style={styles.suggestionBox}>
              <Pressable style={styles.suggestionRow} onPress={() => selectProvince(provinceQuery)}>
                <Text style={styles.suggestionTextNew}>{t("إضافة")} "{provinceQuery.trim()}"</Text>
              </Pressable>
            </View>
          )}

          <Text style={styles.section}>{t("المنطقة")}</Text>
          <TextInput
            style={styles.input}
            value={draft.location}
            onChangeText={(v) => setDraft((d) => ({ ...d, location: v }))}
            placeholder={t("اكتب اسم المنطقة...")}
            placeholderTextColor={themeColors.textSubtle}
          />
        </ScrollView>

        <View style={styles.actionsRow}>
          <Pressable style={styles.resetBtn} onPress={reset}><Text style={styles.resetBtnText}>{t("إعادة تعيين")}</Text></Pressable>
          <Pressable style={styles.applyBtn} onPress={apply}><Text style={styles.applyBtnText}>{t("تطبيق")}</Text></Pressable>
        </View>
      </Animated.View>
    </KeyboardAvoid></Modal>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: themeColors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 24, maxHeight: "85%" },
    dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: themeColors.border, alignSelf: "center", marginBottom: 10 },
    section: { fontSize: 12, fontWeight: "900", color: themeColors.textMuted, marginTop: 14, marginBottom: 8 },
    input: { backgroundColor: themeColors.surface, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, fontSize: 13, color: themeColors.text },
    suggestionBox: { backgroundColor: themeColors.card, borderWidth: 1, borderColor: themeColors.border, borderRadius: 10, marginTop: 4, overflow: "hidden" },
    suggestionRow: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    suggestionText: { fontSize: 13, color: themeColors.textMuted, fontWeight: "700" },
    suggestionTextNew: { fontSize: 13, color: "#22A652", fontWeight: "900" },
    chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { backgroundColor: themeColors.surface, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
    chipText: { fontSize: 11.5, fontWeight: "800", color: themeColors.textMuted },
    chipActive: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
    chipActiveText: { fontSize: 11.5, fontWeight: "800", color: "white" },
    actionsRow: { flexDirection: "row", gap: 10, marginTop: 16 },
    resetBtn: { flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: "center", borderWidth: 1, borderColor: themeColors.border },
    resetBtnText: { fontSize: 13, fontWeight: "900", color: themeColors.textMuted },
    applyBtn: { flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: "center", backgroundColor: "#22A652" },
    applyBtnText: { fontSize: 13, fontWeight: "900", color: "white" },
  });
}
