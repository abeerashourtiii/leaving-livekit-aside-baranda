import { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Animated, Easing, Linking, FlatList, NativeSyntheticEvent, NativeScrollEvent, LayoutChangeEvent } from "react-native";
import { AdBanner } from "../../lib/hooks/useAdBanners";
import { useAdCarouselSettings } from "../../lib/hooks/useAdCarouselSettings";
import { useLogAdContact } from "../../lib/hooks/useAdContacts";
import { waLink } from "../../lib/whatsapp";
import { AD_BANNER_ASPECT } from "../../lib/adBannerSpec";
import { showToast } from "../shared/Toast";
import { AdPlaceholder } from "./MenuCard";
import { CascadeImage } from "../shared/CascadeImage";

// ↔ المساحة الإعلانية أعلى صفحة القائمة:
//  * كل إعلان أضافه الأدمن (صورته بتظهر كاملة بنفس مقاس المساحة — شوف lib/adBannerSpec.ts)
//    + صورة "ضع إعلانك هنا واستهدف آلاف العملاء يوميًا" الدائمة (للترويج لحجز إعلانات
//    تانية) بتدور مع بعض فى نفس الصندوق. الأدمن يقدر يعطّل الصورة الدائمة من لوحة التحكم
//    (المساحة الإعلانية ← "إظهار صورة ضع إعلانك هنا").
//  * التبديل التلقائي بيتحرك دايمًا ناحية اليمين (الصورة الجاية بتدخل من الشمال)،
//    بنفس الشكل فى العربى والإنجليزى وعلى أندرويد/آيفون/ويب/APK — الأنيميشن بـ translateX
//    ثابت الاتجاه مش متأثر باتجاه الواجهة (RTL/LTR). فى الوضع اليدوي بالسحب فقط.
//  * مفيش إعلانات ومفيش صورة دائمة (معطّلة) → المساحة كلها بتختفي.
type Slide = { kind: "banner"; banner: AdBanner } | { kind: "placeholder" };

// onPlaceholderPress: لو اتبعت (صفحة القائمة) تدخل صورة "ضع إعلانك هنا" الدائمة فى الدورة
// (لو الأدمن ما عطّلهاش). من غيره (صفحة البحث) بيعرض إعلانات الأدمن بس زي الأول.
export function AdBannerCarousel({ banners, onPlaceholderPress }: { banners: AdBanner[]; onPlaceholderPress?: () => void }) {
  const { data: settings } = useAdCarouselSettings();
  const isManual = settings?.rotationMode === "manual";
  const showPlaceholder = !!onPlaceholderPress && (settings?.showPlaceholder ?? true);
  const noop = () => {};

  const slides: Slide[] = [
    ...banners.map((banner): Slide => ({ kind: "banner", banner })),
    ...(showPlaceholder ? [{ kind: "placeholder" } as Slide] : []),
  ];
  if (slides.length === 0) return null;

  if (isManual) return <ManualCarousel slides={slides} onPlaceholderPress={onPlaceholderPress ?? noop} />;
  return <AutoCarousel slides={slides} durationMs={settings?.durationMs ?? 4000} onPlaceholderPress={onPlaceholderPress ?? noop} />;
}

// ↔ every tap that actually opens a link or WhatsApp chat counts as the
// person "contacting" that ad — logged into public.ad_contacts
// (20260815000000_support_center.sql) so the admin support center's
// "الإعلانات" tab can show which ads people engaged with.
function useOpenBanner() {
  const logContact = useLogAdContact();
  return (banner: AdBanner) => {
    if (!banner.linkUrl && !banner.whatsappMessage) return;
    logContact.mutate(banner);
    if (banner.linkUrl) Linking.openURL(banner.linkUrl).catch(() => showToast("تعذر فتح الرابط"));
    else if (banner.whatsappMessage) Linking.openURL(waLink(banner.whatsappMessage)).catch(() => showToast("تعذر فتح واتساب"));
  };
}

function SlideView({ slide, onPlaceholderPress }: { slide: Slide; onPlaceholderPress: () => void }) {
  const openBanner = useOpenBanner();
  if (slide.kind === "placeholder") {
    return (
      <View style={styles.fill}>
        <AdPlaceholder onPress={onPlaceholderPress} />
      </View>
    );
  }
  const banner = slide.banner;
  return (
    <Pressable onPress={() => openBanner(banner)} style={styles.bannerSlide} accessibilityRole="button" accessibilityLabel={banner.title}>
      <BannerImage url={banner.imageUrl} title={banner.title} />
    </Pressable>
  );
}

