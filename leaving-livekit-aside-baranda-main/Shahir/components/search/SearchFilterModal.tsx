import { useMemo, useState } from "react";
import { useDragToClose } from "../../lib/hooks/useDragToClose";
import { KeyboardAvoid } from "../../components/shared/KeyboardAvoid";
import {
  Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, Animated,
} from "react-native";
import { PROVINCES } from "../../data/locations";
import { RegionAutocompleteField } from "./RegionAutocompleteField";
import { useProvinceSuggestions, useRecordProvinceSearchAttempt } from "../../lib/hooks/useKnownProvinces";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { ChipLabel } from "../shared/ChipLabel";

// ↔ modal-search-filter / state.searchFilters / renderSfProvinceChips() /
// renderSfRegionChips() in app-viewer.html.
// Deferred: geo-radius search (useGeo/userLat/userLng/geoRadiusKm) — needs
// its own location-permission gate, same pattern as PermissionGate for
// camera/mic, kept out of this pass on purpose rather than half-built.

export type SearchFilters = {
  purpose: "all" | "sale" | "rent";
  type: string;
  provinces: string[];
  regions: string[];
  priceMin: number;
  priceMax: number;
  areaMin: number;
  areaMax: number;
  minRooms: number;
};

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  purpose: "all", type: "all", provinces: [], regions: [],
  priceMin: 0, priceMax: Infinity, areaMin: 0, areaMax: Infinity, minRooms: 0,
};

const TYPES = ["all", "شقة", "فيلا", "بنتهاوس", "تاون هاوس", "تجاري", "إداري", "طبي", "أرض"];

type Props = {
  visible: boolean;
  value: SearchFilters;
  onApply: (f: SearchFilters) => void;
  onClose: () => void;
};

