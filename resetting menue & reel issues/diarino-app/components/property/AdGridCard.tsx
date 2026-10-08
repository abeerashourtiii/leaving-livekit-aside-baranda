import { memo, ReactNode } from "react";
import { View, Text, Pressable, PressableProps, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { fmtPrice, Property } from "../../lib/types";
import { cardThumbnailUrl } from "../../lib/cloudinary";
import { formatLocationLine } from "../../lib/formatLocation";
import { ReelBackground } from "../reel/ReelBackground";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ كارت الإعلان فى الشبكات ذات العمودين — مصدر واحد للتصميم والحجم فى:
//   • صفحة البحث (app/(tabs)/search.tsx)
//   • صفحة المعلن (app/seller/[id].tsx)
//   • إعلاناتي فى إدارة الحساب (app/(tabs)/account.tsx)
// عشان الكروت تطلع بنفس الحجم بالظبط فى التلات صفحات: العرض flex:1 (نص الصف)
// وارتفاع الصورة ثابت، ومحتوى الكارت واحد (النوع، السعر، المحافظة · المنطقة،
// الغرف والمساحة). كل صفحة بتضيف أزرارها هى عن طريق الـ slots:
//   topStart    : أعلى الصورة من جهة البداية (مقارنة / إعجاب ومفضلة / ⋮)
//   bottomStart : أسفل الصورة من جهة البداية (شارة التثبيت / حالة المراجعة)
export const AD_CARD_MEDIA_HEIGHT = 120;

type Props = Omit<PressableProps, "style" | "children"> & {
  item: Property;
  index?: number;
  topStart?: ReactNode;
  bottomStart?: ReactNode;
};

export const AdGridCard = memo(function AdGridCard({ item, index = 0, topStart, bottomStart, ...pressableProps }: Props) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const thumbnailUrl = cardThumbnailUrl(item);
  return (
    <Pressable style={styles.card} {...pressableProps}>
      <View style={styles.media}>
        {thumbnailUrl ? (
          <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={150} />
        ) : (
          <ReelBackground index={index} type={item.type} />
        )}
        <View style={[styles.purposeBadge, { backgroundColor: item.purpose === "sale" ? "#22A652" : "#F4673F" }]}>
          <Text style={styles.purposeBadgeText}>{item.purpose === "sale" ? t("بيع") : t("إيجار")}</Text>
        </View>
        {!!topStart && <View style={styles.topStart}>{topStart}</View>}
        {!!bottomStart && <View style={styles.bottomStart}>{bottomStart}</View>}
      </View>
      <View style={styles.info}>
        <Text style={styles.type}>{t(item.type)}</Text>
        <Text style={styles.price}>{fmtPrice(item.price)} {t("ج.م")} {item.purpose === "rent" ? t("/ شهر") : ""}</Text>
        <Text style={styles.location} numberOfLines={1}>📍 {formatLocationLine(item.province, item.location, t)}</Text>
        <View style={styles.metaRow}>
          {!!item.rooms && <Text style={styles.meta}>🛏 {item.rooms}</Text>}
          <Text style={styles.meta}>📐 {item.area} {t("م²")}</Text>
        </View>
      </View>
    </Pressable>
  );
});

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    card: { flex: 1, backgroundColor: themeColors.card, borderRadius: 14, overflow: "hidden" },
    media: { height: AD_CARD_MEDIA_HEIGHT, position: "relative" },
    purposeBadge: { position: "absolute", top: 8, right: 8, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
    purposeBadgeText: { color: "white", fontSize: 9.5, fontWeight: "900" },
    topStart: { position: "absolute", top: 8, left: 8, flexDirection: "row", gap: 6 },
    bottomStart: { position: "absolute", bottom: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 6 },
    info: { padding: 10 },
    type: { fontSize: 10.5, fontWeight: "800", color: themeColors.textSubtle, marginBottom: 3 },
    price: { fontSize: 13.5, fontWeight: "900", color: "#22A652", marginBottom: 4 },
    location: { fontSize: 10.5, color: themeColors.textSubtle, marginBottom: 6 },
    metaRow: { flexDirection: "row", gap: 8 },
    meta: { fontSize: 10, fontWeight: "800", color: themeColors.textMuted },
  });
}
