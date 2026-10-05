import { ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, I18nManager } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path, Circle } from "react-native-svg";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { MenuItem, MenuImageSize } from "../../lib/hooks/useMenuItems";
import {
  MenuCardIcon, menuCardImageSource, menuCardImageIsTransparent, AD_PLACEHOLDER_IMAGE, AD_PLACEHOLDER_IMAGE_EN, AD_PLACEHOLDER_ASPECT,
  menuArtCardFor,
} from "../../lib/menuIconRegistry";
import { cldOptimized } from "../../lib/cloudinary";
import { useMyAvatar } from "../../lib/hooks/useMyAvatar";

// ↔ كروت صفحة "القائمة" (كانت جوه app/(tabs)/menu.tsx) — اتنقلت هنا وأُعيد
// تصميمها لتطابق التصميم المرجعي:
//   * زوايا أكبر (22) + ظل ناعم + حد رفيع لامع.
//   * تدرّج لوني اختياري (color -> colorEnd) من لوحة الأدمن.
//   * دائرة "إدارة الحساب" بصورة المستخدم الفعلية + شارة شخص صغيرة.
//   * بانر كامل بزرار "اطلب الآن" + شارة صفراء بأيقونة توصيل (badgeLabel).
//   * كارت طويل "Repoo": عنوان كبير + وصف بجانب الصورة + سطر إنجاز + CTA نصي.
// كل تخطيطات الأدمن القديمة (below/above/overlay/hidden/beside) لسه شغّالة.
//
// ↔ اتجاه الصفوف: كل حاجة هنا بتعتمد على flexDirection العادي (بينعكس
// تلقائيًا مع RTL/LTR) ما عدا الأماكن اللى "يمين/شمال" فيها اختيار تصميم
// ثابت (صورة الكارت جنب النص) — دي بتستخدم FIXED_ROW زي الأول، وبنفس
// الطريقة على الأندرويد والآيفون والويب والـ APK.

// ↔ image_size (حجم الصورة داخل الأيقونة): نسبة الحجم لـ iconBoxHeight،
// وحشو الصورة فى تخطيطات above/overlay/hidden (full = حافة لحافة).
const MEDIA_SIZE_SCALE: Record<MenuImageSize, number> = { small: 0.65, medium: 1, large: 1.45, full: 1.9 };
const MEDIA_PAD: Record<MenuImageSize, number> = { full: 0, large: 6, medium: 14, small: 24 };

const FIXED_ROW = I18nManager.isRTL ? "row-reverse" : "row";
const TEXT_START: "right" | "left" = I18nManager.isRTL ? "right" : "left";

function vAlignToJustify(v: MenuItem["textVAlign"]): "flex-start" | "center" | "flex-end" {
  return v === "top" ? "flex-start" : v === "bottom" ? "flex-end" : "center";
}

export function textColorFor(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length < 6) return "white";
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1f2937" : "#ffffff";
}

// ---------------------------------------------------------------------
// أيقونات صغيرة
// ---------------------------------------------------------------------
function PersonGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2}>
      <Path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" strokeLinecap="round" />
      <Circle cx={12} cy={7} r={4} />
    </Svg>
  );
}

function TruckGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M2 6h11v10H2z" />
      <Path d="M13 9h4.5l3 3.5V16H13z" />
      <Circle cx={6.5} cy={17.5} r={1.8} fill={color} />
      <Circle cx={16.5} cy={17.5} r={1.8} fill={color} />
      <Path d="M4 9.5h5M4 12.5h3" />
    </Svg>
  );
}

// ---------------------------------------------------------------------
// الغلاف: View خارجي بالظل + Pressable داخلي بـ overflow:hidden.
// (لازم الاتنين منفصلين: الظل على iOS بيتقصّ لو نفس الـ View فيه
// overflow:hidden، والـ backgroundColor على الخارجي لازم عشان ظل
// الـ elevation على أندرويد.)
// ---------------------------------------------------------------------
function Shell({
  color, flex, round, minHeight, aspect, children,
}: { color: string; flex?: boolean; round?: boolean; minHeight?: number; aspect?: number; children: ReactNode }) {
  return (
    <View
      style={[
        styles.shell,
        { backgroundColor: color },
        round ? styles.shellRound : null,
        flex ? { flex: 1 } : null,
        aspect ? { aspectRatio: aspect } : minHeight ? { minHeight } : null,
      ]}
    >
      {children}
    </View>
  );
}