export function SearchFilterModal({ visible, value, onApply, onClose }: Props) {
  const { t, language } = useLanguage();
  const [draft, setDraft] = useState<SearchFilters>(value);
  const [provinceQuery, setProvinceQuery] = useState("");
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  // ↔ "من"/"إلى" (خانات السعر والمساحة) عمدًا مش داخلين فى I18N_DICT
  // العام: هما حروف جر قصيرة جدًا وبيتكرروا كـ substring جوه جمل تانية
  // كتير فى التطبيق (زي "من فضلك")، فلو اتحطوا فى القاموس العام هيبوّظوا
  // ترجمة جمل تانية معاهم بالغلط. بديل مباشر وآمن هنا بس.
  const fromLabel = language === "en" ? "From" : "من";
  const toLabel = language === "en" ? "To" : "إلى";

  // ↔ السحب لأسفل لإغلاق الصفحة من أى مكان (لما المحتوى فى الأعلى) — منطق مشترك فى lib/hooks/useDragToClose.ts.
  const { translateY, backdropOpacity, panHandlers, onScroll: handleScroll } = useDragToClose(onClose, { visible });

  const rawSuggestions = useProvinceSuggestions(provinceQuery, t);
  const suggestions = useMemo(
    () => rawSuggestions.filter((p) => !draft.provinces.includes(p)),
    [rawSuggestions, draft.provinces]
  );
  const recordProvinceAttempt = useRecordProvinceSearchAttempt();
  // ↔ #3: لو مفيش أي اقتراح مطابق (لا من data/locations.ts ولا من
  // known_provinces) وفيه نص متكتوب فعلًا، بيظهر خيار "إضافة" — بيضيفها
  // كفلتر فورًا (سيتم البحث فى كل الأحوال، شوف fetchPropertiesPage) وفى
  // نفس الوقت بيسجّل محاولة بحث؛ أول ما توصل 3 محاولات (من أي مستخدم)
  // هتتحفظ كخيار دائم لكل الناس فى المرات الجاية.
  const showAddCustom = provinceQuery.trim().length > 0 && suggestions.length === 0 && !draft.provinces.includes(provinceQuery.trim());

  function addProvince(name: string) {
    const trimmed = name.trim();
    if (!trimmed || draft.provinces.includes(trimmed)) return;
    setDraft((d) => ({ ...d, provinces: [...d.provinces, trimmed] }));
    if (!PROVINCES.includes(trimmed)) recordProvinceAttempt.mutate(trimmed);
    setProvinceQuery("");
  }

  function reset() {
    setDraft(DEFAULT_SEARCH_FILTERS);
    onApply(DEFAULT_SEARCH_FILTERS);
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
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} onScroll={handleScroll} scrollEventThrottle={16} bounces={false} overScrollMode="never">
          <Text style={styles.section}>{t("الغرض")}</Text>
          <View style={styles.chipsRow}>
            {(["all", "sale", "rent"] as const).map((p) => (
              <Pressable
                key={p}
                style={draft.purpose === p ? styles.chipActive : styles.chip}
                onPress={() => setDraft((d) => ({ ...d, purpose: p }))}
              >
                <ChipLabel
                  text={p === "all" ? t("الكل") : p === "sale" ? t("بيع") : t("إيجار")}
                  active={draft.purpose === p}
                  textStyle={styles.chipText}
                  activeTextStyle={styles.chipActiveText}
                />
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>{t("نوع العقار")}</Text>
          <View style={styles.chipsRow}>
            {TYPES.map((ty) => (
              <Pressable
                key={ty}
                style={draft.type === ty ? styles.chipActive : styles.chip}
                onPress={() => setDraft((d) => ({ ...d, type: ty }))}
              >
                <ChipLabel text={ty === "all" ? t("الكل") : t(ty)} active={draft.type === ty} textStyle={styles.chipText} activeTextStyle={styles.chipActiveText} />
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>{t("المحافظة")}</Text>
          <TextInput
            style={styles.input}
            value={provinceQuery}
            onChangeText={setProvinceQuery}
            onSubmitEditing={() => { if (showAddCustom) addProvince(provinceQuery); }}
            placeholder={t("ابحث عن محافظة...")}
            placeholderTextColor={themeColors.textSubtle}
            returnKeyType="done"
          />
          {suggestions.length > 0 && (
            <View style={styles.suggestionBox}>
              {suggestions.map((s) => (
                <Pressable key={s} style={styles.suggestionRow} onPress={() => addProvince(s)}>
                  <Text style={styles.suggestionText}>{t(s)}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {showAddCustom && (
            // ↔ #3: مفيش اقتراح مطابق — تقدر تضيف المحافظة اللي كتبتها
            // كما هي، وهيتم البحث عنها فورًا (حتى لو لسه ماوصلتش لعتبة
            // الحفظ الدائم فى قائمة الاقتراحات).
            <View style={styles.suggestionBox}>
              <Pressable style={styles.suggestionRow} onPress={() => addProvince(provinceQuery)}>
                <Text style={styles.suggestionTextNew}>{t("إضافة")} "{provinceQuery.trim()}"</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.chipsRow}>
            {draft.provinces.map((pv) => (
              <Pressable
                key={pv}
                style={styles.chipActive}
                onPress={() => setDraft((d) => ({ ...d, provinces: d.provinces.filter((x) => x !== pv) }))}
              >
                <Text style={styles.chipActiveText}>{t(pv)} ×</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>{t("المنطقة")}</Text>
          <RegionAutocompleteField
            province={draft.provinces.length === 1 ? draft.provinces[0] : undefined}
            selected={draft.regions}
            onChange={(next) => setDraft((d) => ({ ...d, regions: next }))}
          />

          <Text style={styles.section}>{t("السعر (ج.م)")}</Text>
          <View style={styles.rangeRow}>
            <TextInput
              style={styles.rangeInput}
              keyboardType="number-pad"
              placeholder={fromLabel}
              placeholderTextColor={themeColors.textSubtle}
              value={draft.priceMin ? String(draft.priceMin) : ""}
              onChangeText={(v) => setDraft((d) => ({ ...d, priceMin: Number(v) || 0 }))}
            />
            <Text style={styles.rangeDash}>—</Text>
            <TextInput
              style={styles.rangeInput}
              keyboardType="number-pad"
              placeholder={toLabel}
              placeholderTextColor={themeColors.textSubtle}
              value={Number.isFinite(draft.priceMax) ? String(draft.priceMax) : ""}
              onChangeText={(v) => setDraft((d) => ({ ...d, priceMax: v ? Number(v) : Infinity }))}
            />
          </View>

          <Text style={styles.section}>{t("المساحة (م²)")}</Text>
          <View style={styles.rangeRow}>
            <TextInput
              style={styles.rangeInput}
              keyboardType="number-pad"
              placeholder={fromLabel}
              placeholderTextColor={themeColors.textSubtle}
              value={draft.areaMin ? String(draft.areaMin) : ""}
              onChangeText={(v) => setDraft((d) => ({ ...d, areaMin: Number(v) || 0 }))}
            />
            <Text style={styles.rangeDash}>—</Text>
            <TextInput
              style={styles.rangeInput}
              keyboardType="number-pad"
              placeholder={toLabel}
              placeholderTextColor={themeColors.textSubtle}
              value={Number.isFinite(draft.areaMax) ? String(draft.areaMax) : ""}
              onChangeText={(v) => setDraft((d) => ({ ...d, areaMax: v ? Number(v) : Infinity }))}
            />
          </View>

          <Text style={styles.section}>{t("الحد الأدنى للغرف")}</Text>
          <View style={styles.chipsRow}>
            {[0, 1, 2, 3, 4].map((n) => (
              <Pressable
                key={n}
                style={draft.minRooms === n ? styles.chipActive : styles.chip}
                onPress={() => setDraft((d) => ({ ...d, minRooms: n }))}
              >
                <ChipLabel text={n === 0 ? t("أي عدد") : `${n}+`} active={draft.minRooms === n} textStyle={styles.chipText} activeTextStyle={styles.chipActiveText} />
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View style={styles.actionsRow}>
          <Pressable style={styles.resetBtn} onPress={reset}>
            <Text style={styles.resetBtnText}>{t("إعادة تعيين")}</Text>
          </Pressable>
          <Pressable style={styles.applyBtn} onPress={apply}>
            <Text style={styles.applyBtnText}>{t("تطبيق")}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </KeyboardAvoid></Modal>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    sheet: {
      position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: themeColors.card,
      borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 18, maxHeight: "96%",
    },
    dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: themeColors.border, alignSelf: "center", marginBottom: 6 },
    section: { fontSize: 12, fontWeight: "900", color: themeColors.textMuted, marginTop: 9, marginBottom: 5 },
    input: { backgroundColor: themeColors.surface, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, fontSize: 13, color: themeColors.text },
    suggestionBox: { backgroundColor: themeColors.card, borderWidth: 1, borderColor: themeColors.border, borderRadius: 10, marginTop: 4, overflow: "hidden" },
    suggestionRow: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    suggestionText: { fontSize: 13, color: themeColors.textMuted, fontWeight: "700" },
    suggestionTextNew: { fontSize: 13, color: "#22A652", fontWeight: "900" },
    chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { backgroundColor: themeColors.surface, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
    chipText: { fontSize: 11.5, fontWeight: "800", color: themeColors.textMuted },
    chipActive: { backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
    chipActiveText: { fontSize: 11.5, fontWeight: "800", color: "white" },
    rangeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    rangeInput: { flex: 1, backgroundColor: themeColors.surface, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, fontSize: 13, color: themeColors.text, textAlign: "center" },
    rangeDash: { color: themeColors.textSubtle },
    actionsRow: { flexDirection: "row", gap: 10, marginTop: 12 },
    resetBtn: { flex: 1, borderRadius: 999, paddingVertical: 11, alignItems: "center", borderWidth: 1, borderColor: themeColors.border },
    resetBtnText: { fontSize: 13, fontWeight: "900", color: themeColors.textMuted },
    applyBtn: { flex: 1, borderRadius: 999, paddingVertical: 11, alignItems: "center", backgroundColor: "#22A652" },
    applyBtnText: { fontSize: 13, fontWeight: "900", color: "white" },
  });
}
