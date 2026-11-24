import { memo, useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors } from "../../lib/hooks/useThemeColors";
import { useFavorites } from "../../lib/hooks/useFavorites";
import { useFeaturedAds, type FeaturedAd, type FeaturedFilters } from "../../lib/hooks/useFeaturedAds";
import { featuredCardThumbnailUrl } from "../../lib/cloudinary";
import { fmtPrice, type Property } from "../../lib/types";
import { formatLocationLine } from "../../lib/formatLocation";
import { AutoCarousel } from "../shared/AutoCarousel";
import { SponsoredAdReelModal } from "../search/SponsoredAdReelModal";
import { ReelBackground } from "../reel/ReelBackground";

// ↔ قسم «إعلانات مميزة» — مكوّن واحد يُستخدم فى 4 أماكن بنفس الشكل والحركة (لا تكرار كود):
//   ١) صفحة البحث (بعد شريط البحث والفلترة)  ٢) صفحة تفاصيل العقار (أسفل الصفحة)  ٣) صفحة القائمة (نهايتها)  ٤) صفحة الشركة (نهايتها).
//   • الرأس: «عقارات في الصدارة» + «إعلانات مميزة» + «عرض الكل» (يفتح /featured-ads بكل الإعلانات المميزة النشطة).
//   • الكروت: غلاف مصغّر (featuredCardThumbnailUrl — تحويل Cloudinary بحجم الكارت على نفس الرابط المخزّن، لا رفع جديد ولا فيديو) +
//     نوع الدفع كاش/تقسيط + شارة «مميز» + المفضلة + التصنيف + العنوان + المنطقة + السعر + المساحة/الغرف/الحمامات.
//   • الضغط على كارت يفتح مشغّل الريل للإعلان (SponsoredAdReelModal = نفس ReelCard + تسجيل الوصول) — الفيديو لا يُحمَّل إلا حينها.
//   • لا يظهر شىء لو لا توجد إعلانات مميزة نشطة؛ ويختفى الإعلان فور انتهاء مدة تمييزه (useFeaturedAds).
export function propertyCategoryLabel(type: string): string {
  if (type === "أرض") return "أرض";
  if (type === "تجاري" || type === "إداري" || type === "طبي") return "تجاري";
  return "سكني";
}

type Props = { filters?: FeaturedFilters; style?: StyleProp<ViewStyle> };

export function FeaturedAdsStrip({ filters, style }: Props) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const { ads } = useFeaturedAds(filters);
  const { favoriteProperties, toggleFavoriteProperty } = useFavorites();
  const [open, setOpen] = useState<FeaturedAd | null>(null);

  const renderItem = useCallback(
    (ad: FeaturedAd, width: number) => (
      <FeaturedAdCard
        ad={ad}
        width={width}
        isFavorite={favoriteProperties.has(ad.property.id)}
        onToggleFavorite={() => toggleFavoriteProperty(ad.property.id)}
        onOpen={() => setOpen(ad)}
      />
    ),
    [favoriteProperties, toggleFavoriteProperty]
  );

  if (ads.length === 0) return open ? (
    <SponsoredAdReelModal property={open.property} sponsoredReelId={open.reelId} onClose={() => setOpen(null)} />
  ) : null;

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.header}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.eyebrow}>{t("عقارات في الصدارة")}</Text>
          <Text style={[styles.title, { color: themeColors.text }]}>{t("إعلانات مميزة")}</Text>
        </View>
        <Pressable onPress={() => router.push("/featured-ads" as Href)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("عرض الكل")}>
          <Text style={styles.viewAll}>{t("عرض الكل")}</Text>
        </Pressable>
      </View>

      <AutoCarousel items={ads} keyOf={(a) => a.reelId} renderItem={renderItem} itemWidth={(vw) => Math.min(330, Math.round(vw * 0.78))} gap={12} />

      <SponsoredAdReelModal property={open?.property ?? null} sponsoredReelId={open?.reelId} onClose={() => setOpen(null)} />
    </View>
  );
}

