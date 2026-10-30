import { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, Animated, Easing, Linking, FlatList, NativeSyntheticEvent, NativeScrollEvent, LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { AdBanner } from "../../lib/hooks/useAdBanners";
import { useAdCarouselSettings } from "../../lib/hooks/useAdCarouselSettings";
import { useLogAdContact } from "../../lib/hooks/useAdContacts";
import { waLink } from "../../lib/whatsapp";
import { AD_BANNER_ASPECT } from "../../lib/adBannerSpec";
import { showToast } from "../shared/Toast";
import { AdPlaceholder } from "./MenuCard";
import { CascadeImage } from "../shared/CascadeImage";
import { cldImageCandidates } from "../../lib/cloudinary";

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

function SlideView({ slide, onPlaceholderPress, onReady }: { slide: Slide; onPlaceholderPress: () => void; onReady?: () => void }) {
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
      <BannerImage url={banner.imageUrl} title={banner.title} onReady={onReady} />
    </Pressable>
  );
}

// ↔ صورة الإعلان بسلسلة محاولات (CascadeImage): لو تحميل أى رابط فشل بنجرّب اللى بعده بدل ما الصندوق يفضل
// أسود فاضى — وآخر حاجة خلفية بعنوان الإعلان.
function BannerImage({ url, title, onReady }: { url: string | null; title: string; onReady?: () => void }) {
  return (
    <CascadeImage
      url={url}
      width={1200}
      style={StyleSheet.absoluteFill}
      // ↔ transition=0: مفيش fade-in من الشفاف (كان بيبان كوميض أسود فوق خلفية الشريحة الغامقة).
      transition={0}
      onLoad={onReady}
      onAllFailed={onReady}
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

function slideKey(slide: Slide) {
  return slide.kind === "banner" ? slide.banner.id : "placeholder";
}

// ↔ تحميل مسبق لصور كل الإعلانات (الذاكرة + القرص) — الشريحة الجاية لازم تبقى جاهزة قبل ما تدخل.
function usePrefetchBanners(slides: Slide[]) {
  const key = slides.map((sl) => (sl.kind === "banner" ? `${sl.banner.id}:${sl.banner.imageUrl}` : "p")).join("|");
  useEffect(() => {
    const urls = slides
      .filter((sl): sl is Extract<Slide, { kind: "banner" }> => sl.kind === "banner" && !!sl.banner.imageUrl)
      .map((sl) => cldImageCandidates(sl.banner.imageUrl, 1200)[0])
      .filter(Boolean);
    if (urls.length) Image.prefetch(urls, "memory-disk").catch(() => {});
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ↔ تلقائي. إصلاح "شاشة سوداء بين إعلان وإعلان" — كان فيه سببين:
//   ١) الشريحة الجاية كانت بتتعمل mount لحظة بدء الانتقال (فصورتها لسه بتتحمّل → خلفية الشريحة الغامقة بتظهر)،
//      وبعد الانتقال كانت الشريحة الحالية بتتبدّل بنفس الـ View لمحتوى جديد فالصورة بتتحمّل من الأول تاني.
//   ٢) صورة بتظهر بـ fade من الشفاف فوق الخلفية الغامقة.
// الحل: *كل* الشرائح بتفضل معمولها mount طول الوقت (key ثابت لكل شريحة) ومتحمّلة مسبقًا، والانتقال مجرد تحريك
// translateX لموضع كل شريحة (-1 = برّه الشمال، 0 = ظاهرة، 1 = بتخرج يمين) بـ Animated.Value لكل واحدة —
// فمفيش mount/unmount ولا إعادة تحميل ولا تبديل style وقت الانتقال. ومبننتقلش لشريحة صورتها لسه ماتحمّلتش
// (بنستنى لحد ما تجهز). الاتجاه ثابت ناحية اليمين (الصورة الجاية بتدخل من الشمال).
function AutoCarousel({ slides, durationMs, onPlaceholderPress }: { slides: Slide[]; durationMs: number; onPlaceholderPress: () => void }) {
  const n = slides.length;
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const widthAnim = useRef(new Animated.Value(0)).current;
  const positions = useRef<Animated.Value[]>([]).current;
  const busy = useRef(false);
  const readyRef = useRef<Set<string>>(new Set());
  const keys = slides.map(slideKey).join("|");
  const safeIndex = index % n;

  usePrefetchBanners(slides);

  // مواضع الشرائح: الحالية 0، والباقى -1 (برّه الشمال، مقصوصة بـ overflow hidden).
  // الشريحة الحالية تبدأ على 0 من أول render (مفيش لحظة فاضية قبل ما الـ effect يشتغل)
  while (positions.length < n) positions.push(new Animated.Value(positions.length === safeIndex ? 0 : -1));
  useEffect(() => {
    busy.current = false;
    positions.forEach((pv, i) => pv.setValue(i === safeIndex ? 0 : -1));
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (n <= 1 || width <= 0) return;
    const isReady = (j: number) => slides[j].kind === "placeholder" || readyRef.current.has(slideKey(slides[j]));
    const timer = setInterval(() => {
      if (busy.current) return;
      // أقرب شريحة جاية (بالترتيب) جاهزة صورتها
      let next = -1;
      for (let step = 1; step < n; step++) {
        const j = (safeIndex + step) % n;
        if (isReady(j)) { next = j; break; }
      }
      if (next < 0) return;
      busy.current = true;
      positions[next].setValue(-1);
      Animated.parallel([
        Animated.timing(positions[safeIndex], { toValue: 1, duration: 520, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.timing(positions[next], { toValue: 0, duration: 520, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ]).start(() => {
        positions[safeIndex].setValue(-1);
        setIndex(next);
        busy.current = false;
      });
    }, Math.max(1500, durationMs));
    return () => clearInterval(timer);
  }, [n, keys, width, safeIndex, durationMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth(w);
    widthAnim.setValue(w);
  }, [widthAnim]);

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {slides.map((slide, i) => (
        <Animated.View
          key={slideKey(slide)}
          style={[
            StyleSheet.absoluteFill,
            // قبل أول قياس للعرض كل المواضع = 0 (الشرائح فوق بعض) فنخفى غير الحالية لحد ما العرض يتقاس.
            { opacity: width > 0 || i === safeIndex ? 1 : 0, pointerEvents: i === safeIndex ? "auto" : "none" },
            { transform: [{ translateX: Animated.multiply(positions[i], widthAnim) }] },
          ]}
        >
          <SlideView slide={slide} onPlaceholderPress={onPlaceholderPress} onReady={() => { readyRef.current.add(slideKey(slide)); }} />
        </Animated.View>
      ))}
      <Dots count={n} index={safeIndex} />
    </View>
  );
}

// ↔ rotation_mode = 'manual' — no timer at all, purely swipe-driven,
// paged horizontally like a standard carousel.
function ManualCarousel({ slides, onPlaceholderPress }: { slides: Slide[]; onPlaceholderPress: () => void }) {
  usePrefetchBanners(slides);
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
          // ↔ كل الشرائح mounted دايمًا (عددها قليل) فمفيش تحميل/وميض عند السحب ليها.
          initialNumToRender={slides.length}
          windowSize={slides.length + 1}
          removeClippedSubviews={false}
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