function Gradient({ item }: { item: MenuItem }) {
  if (!item.colorEnd) return null;
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[item.color, item.colorEnd]}
      start={{ x: 0, y: 0.1 }}
      end={{ x: 1, y: 0.9 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

function rimColor(textColor: string): string {
  return textColor === "#ffffff" ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.07)";
}

// ---------------------------------------------------------------------
// MenuCard
// ---------------------------------------------------------------------
export function MenuCard({
  item, onPress, flex, shape = "rect", minHeight, iconBoxHeight = 56,
}: {
  item: MenuItem; onPress: () => void; flex?: boolean;
  shape?: "rect" | "circle"; minHeight?: number; iconBoxHeight?: number;
}) {
  const { t, language } = useLanguage();
  const textColor = textColorFor(item.color);
  const fg = item.fontColor ?? textColor;
  const subtitleColor = item.fontColor
    ? item.fontColor
    : textColor === "#ffffff" ? "rgba(255,255,255,0.72)" : "rgba(31,41,55,0.78)";

  const titleFontStyle = {
    fontSize: item.fontSize ?? undefined,
    fontWeight: item.fontBold ? ("900" as const) : ("700" as const),
    fontStyle: item.fontStyle === "italic" ? ("italic" as const) : ("normal" as const),
  };

  const padH = Math.max(0, Math.min(item.imagePadH ?? MEDIA_PAD[item.imageSize] ?? 14, 80));
  const padV = Math.max(0, Math.min(item.imagePadV ?? MEDIA_PAD[item.imageSize] ?? 14, 80));

  const customSource = item.imageUrl ? { uri: cldOptimized(item.imageUrl, "w_800,q_auto,f_auto") } : null;
  const bgSource = customSource ?? menuCardImageSource(item.iconKey);

  const innerBase = [styles.inner, { backgroundColor: item.color, borderColor: rimColor(textColor) }];

  function smallMedia(height: number) {
    if (customSource) {
      return (
        <Image
          source={customSource}
          style={{ height, width: item.imageSize === "full" ? "100%" : height, borderRadius: 8 }}
          contentFit={item.imageFit}
          transition={150}
        />
      );
    }
    return <MenuCardIcon iconKey={item.iconKey} height={height} color={fg} />;
  }

  const mediaHeight = iconBoxHeight * (MEDIA_SIZE_SCALE[item.imageSize] ?? 1);

  // ---- 1) دائرة "إدارة الحساب" ----------------------------------------
  if (shape === "circle" && item.iconKey === "account_circle") {
    return <AccountCircle item={item} onPress={onPress} fg={item.fontColor ?? "#4A3427"} />;
  }

  // ---- 2) بانر كامل بزرار CTA (لوازم السباكة والكهرباء) -----------------
  if (item.ctaLabel && item.size === "full") {
    return (
      <Shell color={item.color} flex={flex} minHeight={minHeight ?? 132}>
        <Pressable style={[...innerBase, styles.bannerInner, { flexDirection: FIXED_ROW }]} onPress={onPress}>
          <Gradient item={item} />
          {smallMedia(Math.max(mediaHeight, 92))}
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: fg, textAlign: TEXT_START }, titleFontStyle]} numberOfLines={2}>
              {t(item.title)}
            </Text>
            {!!item.subtitle && (
              <Text style={[styles.bannerSubtitle, { color: subtitleColor, textAlign: TEXT_START }]}>{t(item.subtitle)}</Text>
            )}
            <View style={styles.bannerActions}>
              <View style={styles.ctaPill}>
                <Text style={styles.ctaPillText}>{t(item.ctaLabel)}</Text>
              </View>
              {!!item.badgeLabel && (
                <View style={styles.badgePill}>
                  <TruckGlyph size={18} color="#2B2410" />
                  <Text style={styles.badgePillText} numberOfLines={1}>{t(item.badgeLabel)}</Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      </Shell>
    );
  }

  // ---- 2.5) كروت الصورة-الجاهزة (Repoo + ونش ونقل أثاث): الصورة هي الكارت كله --
  // النصوص جوه الصورة، والنسخة
  // (عربي/إنجليزي) بتتحدد من لغة التطبيق. contentFit="contain": الصورة بتتعرض
  // كاملة بنسبتها من غير اقتصاص ولا تمدد، وأي فراغ بيتملي بلون الكارت (= لون
  // خلفية الصورة).
  // ↔ بيتفعّل حسب العنوان/icon_key (menuArtCardFor) *بغض النظر* عن image_url وtext_layout
  // المخزّنين فى الصف: صف Repoo فى الإنتاج كان فيه صورة مخصّصة قديمة بتخلّى الكارت يظهر فاضى
  // (لون الخلفية بس) وكان بيتخطّى التصميم الجديد. لو عايز كارت بصورة مخصّصة بدلًا منه غيّر
  // عنوانه/الأيقونة من لوحة الأدمن.
  const art = shape === "circle" ? null : menuArtCardFor(item);
  if (art) {
    return (
      <Shell color={art.bg} flex={flex} minHeight={minHeight} aspect={art.aspect}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={language === "en" ? art.labelEn : art.labelAr}
          style={[styles.inner, styles.artInner, { backgroundColor: art.bg }]}
          onPress={onPress}
        >
          <Image source={language === "en" ? art.en : art.ar} style={StyleSheet.absoluteFill} contentFit="contain" contentPosition="center" transition={150} />
          {!!art.rim && <View pointerEvents="none" style={[styles.artRim, { borderColor: art.rim }]} />}
        </Pressable>
      </Shell>
    );
  }

  // ---- 3) كارت طويل "vitrine" (Repoo): عنوان كبير + وصف جنب الصورة -------
  if (item.size === "tall" && (item.badgeLabel || item.ctaLabel) && item.textLayout === "below") {
    return (
      <Shell color={item.color} flex={flex} minHeight={minHeight}>
        <Pressable style={[...innerBase, styles.showcaseInner]} onPress={onPress}>
          <Gradient item={item} />
          <Text style={[styles.showcaseTitle, { color: fg }, item.fontSize ? { fontSize: item.fontSize } : null]} numberOfLines={1}>
            {t(item.title)}
          </Text>
          <View style={[styles.showcaseMid, { flexDirection: FIXED_ROW }]}>
            <View style={{ flex: 1 }}>
              {!!item.subtitle && (
                <Text style={[styles.showcaseSubtitle, { color: fg, textAlign: TEXT_START }]}>{t(item.subtitle)}</Text>
              )}
            </View>
            {smallMedia(iconBoxHeight * (MEDIA_SIZE_SCALE[item.imageSize] ?? 1))}
          </View>
          {!!item.badgeLabel && <Text style={[styles.showcaseBadge, { color: fg }]}>{t(item.badgeLabel)}</Text>}
          {!!item.ctaLabel && <Text style={[styles.showcaseCta, { color: fg }]}>{t(item.ctaLabel)}</Text>}
        </Pressable>
      </Shell>
    );
  }

  // ---- 4) باقي التخطيطات (اختيارات الأدمن القديمة) ---------------------
  // overlay/hidden من غير أي صورة مالهومش معنى — رجوع آمن لـ "below".
  const layout = (item.textLayout === "overlay" || item.textLayout === "hidden") && !bgSource ? "below" : item.textLayout;

  if (layout === "hidden") {
    return (
      <Shell color={item.color} flex={flex} round={shape === "circle"} minHeight={minHeight}>
        <Pressable style={[...innerBase, { padding: 0 }]} onPress={onPress}>
          <Gradient item={item} />
          <Image
            source={bgSource!}
            style={{ position: "absolute", top: padV, left: padH, right: padH, bottom: padV, borderRadius: shape === "circle" ? 999 : 12 }}
            contentFit={item.imageFit}
            transition={150}
          />
        </Pressable>
      </Shell>
    );
  }

  if (layout === "overlay") {
    const gradient =
      item.textVAlign === "top"
        ? { colors: ["rgba(0,0,0,0.75)", "transparent"] as const, locations: [0, 0.65] as const }
        : item.textVAlign === "middle"
          ? { colors: ["rgba(0,0,0,0.45)", "rgba(0,0,0,0.45)"] as const, locations: [0, 1] as const }
          : { colors: ["transparent", "rgba(0,0,0,0.75)"] as const, locations: [0.35, 1] as const };
    return (
      <Shell color={item.color} flex={flex} minHeight={minHeight}>
        <Pressable style={[...innerBase, { padding: 0, justifyContent: vAlignToJustify(item.textVAlign) }]} onPress={onPress}>
          <Image
            source={bgSource!}
            style={{ position: "absolute", top: padV, left: padH, right: padH, bottom: padV, borderRadius: 12 }}
            contentFit={item.imageFit}
            transition={150}
          />
          <LinearGradient colors={gradient.colors} locations={gradient.locations} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
          <View style={{ padding: 14 }}>
            <Text style={[styles.cardTitle, { color: "#ffffff", textAlign: item.textHAlign }, titleFontStyle]}>{t(item.title)}</Text>
            {!!item.subtitle && (
              <Text style={[styles.cardSubtitle, { color: "rgba(255,255,255,0.85)", textAlign: item.textHAlign }]}>{t(item.subtitle)}</Text>
            )}
          </View>
        </Pressable>
      </Shell>
    );
  }

  if (layout === "above") {
    // النص فوق، والصورة تحته بتاخد باقي الكارت.
    //  * صورة PNG شفافة (المبنى المضمّن): بتتعرض كاملة (contain) ملزوقة فى
    //    أسفل الكارت، من غير أي تدرّج.
    //  * صورة بخلفية مدمجة (JPG أو صورة مرفوعة من الأدمن): بتتعرض cover
    //    وأعلاها بيتلاشى فى لون الكارت (تدرّج) فمفيش حد مرئي بين خلفية
    //    الصورة والكارت.
    const transparentArt = !customSource && menuCardImageIsTransparent(item.iconKey);
    return (
      <Shell color={item.color} flex={flex} minHeight={minHeight}>
        <Pressable style={[...innerBase, { padding: 0, justifyContent: "flex-start" }]} onPress={onPress}>
          <Gradient item={item} />
          <View style={styles.aboveText}>
            <Text style={[styles.cardTitle, { color: fg, textAlign: item.textHAlign }, titleFontStyle]}>{t(item.title)}</Text>
            {!!item.subtitle && (
              <Text style={[styles.cardSubtitle, { color: subtitleColor, textAlign: item.textHAlign, fontSize: 13, lineHeight: 18 }]}>
                {t(item.subtitle)}
              </Text>
            )}
          </View>
          {!!bgSource && (
            <View style={[styles.aboveImageBox, { marginTop: padV, marginHorizontal: padH }]}>
              <Image
                source={bgSource}
                style={StyleSheet.absoluteFill}
                contentFit={transparentArt ? "contain" : item.imageFit}
                contentPosition="bottom"
                transition={150}
              />
              {!transparentArt && (
                <LinearGradient
                  pointerEvents="none"
                  colors={[item.color, "rgba(0,0,0,0)"]}
                  locations={[0, 1]}
                  style={styles.aboveFade}
                />
              )}
            </View>
          )}
        </Pressable>
      </Shell>
    );
  }

  if (layout === "beside") {
    const textBlock = (
      <View key="text" style={[styles.besideText, { justifyContent: vAlignToJustify(item.textVAlign) }]}>
        <Text style={[styles.cardTitle, { color: fg, textAlign: item.textHAlign }, titleFontStyle]}>{t(item.title)}</Text>
        {!!item.subtitle && (
          <Text style={[styles.cardSubtitle, { color: subtitleColor, textAlign: item.textHAlign }]}>{t(item.subtitle)}</Text>
        )}
      </View>
    );
    const mediaBlock = <View key="media">{smallMedia(mediaHeight)}</View>;
    return (
      <Shell color={item.color} flex={flex} minHeight={minHeight}>
        <Pressable style={[...innerBase, styles.besideInner, { flexDirection: FIXED_ROW }]} onPress={onPress}>
          <Gradient item={item} />
          {item.imageSide === "left" ? [mediaBlock, textBlock] : [textBlock, mediaBlock]}
        </Pressable>
      </Shell>
    );
  }

  // layout === "below" (الافتراضي) — صورة/أيقونة فوق، النص تحتها، الاتنين متوسّطين.
  return (
    <Shell color={item.color} flex={flex} round={shape === "circle"} minHeight={minHeight}>
      <Pressable style={[...innerBase, styles.belowInner]} onPress={onPress}>
        <Gradient item={item} />
        {smallMedia(mediaHeight)}
        <Text style={[styles.cardTitle, { color: fg, textAlign: "center", marginTop: 6 }, titleFontStyle]} numberOfLines={shape === "circle" ? 1 : 2}>
          {t(item.title)}
        </Text>
        {!!item.subtitle && (
          <Text style={[styles.cardSubtitle, { color: subtitleColor, textAlign: "center" }]}>{t(item.subtitle)}</Text>
        )}
      </Pressable>
    </Shell>
  );
}

