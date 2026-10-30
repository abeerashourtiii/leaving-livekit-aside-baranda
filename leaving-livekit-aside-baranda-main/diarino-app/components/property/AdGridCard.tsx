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
  // ↔ رسالة حالة تحت بيانات الإعلان (مثلًا «قيد المراجعة: سيظهر للجميع بعد موافقة الإدارة» أو سبب الرفض) — pending/rejected.
  note?: { text: string; tone: "pending" | "rejected" | "info" };
};

export const AdGridCard = memo(function AdGridCard({ item, index = 0, topStart, bottomStart, note, ...pressableProps }: Props) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const thumbnailUrl = cardThumbnailUrl(item);
  // ↔ إعلان مُغلق بصفقة: الشارة تكتب «تم البيع» أو «تم الإيجار» بدل «بيع/إيجار» (ويبقى الكارت فى إدارة الحساب وصفحة المعلن).
  const closed = item.closedType;
  const badgeText = closed ? (closed === "rented" ? t("تم الإيجار") : t("تم البيع")) : item.purpose === "sale" ? t("بيع") : t("إيجار");
  const badgeColor = closed ? "#B91C1C" : item.purpose === "sale" ? "#22A652" : "#F4673F";
  return (
    <Pressable style={styles.card} {...pressableProps}>
      <View style={styles.media}>
        {thumbnailUrl ? (
          <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={150} />
        ) : (
          <ReelBackground index={index} type={item.type} />
        )}
        {!!closed && <View style={styles.closedOverlay} pointerEvents="none" />}
        <View style={[styles.purposeBadge, { backgroundColor: badgeColor }]}>
          <Text style={styles.purposeBadgeText}>{badgeText}</Text>
        </View>
        {!!topStart && <View style={styles.topStart}>{topStart}</View>}
        {!!bottomStart && <View style={styles.bottomStart}>{bottomStart}</View>}
      </View>
      <View style={styles.info}>
        {/* ↔ عنوان الإعلان بدل نوع العقار (شقة/فيلا...): سطر واحد بخط يصغر تلقائيًا ليكفى العنوان داخل الكارت (فى الصفحات التلاتة:
            البحث، صفحة المعلن، إعلاناتى — لأن الكارت مصدر واحد). لو مفيش عنوان نرجع لنوع العقار. */}
        <Text
          style={styles.title}
          numberOfLines={1}
          ellipsizeMode="tail"
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          {item.shortTitle?.trim() || item.title?.trim() || t(item.type)}
        </Text>
        <Text style={styles.price}>{fmtPrice(item.price)} {t("ج.م")} {item.purpose === "rent" ? t("/ شهر") : ""}</Text>
        <Text style={styles.location} numberOfLines={1}>📍 {formatLocationLine(item.province, item.location, t)}</Text>
        <View style={styles.metaRow}>
          {!!item.rooms && <Text style={styles.meta}>🛏 {item.rooms}</Text>}
          <Text style={styles.meta}>📐 {item.area} {t("م²")}</Text>
        </View>
      </View>
      {!!note && (
        <View style={[styles.note, note.tone === "rejected" ? styles.noteRejected : note.tone === "info" ? styles.noteInfo : styles.notePending]}>
          <Text style={[styles.noteText, note.tone === "rejected" ? styles.noteTextRejected : note.tone === "info" ? styles.noteTextInfo : styles.noteTextPending]}>{note.text}</Text>
        </View>
      )}
    </Pressable>
  );
});

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    card: { flex: 1, backgroundColor: themeColors.card, borderRadius: 14, overflow: "hidden" },
    media: { height: AD_CARD_MEDIA_HEIGHT, position: "relative" },
    closedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.28)" },
    purposeBadge: { position: "absolute", top: 8, right: 8, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
    purposeBadgeText: { color: "white", fontSize: 9.5, fontWeight: "900" },
    topStart: { position: "absolute", top: 8, left: 8, flexDirection: "row", gap: 6 },
    bottomStart: { position: "absolute", bottom: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 6 },
    info: { padding: 10 },
    note: { paddingHorizontal: 10, paddingVertical: 7 },
    notePending: { backgroundColor: themeColors.isDark ? "rgba(217,119,6,0.22)" : "#FEF3C7" },
    noteRejected: { backgroundColor: themeColors.isDark ? "rgba(220,38,38,0.22)" : "#FEE2E2" },
    noteInfo: { backgroundColor: themeColors.isDark ? "rgba(34,166,82,0.20)" : "#DCFCE7" },
    noteTextInfo: { color: themeColors.isDark ? "#86EFAC" : "#166534" },
    noteText: { fontSize: 10.5, fontWeight: "800", lineHeight: 16 },
    noteTextPending: { color: themeColors.isDark ? "#FCD34D" : "#92400E" },
    noteTextRejected: { color: themeColors.isDark ? "#FCA5A5" : "#991B1B" },
    title: { fontSize: 12.5, fontWeight: "800", color: themeColors.text, marginBottom: 3 },
    price: { fontSize: 13.5, fontWeight: "900", color: "#22A652", marginBottom: 4 },
    location: { fontSize: 10.5, color: themeColors.textSubtle, marginBottom: 6 },
    metaRow: { flexDirection: "row", gap: 8 },
    meta: { fontSize: 10, fontWeight: "800", color: themeColors.textMuted },
  });
}
