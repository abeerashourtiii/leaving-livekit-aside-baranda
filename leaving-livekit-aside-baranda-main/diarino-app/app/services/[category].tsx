import { useMemo, useState } from "react";
import { View, Text, Pressable, TextInput, FlatList, ActivityIndicator, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { Image } from "expo-image";
import Svg, { Path, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors } from "../../lib/hooks/useThemeColors";
import { useCompanyList, type CompanyListItem } from "../../lib/hooks/useCompanies";
import { COMPANY_CATEGORIES, isCompanyCategory } from "../../lib/companies";
import { PROVINCES, regionsForProvince } from "../../data/locations";
import { cldOptimized } from "../../lib/cloudinary";
import { createCompanyStyles, SERVICES_GREEN_LIGHT } from "../../components/companies/companyStyles";
import { CompanyScreenHeader } from "../../components/companies/CompanyScreenHeader";
import { OptionPickerModal } from "../../components/companies/OptionPickerModal";

// ↔ قائمة الشركات المسجّلة تحت نشاط واحد (من كارت فى قسم «الخدمات»): بحث بالاسم + فلتر محافظة/منطقة +
//   تبديل بين عرض القائمة المتتالية وعرض الشبكة (نفس أسلوب صفحة البحث عن العقارات). الشركات المعتمدة فقط تظهر (الخادم).
export default function CompaniesByCategoryScreen() {
  const { category: raw } = useLocalSearchParams<{ category?: string }>();
  const categoryParam = Array.isArray(raw) ? raw[0] : raw;
  const category = isCompanyCategory(categoryParam) ? categoryParam : null;
  const meta = COMPANY_CATEGORIES.find((c) => c.key === category);

  const { t } = useLanguage();
  const colors = useThemeColors();
  const styles = createCompanyStyles(colors);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [view, setView] = useState<"list" | "grid">("list");
  const [search, setSearch] = useState("");
  const [province, setProvince] = useState("");
  const [region, setRegion] = useState("");
  const [picker, setPicker] = useState<null | "province" | "region">(null);

  const q = useCompanyList({ category: category ?? "marketing", province, region, search: search.trim() });
  const items = category ? q.data ?? [] : [];

  const columns = width >= 900 ? 4 : width >= 640 ? 3 : 2;
  const gridGap = 10;
  const gridCardW = (Math.min(width, 1100) - 32 - gridGap * (columns - 1)) / columns;

  const provinceOptions = useMemo(() => PROVINCES.map((p) => ({ value: p, label: p })), []);
  const regionOptions = useMemo(() => regionsForProvince(province).map((r) => ({ value: r, label: r })), [province]);

  const openCompany = (id: string) => router.push(`/company/${id}` as Href);

  function renderItem({ item }: { item: CompanyListItem }) {
    if (view === "grid") {
      return (
        <Pressable style={[styles.card, { width: gridCardW, padding: 0, overflow: "hidden", gap: 0 }]} onPress={() => openCompany(item.id)} accessibilityRole="button">
          <Image source={{ uri: cldOptimized(item.logoUrl, "w_500,q_auto,f_auto") }} style={{ width: gridCardW, height: gridCardW }} contentFit="cover" />
          <View style={{ padding: 10, gap: 4 }}>
            <Text style={[styles.sectionTitle, { fontSize: 13.5 }]} numberOfLines={2}>{item.name}</Text>
            <Text style={styles.small} numberOfLines={1}>{item.province} · {item.region}</Text>
          </View>
        </Pressable>
      );
    }
    return (
      <Pressable style={[styles.card, { flexDirection: "row", gap: 12, alignItems: "center" }]} onPress={() => openCompany(item.id)} accessibilityRole="button">
        <Image source={{ uri: cldOptimized(item.logoUrl, "w_240,q_auto,f_auto") }} style={{ width: 78, height: 78, borderRadius: 14, backgroundColor: colors.surface }} contentFit="cover" />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.sectionTitle} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.small} numberOfLines={1}>📍 {item.province} · {item.region}</Text>
          <Text style={[styles.small, { color: colors.textMuted }]} numberOfLines={2}>{item.description}</Text>
        </View>
      </Pressable>
    );
  }

  const header = (
    <View style={{ gap: 10, paddingBottom: 6 }}>
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder={t("ابحث باسم الشركة")}
        placeholderTextColor={colors.textSubtle}
        returnKeyType="search"
        maxLength={80}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable style={[styles.select, { flex: 1 }]} onPress={() => setPicker("province")} accessibilityRole="button">
          <Text style={[styles.selectText, !province && styles.selectPlaceholder]} numberOfLines={1}>{province ? t(province) : t("كل المحافظات")}</Text>
          <Text style={styles.small}>▾</Text>
        </Pressable>
        <Pressable
          style={[styles.select, { flex: 1 }, !province && styles.btnDisabled]}
          onPress={() => province && setPicker("region")}
          disabled={!province}
          accessibilityRole="button"
        >
          <Text style={[styles.selectText, !region && styles.selectPlaceholder]} numberOfLines={1}>{region ? t(region) : t("كل المناطق")}</Text>
          <Text style={styles.small}>▾</Text>
        </Pressable>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Pressable
            style={[styles.closeBtn, { width: 44, height: 44, borderRadius: 12 }, view === "list" && { backgroundColor: SERVICES_GREEN_LIGHT }]}
            onPress={() => setView("list")}
            accessibilityRole="button"
            accessibilityLabel={t("عرض القائمة")}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={view === "list" ? "white" : colors.text} strokeWidth={2.4} strokeLinecap="round">
              <Path d="M4 6h16M4 12h16M4 18h16" />
            </Svg>
          </Pressable>
          <Pressable
            style={[styles.closeBtn, { width: 44, height: 44, borderRadius: 12 }, view === "grid" && { backgroundColor: SERVICES_GREEN_LIGHT }]}
            onPress={() => setView("grid")}
            accessibilityRole="button"
            accessibilityLabel={t("عرض الشبكة")}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={view === "grid" ? "white" : colors.text} strokeWidth={2.2}>
              <Rect x={4} y={4} width={6.5} height={6.5} rx={1.5} />
              <Rect x={13.5} y={4} width={6.5} height={6.5} rx={1.5} />
              <Rect x={4} y={13.5} width={6.5} height={6.5} rx={1.5} />
              <Rect x={13.5} y={13.5} width={6.5} height={6.5} rx={1.5} />
            </Svg>
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <CompanyScreenHeader title={meta ? t(meta.label) : t("الخدمات")} color={colors.text} styles={styles} />
      {!category ? (
        <View style={styles.content}><View style={styles.card}><Text style={styles.paragraph}>{t("هذا القسم غير موجود.")}</Text></View></View>
      ) : (
        <FlatList
          key={view === "grid" ? `grid-${columns}` : "list"}
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          numColumns={view === "grid" ? columns : 1}
          columnWrapperStyle={view === "grid" ? { gap: gridGap } : undefined}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: 16, gap: view === "grid" ? gridGap : 12, paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            q.isLoading ? (
              <ActivityIndicator color={SERVICES_GREEN_LIGHT} style={{ marginTop: 40 }} />
            ) : q.isError ? (
              <View style={styles.card}>
                <Text style={styles.paragraph}>{t("تعذر تحميل الشركات، حاول مرة أخرى.")}</Text>
                <Pressable style={styles.outlineBtn} onPress={() => void q.refetch()}><Text style={styles.outlineBtnText}>{t("إعادة المحاولة")}</Text></Pressable>
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.paragraph}>{search || province || region ? t("لا توجد شركات مطابقة للبحث.") : t("لا توجد شركات مسجّلة في هذا القسم بعد. كن أول من يضيف شركته!")}</Text>
              </View>
            )
          }
          refreshing={q.isRefetching}
          onRefresh={() => void q.refetch()}
        />
      )}

      <OptionPickerModal
        visible={picker === "province"}
        title={t("اختر المحافظة")}
        options={provinceOptions}
        selected={province}
        allowClear
        clearLabel={t("كل المحافظات")}
        onSelect={(v) => { setProvince(v); setRegion(""); }}
        onClose={() => setPicker(null)}
        renderLabel={t}
      />
      <OptionPickerModal
        visible={picker === "region"}
        title={t("اختر المنطقة")}
        options={regionOptions}
        selected={region}
        allowClear
        clearLabel={t("كل المناطق")}
        onSelect={(v) => setRegion(v)}
        onClose={() => setPicker(null)}
        renderLabel={t}
      />
    </View>
  );
}
