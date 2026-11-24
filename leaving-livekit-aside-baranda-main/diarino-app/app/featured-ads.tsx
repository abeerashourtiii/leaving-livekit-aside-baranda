import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, StyleSheet } from "react-native";
import { router, type Href } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "../lib/hooks/useLanguage";
import { useThemeColors } from "../lib/hooks/useThemeColors";
import { useFeaturedAds, type FeaturedAd } from "../lib/hooks/useFeaturedAds";
import { padToEvenColumns } from "../lib/gridPadding";
import { AdGridCard } from "../components/property/AdGridCard";
import { SponsoredAdReelModal } from "../components/search/SponsoredAdReelModal";

// ↔ «عرض الكل» من شريط «إعلانات مميزة»: كل الإعلانات المميزة النشطة حاليًا (بلا فلاتر) فى شبكة من عمودين بنفس كروت البحث.
//   الضغط على إعلان يفتح مشغّل الريل الخاص به. تختفى الإعلانات تلقائيًا فور انتهاء مدة التمييز (useFeaturedAds).
export default function FeaturedAdsScreen() {
  const { t } = useLanguage();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { ads, isLoading } = useFeaturedAds();
  const [open, setOpen] = useState<FeaturedAd | null>(null);

  const rows = useMemo(() => padToEvenColumns(ads.map((a) => a.property)), [ads]);
  const byProperty = useMemo(() => new Map(ads.map((a) => [a.property.id, a])), [ads]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/search" as Href);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable style={[styles.closeBtn, { backgroundColor: colors.surface }]} onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("رجوع")}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={colors.text} strokeWidth={2}>
            <Path d="M18 6L6 18M6 6l12 12" />
          </Svg>
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.eyebrow}>{t("عقارات في الصدارة")}</Text>
          <Text style={[styles.title, { color: colors.text }]}>{t("إعلانات مميزة")}</Text>
        </View>
        <View style={{ width: 34 }} />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(p, i) => (p ? p.id : `filler-${i}`)}
        numColumns={2}
        columnWrapperStyle={{ gap: 10, paddingHorizontal: 14 }}
        contentContainerStyle={{ gap: 10, paddingTop: 12, paddingBottom: insets.bottom + 40 }}
        renderItem={({ item }) =>
          item === null ? (
            <View style={{ flex: 1 }} />
          ) : (
            <AdGridCard
              item={item}
              onPress={() => {
                const ad = byProperty.get(item.id);
                if (ad) setOpen(ad);
              }}
              bottomStart={
                <View style={styles.pill}><Text style={styles.pillText}>★ {t("مميز")}</Text></View>
              }
            />
          )
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color="#22A652" style={{ marginTop: 60 }} />
          ) : (
            <View style={styles.empty}><Text style={[styles.emptyText, { color: colors.textSubtle }]}>{t("لا توجد إعلانات مميزة حاليًا")}</Text></View>
          )
        }
      />

      <SponsoredAdReelModal property={open?.property ?? null} sponsoredReelId={open?.reelId} onClose={() => setOpen(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  eyebrow: { color: "#18B26B", fontSize: 12, fontWeight: "800" },
  title: { fontSize: 18, fontWeight: "900" },
  pill: { backgroundColor: "rgba(217,119,6,0.95)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { color: "white", fontSize: 10.5, fontWeight: "900" },
  empty: { alignItems: "center", marginTop: 60, paddingHorizontal: 24 },
  emptyText: { fontSize: 13.5, fontWeight: "700", textAlign: "center" },
});
