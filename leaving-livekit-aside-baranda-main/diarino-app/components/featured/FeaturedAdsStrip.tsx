import { memo, useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors } from "../../lib/hooks/useThemeColors";
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

// ↔ عرض الكارت = عرض كارت الشبكة العادية فى البحث (نصف العرض بعد الفاصل) × 1.12 (أكبر منه بـ 12% فقط)، بحد أقصى للشاشات العريضة.
//   لا توجد أيقونة قلب هنا: الإعجاب/المفضلة من داخل شاشة الريل عند فتح الإعلان.
export function featuredCardWidth(viewportWidth: number): number {
  return Math.max(150, Math.min(230, Math.round(((viewportWidth - 10) / 2) * 1.12)));
}

type Props = { filters?: FeaturedFilters; style?: StyleProp<ViewStyle> };

export function FeaturedAdsStrip({ filters, style }: Props) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const { ads } = useFeaturedAds(filters);
  const [open, setOpen] = useState<FeaturedAd | null>(null);

  const renderItem = useCallback(
    (ad: FeaturedAd, width: number) => (
      <FeaturedAdCard ad={ad} width={width} onOpen={() => setOpen(ad)} />
    ),
    []
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

      <AutoCarousel items={ads} keyOf={(a) => a.reelId} renderItem={renderItem} itemWidth={featuredCardWidth} gap={10} />

      <SponsoredAdReelModal property={open?.property ?? null} sponsoredReelId={open?.reelId} onClose={() => setOpen(null)} />
    </View>
  );
}

// ↔ كارت إعلان مميز (يُستخدم أيضًا فى شاشة «عرض الكل» عبر الـ export).
export const FeaturedAdCard = memo(function FeaturedAdCard({ ad, width, onOpen }: {
  ad: FeaturedAd;
  width: number;
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const p: Property = ad.property;
  const thumb = featuredCardThumbnailUrl(p);
  const mediaH = Math.round(width * 0.68);
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
      </View>

      <View style={styles.info}>
        <Text style={styles.category}>{t(propertyCategoryLabel(p.type))}</Text>
        <Text style={[styles.cardTitle, { color: themeColors.text }]} numberOfLines={2} ellipsizeMode="tail">{p.shortTitle?.trim() || p.title?.trim() || t(p.type)}</Text>
        <Text style={[styles.location, { color: themeColors.textSubtle }]} numberOfLines={1}>{formatLocationLine(p.province, p.location, t)}</Text>
        <Text style={styles.price} numberOfLines={1}>
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
  wrap: { marginTop: 12, marginBottom: 6, paddingHorizontal: 14 },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 8, gap: 12 },
  eyebrow: { color: "#18B26B", fontSize: 12, fontWeight: "800", marginBottom: 1 },
  title: { fontSize: 19, fontWeight: "900" },
  viewAll: { color: "#1D6FD8", fontSize: 13, fontWeight: "800", paddingBottom: 3 },
  card: {
    borderRadius: 14, overflow: "hidden", marginBottom: 6,
    shadowColor: "#1E3A8A", shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  payBadge: { position: "absolute", top: 6, right: 6, backgroundColor: "rgba(15,32,68,0.92)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  payBadgeText: { color: "white", fontSize: 10.5, fontWeight: "800" },
  featuredBadge: { position: "absolute", bottom: 6, right: 6, backgroundColor: "rgba(217,119,6,0.95)", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  featuredBadgeText: { color: "white", fontSize: 9.5, fontWeight: "900" },
  info: { paddingHorizontal: 9, paddingTop: 8, paddingBottom: 8 },
  category: { color: "#1D6FD8", fontSize: 11, fontWeight: "800", marginBottom: 1 },
  cardTitle: { fontSize: 12.5, lineHeight: 17, fontWeight: "900", minHeight: 34 },
  location: { fontSize: 10.5, marginTop: 1, marginBottom: 4 },
  price: { color: "#1D6FD8", fontSize: 15.5, fontWeight: "900" },
  priceUnit: { fontSize: 10.5, fontWeight: "700", color: "#6B7280" },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 5, marginBottom: 5 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  meta: { fontSize: 10.5, fontWeight: "800" },
});