// ↔ كارت إعلان مميز (يُستخدم أيضًا فى شاشة «عرض الكل» عبر الـ export).
export const FeaturedAdCard = memo(function FeaturedAdCard({ ad, width, isFavorite, onToggleFavorite, onOpen }: {
  ad: FeaturedAd;
  width: number;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const p: Property = ad.property;
  const thumb = featuredCardThumbnailUrl(p);
  const mediaH = Math.round(width * 0.6);
  return (
    <Pressable style={[styles.card, { backgroundColor: themeColors.card, width }]} onPress={onOpen} accessibilityRole="button" accessibilityLabel={p.title}>
      <View style={{ height: mediaH }}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={150} recyclingKey={p.id} />
        ) : (
          <ReelBackground index={0} type={p.type} />
        )}
        {!!p.payment && (
          <View style={styles.payBadge}>
            <Text style={styles.payBadgeText}>{p.payment === "cash" ? t("كاش") : t("تقسيط")}</Text>
          </View>
        )}
        <View style={styles.featuredBadge}>
          <Text style={styles.featuredBadgeText}>★ {t("مميز")}</Text>
        </View>
        <Pressable
          style={styles.heart}
          onPress={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("المفضلة")}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" fill={isFavorite ? "#E11D48" : "none"} stroke={isFavorite ? "#E11D48" : "#1D6FD8"} strokeWidth={2.2} strokeLinejoin="round">
            <Path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.5 1 4.6 2.6C12.1 6 13.6 5 15.6 5 19 5 21.1 8.4 19.6 11.8 17.5 16.4 12 21 12 21z" />
          </Svg>
        </Pressable>
      </View>

      <View style={styles.info}>
        <Text style={styles.category}>{t(propertyCategoryLabel(p.type))}</Text>
        <Text style={[styles.cardTitle, { color: themeColors.text }]} numberOfLines={2}>{p.shortTitle?.trim() || p.title?.trim() || t(p.type)}</Text>
        <Text style={[styles.location, { color: themeColors.textSubtle }]} numberOfLines={1}>{formatLocationLine(p.province, p.location, t)}</Text>
        <Text style={styles.price}>
          {fmtPrice(p.price)} <Text style={styles.priceUnit}>{t("جنيه")}{p.purpose === "rent" ? ` ${t("/ شهر")}` : ""}</Text>
        </Text>
        <View style={[styles.divider, { backgroundColor: themeColors.border }]} />
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: themeColors.textMuted }]}>📐 {p.area} {t("م²")}</Text>
          {!!p.rooms && <Text style={[styles.meta, { color: themeColors.textMuted }]}>🛏 {p.rooms} {t("غرف")}</Text>}
          {!!p.baths && <Text style={[styles.meta, { color: themeColors.textMuted }]}>🛁 {p.baths} {t("حمام")}</Text>}
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrap: { marginTop: 14, marginBottom: 8, paddingHorizontal: 14 },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 10, gap: 12 },
  eyebrow: { color: "#18B26B", fontSize: 13, fontWeight: "800", marginBottom: 2 },
  title: { fontSize: 22, fontWeight: "900" },
  viewAll: { color: "#1D6FD8", fontSize: 14, fontWeight: "800", paddingBottom: 4 },
  card: {
    borderRadius: 18, overflow: "hidden", marginBottom: 6,
    shadowColor: "#1E3A8A", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  payBadge: { position: "absolute", top: 10, right: 10, backgroundColor: "rgba(15,32,68,0.92)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5 },
  payBadgeText: { color: "white", fontSize: 13, fontWeight: "800" },
  featuredBadge: { position: "absolute", bottom: 10, right: 10, backgroundColor: "rgba(217,119,6,0.95)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  featuredBadgeText: { color: "white", fontSize: 11, fontWeight: "900" },
  heart: { position: "absolute", top: 10, left: 10, width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.95)", alignItems: "center", justifyContent: "center" },
  info: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12 },
  category: { color: "#1D6FD8", fontSize: 14, fontWeight: "800", marginBottom: 2 },
  cardTitle: { fontSize: 15.5, lineHeight: 23, fontWeight: "900", minHeight: 46 },
  location: { fontSize: 12.5, marginTop: 2, marginBottom: 6 },
  price: { color: "#1D6FD8", fontSize: 22, fontWeight: "900" },
  priceUnit: { fontSize: 13, fontWeight: "700", color: "#6B7280" },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 8, marginBottom: 8 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  meta: { fontSize: 12.5, fontWeight: "800" },
});