// ↔ صورة الإعلان بسلسلة محاولات (CascadeImage): لو تحميل أى رابط فشل بنجرّب اللى بعده بدل ما الصندوق يفضل
// أسود فاضى — وآخر حاجة خلفية بعنوان الإعلان.
function BannerImage({ url, title }: { url: string | null; title: string }) {
  return (
    <CascadeImage
      url={url}
      width={1200}
      style={StyleSheet.absoluteFill}
      fallback={
        <View style={[StyleSheet.absoluteFill, styles.fallbackBg, styles.fallbackCenter]}>
          <Text style={styles.fallbackTitle} numberOfLines={2}>{title}</Text>
        </View>
      }
    />
  );
}

function Dots({ count, index }: { count: number; index: number }) {
  if (count <= 1) return null;
  return (
    <View pointerEvents="none" style={styles.dots}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
      ))}
    </View>
  );
}

// ↔ تلقائي: الإعلان الحالي بيخرج لليمين والتالي بيدخل من الشمال (p: 0 → 1).
function AutoCarousel({ slides, durationMs, onPlaceholderPress }: { slides: Slide[]; durationMs: number; onPlaceholderPress: () => void }) {
  const n = slides.length;
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const [incoming, setIncoming] = useState<number | null>(null);
  const p = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  const safeIndex = index % n;

  useEffect(() => {
    if (n <= 1 || width <= 0) return;
    const timer = setInterval(() => {
      if (busy.current) return;
      busy.current = true;
      const next = (safeIndex + 1) % n;
      p.setValue(0);
      setIncoming(next);
      Animated.timing(p, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
        setIndex(next);
        setIncoming(null);
        p.setValue(0);
        busy.current = false;
        void finished;
      });
    }, Math.max(1500, durationMs));
    return () => clearInterval(timer);
  }, [n, width, safeIndex, durationMs, p]);

  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  const w = width || 1;

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Animated.View
        style={[StyleSheet.absoluteFill, incoming !== null && { transform: [{ translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, w] }) }] }]}
      >
        <SlideView slide={slides[safeIndex]} onPlaceholderPress={onPlaceholderPress} />
      </Animated.View>
      {incoming !== null && (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: p.interpolate({ inputRange: [0, 1], outputRange: [-w, 0] }) }] }]}>
          <SlideView slide={slides[incoming]} onPlaceholderPress={onPlaceholderPress} />
        </Animated.View>
      )}
      <Dots count={n} index={incoming ?? safeIndex} />
    </View>
  );
}

// ↔ rotation_mode = 'manual' — no timer at all, purely swipe-driven,
// paged horizontally like a standard carousel.
function ManualCarousel({ slides, onPlaceholderPress }: { slides: Slide[]; onPlaceholderPress: () => void }) {
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (width <= 0) return;
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <FlatList
          data={slides}
          keyExtractor={(s, i) => (s.kind === "banner" ? s.banner.id : `placeholder-${i}`)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={32}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          renderItem={({ item }) => (
            <View style={{ width, height: "100%" }}>
              <SlideView slide={item} onPlaceholderPress={onPlaceholderPress} />
            </View>
          )}
        />
      )}
      <Dots count={slides.length} index={index} />
    </View>
  );
}

const styles = StyleSheet.create({
  // ↔ الصندوق بنسبة ثابتة = نسبة صورة "ضع إعلانك هنا" (1400×620) بعرض الصفحة كله — فكل
  // الشرائح (إعلانات الأدمن + الصورة الدائمة) بنفس المقاس بالظبط على كل المنصات.
  wrap: { width: "100%", aspectRatio: AD_BANNER_ASPECT, overflow: "hidden" },
  fill: { flex: 1, justifyContent: "center" },
  bannerSlide: { flex: 1, borderRadius: 22, overflow: "hidden", backgroundColor: "#111827" },
  fallbackBg: { backgroundColor: "#312e81" },
  fallbackCenter: { alignItems: "center", justifyContent: "center", padding: 16 },
  fallbackTitle: { color: "white", fontWeight: "900", fontSize: 18, textAlign: "center" },
  dots: { position: "absolute", bottom: 8, alignSelf: "center", flexDirection: "row", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.55)", borderWidth: 0.5, borderColor: "rgba(0,0,0,0.25)" },
  dotActive: { backgroundColor: "white", width: 14 },
});