// ---------------------------------------------------------------------
// دائرة "إدارة الحساب": صورة المستخدم الفعلية (profiles.avatar_url) أو
// أيقونة شخص لو مفيش صورة/ضيف — + شارة شخص صغيرة + الاسم تحتها.
// ---------------------------------------------------------------------
function AccountCircle({ item, onPress, fg }: { item: MenuItem; onPress: () => void; fg: string }) {
  const { t } = useLanguage();
  const avatar = useMyAvatar();
  return (
    <Shell color={item.color} round>
      <Pressable style={[styles.inner, styles.circleInner]} onPress={onPress}>
        <LinearGradient
          pointerEvents="none"
          colors={[item.color, item.colorEnd ?? item.color]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.avatarWrap}>
          <View style={styles.avatarCircle}>
            {avatar ? (
              <Image
                source={{ uri: cldOptimized(avatar, "w_200,h_200,c_fill,q_auto,f_auto") }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={150}
              />
            ) : (
              <PersonGlyph size={30} color="#8A6A4A" />
            )}
          </View>
          <View style={styles.avatarBadge}>
            <PersonGlyph size={11} color="#FFF7E6" />
          </View>
        </View>
        <Text style={[styles.circleLabel, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t(item.title)}</Text>
        <View pointerEvents="none" style={styles.circleRing} />
      </Pressable>
    </Shell>
  );
}

// ---------------------------------------------------------------------
// بانر "مساحة إعلانية" الثابت (لما مفيش أي بانر فعلي من الأدمن): صورة جاهزة
// (إطار + نصوص + زر مدمجين فيها، شفافة الزوايا) بتتعرض بنسبتها الأصلية
// وبعرض الصفحة كله، والضغط على أي مكان فيها بينفّذ الـ onPress. البانرات
// الفعلية (AdBannerCarousel) محتواها من الأدمن وما اتغيّرش.
// ---------------------------------------------------------------------
export function AdPlaceholder({ onPress }: { onPress: () => void }) {
  const { t, language } = useLanguage();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("مساحة إعلانية")}
      style={{ width: "100%", aspectRatio: AD_PLACEHOLDER_ASPECT }}
    >
      <Image source={language === "en" ? AD_PLACEHOLDER_IMAGE_EN : AD_PLACEHOLDER_IMAGE} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: 22,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  shellRound: { width: 100, height: 100, borderRadius: 50, alignSelf: "center" },
  inner: {
    flexGrow: 1,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    padding: 14,
    justifyContent: "center",
  },
  cardTitle: { fontWeight: "900", fontSize: 16 },
  cardSubtitle: { fontSize: 12.5, marginTop: 3 },

  belowInner: { alignItems: "center", justifyContent: "center", paddingVertical: 10, paddingHorizontal: 10 },
  besideInner: { alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 14 },
  besideText: { flex: 1, gap: 2 },

  aboveText: { paddingHorizontal: 16, paddingTop: 16 },
  aboveImageBox: { flex: 1, borderRadius: 0, overflow: "hidden", minHeight: 96 },
  aboveFade: { position: "absolute", top: 0, left: 0, right: 0, height: "38%" },

  artInner: { padding: 0, borderWidth: 0, justifyContent: "flex-start" },
  artRim: { ...StyleSheet.absoluteFillObject, borderRadius: 22, borderWidth: 2 },
  showcaseInner: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, justifyContent: "flex-start" },
  showcaseTitle: { fontSize: 34, fontWeight: "900", textAlign: "center" },
  showcaseMid: { flex: 1, alignItems: "center", gap: 6, marginTop: 2 },
  showcaseSubtitle: { fontSize: 19, fontWeight: "800", lineHeight: 27 },
  showcaseBadge: { fontSize: 13.5, textAlign: "center", marginTop: 4, opacity: 0.9 },
  showcaseCta: { fontSize: 16, fontWeight: "900", textAlign: "center", marginTop: 6 },

  bannerInner: { alignItems: "center", gap: 10, padding: 12 },
  bannerSubtitle: { fontSize: 15, marginTop: 3 },
  bannerActions: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, flexWrap: "wrap" },
  ctaPill: { backgroundColor: "#F2B23D", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13 },
  ctaPillText: { color: "#1f2937", fontWeight: "900", fontSize: 12.5 },
  badgePill: {
    flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FFD84D",
    borderRadius: 999, paddingVertical: 6, paddingHorizontal: 9, flexShrink: 1,
  },
  badgePillText: { color: "#2B2410", fontWeight: "900", fontSize: 11, flexShrink: 1 },

  circleInner: { alignItems: "center", justifyContent: "center", padding: 0, gap: 3, borderWidth: 0 },
  circleRing: { ...StyleSheet.absoluteFillObject, borderRadius: 50, borderWidth: 3, borderColor: "#7A5A3E" },
  avatarWrap: { width: 58, height: 58, marginTop: -2 },
  avatarCircle: {
    width: 58, height: 58, borderRadius: 29, overflow: "hidden", alignItems: "center", justifyContent: "center",
    backgroundColor: "#E4D0AA", borderWidth: 2, borderColor: "#FFF3D6",
  },
  avatarBadge: {
    position: "absolute", bottom: -2, right: -4, width: 20, height: 20, borderRadius: 10,
    backgroundColor: "#9A7650", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#EAD6AC",
  },
  circleLabel: { fontSize: 11.5, fontWeight: "900", maxWidth: 84 },
});
