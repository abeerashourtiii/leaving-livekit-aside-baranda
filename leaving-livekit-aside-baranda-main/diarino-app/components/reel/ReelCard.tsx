import { useCallback, useEffect, useRef, useState, memo, useMemo } from "react";
import { useIsFocused } from "@react-navigation/native";
import { usePiPActive } from "../../lib/pipState";
import { recordPropertyView } from "../../lib/hooks/usePropertyViews";
import { View, Text, Pressable, StyleSheet, Animated, Easing, ScrollView, BackHandler, PanResponder, PanResponderGestureState } from "react-native";
import { Image } from "expo-image";
import type { ImageLoadEventData } from "expo-image";
import Svg, { Path } from "react-native-svg";
import { Property, getReelMode } from "../../lib/types";
import { ReelBackground } from "./ReelBackground";
import { ReelInfoOverlay } from "./ReelInfoOverlay";
import { ReelActionRail } from "./ReelActionRail";
import { ReelSeekBar } from "./ReelSeekBar";
import { ReelVideoPlayer, ReelVideoPlayerHandle } from "./ReelVideoPlayer";
import { startReelMusic, stopReelMusic, setReelMusicMuted, restartReelMusic, seekReelMusic } from "../../lib/musicPlayer";
import { useMusicLibrary } from "../../lib/musicLibrary";
import { cldOptimized, cldReelPoster } from "../../lib/cloudinary";
import { PropertyDetailsContent } from "../property/PropertyDetailsContent";
import { PropertyCtaBar } from "../property/PropertyCtaBar";
import { ReelCaptionsOverlay } from "./ReelCaptionsOverlay";
import { ReelCommentsPanel } from "./ReelCommentsPanel";
import { useKeyboardState } from "../../lib/hooks/useKeyboardState";
import { setReelSheetLocked } from "../../lib/reelSheetLock";
import { useReelHeight, useReelControlsBottomOffset } from "../../lib/uiConstants";
import { useReelPreferences } from "../../lib/hooks/useReelPreferences";
import { useThemeColors } from "../../lib/hooks/useThemeColors";
import { usePublicProfile } from "../../lib/hooks/usePublicProfile";
import { physicalSide } from "../../lib/rtl";

// ↔ نسبة عرض/ارتفاع كل فيديو (تُقرأ من صورة البوستر عند أول تحميل) — بتتخزّن هنا عشان رجوعك لنفس الريل
// أو إعادة بناء الكارت ما تعيدش حساب الوضع (من غير قفزة فى الشكل).
const VIDEO_ASPECT_CACHE = new Map<string, number>();

// ↔ مستوى صوت موسيقى الإعلان لما بتصاحب فيديو (عشان صوت الفيديو الأصلى يفضل مسموع).
const VIDEO_MUSIC_VOLUME = 0.35;
const BASE_SLIDE_MS = 4000; // ↔ currentReelSpeed default in app-viewer.html
// ↔ زرار إغلاق لوحة التفاصيل مثبَّت فعليًا فى أعلى يسار الشاشة (بطلب
// صريح)، بغض النظر عن لغة الواجهة — نفس أسلوب physicalSide()/
// ReelActionRail: حساب أنهي خاصية حرفية (left/right) لازم نكتبها عشان
// النتيجة النهائية، بعد قلب Yoga التلقائي المحتمل على الموبايل، تفضل
// شمال دايمًا وثابت على كل المنصات.
const CLOSE_BTN_SIDE_STYLE = physicalSide(true) === "left" ? { left: 14 } : { right: 14 };
const LONG_PRESS_MS = 500; // ↔ setTimeout(..., 500) in startLongPress()

// ↔ #1/#3: ارتفاع الريل بعد ما يتصغّر لفوق وقت فتح لوحة التفاصيل — نفس
// فكرة الـ mini-player بتاع الـ Shorts فى يوتيوب لما تفتح الكومنتات.
const MINI_MEDIA_HEIGHT = 220;
// ↔ لما لوحة المفاتيح تفتح (كتابة تعليق) الريل المصغّر بيصغر أكتر عشان تفضل مساحة تكفى للتعليقات فوق الكيبورد.
const COMPACT_MEDIA_HEIGHT = 120;
const SHEET_ANIM_MS = 280;

type Props = {
  property: Property;
  index: number;
  isActive: boolean; // this reel is the one currently in view (drives autoplay)
  // ↔ perf audit fix #1: index === activeIndex ± 1. Real <Video>/audio
  // playback only ever needs to exist for isActive; isNearActive exists
  // solely to decide whether a *video-mode* card mounts a real <Video>
  // player at all (vs. a static poster) — so the adjacent card is ready
  // to play instantly the moment a swipe lands on it, without every
  // other mounted card in the FlatList's window also paying for a live
  // decoder it will never use.
  isNearActive: boolean;
  isFollowing: boolean;
  isFavorite: boolean;
  isLiked: boolean;
  isComparing: boolean;
  // ↔ #2/#3: تفاصيل العقار بقت لوحة (bottom sheet) تفتح جوه شاشة الريلز
  // نفسها بدل ما تعمل navigation لصفحة تانية — عشان الريل يفضل شغال
  // ومسموع أثناء عرضها (نفس اليوتيوب شورتس). detailsOpen بييجي من الشاشة
  // الأب (فيه بس للكارت النشط فعليًا)، وonCloseDetails بيقفلها.
  detailsOpen: boolean;
  onCloseDetails: () => void;
  // ↔ perf audit fix #2: id/property-parameterized instead of pre-bound
  // no-arg closures. This is what lets the parent (app/(tabs)/index.tsx)
  // hand every card the exact same useCallback-memoized function
  // reference, which is required for React.memo below to actually skip
  // re-rendering cards whose own data hasn't changed.
  onOpenDetails: (propertyId: string) => void;
  onOpenSeller: (sellerId: string) => void;
  onToggleFollow: (sellerId: string) => void;
  onToggleFavorite: (propertyId: string) => void;
  onToggleLike: (propertyId: string) => void;
  onShare: (property: Property) => void;
  onToggleCompare: (propertyId: string) => void;
  onReport?: (property: Property) => void;
  // ↔ #4 (قايمة خيارات الريل — تمرير تلقائي): بينادَى لما الريل النشط
  // يخلص (فيديو وصل للنهاية، أو السلايدشو خلّص دورة كاملة) وautoAdvance
  // مفعّل — الشاشة الأب (app/(tabs)/index.tsx) هي اللي بتقرر تتنقل لأي
  // ريل (السحب للريل اللي بعده)، نفس فكرة onOpenDetails/onOpenSeller.
  onFinished?: () => void;
  // ↔ فتح لوحة التعليقات مباشرة عند أول عرض (من إشعار تعليق/رد: ?comments=1).
  initialCommentsOpen?: boolean;
};

export const ReelCard = memo(function ReelCard({
  property, index, isActive, isNearActive, isFollowing, isFavorite, isLiked, isComparing,
  detailsOpen, onCloseDetails,
  onOpenDetails, onOpenSeller, onToggleFollow, onToggleFavorite, onToggleLike, onShare, onToggleCompare, onReport,
  onFinished, initialCommentsOpen = false,
}: Props) {
  const reelHeight = useReelHeight();
  // ↔ #1/#2: الكارت بقى fullscreen كامل (useReelHeight بترجع ارتفاع الشاشة
  // بالكامل دلوقتي)، فلوحة التفاصيل (bottom sheet) لازم تاخد باله من مساحة
  // شريط المهام العائم فى آخرها بدل ما محتواها (PropertyCtaBar تحديدًا)
  // يوصل لآخر حافة فى الشاشة ويتغطّى بيه.
  const controlsBottomOffset = useReelControlsBottomOffset();
  const mode = getReelMode(property);
  const videoRef = useRef<ReelVideoPlayerHandle>(null);
  // ↔ #4 (قايمة خيارات الريل): تمرير تلقائي/كتم صوت الخلفية مُتحكَّم فيهم
  // من هنا — نفس المخزن اللي ReelOptionsSheet.tsx بيقرا ويكتب فيه.
  const { autoAdvance, musicMuted } = useReelPreferences();
  // ↔ قاعدة تثيم الوسائط: لوحة تفاصيل العقار (sheet تحت) بخلفية عتمة
  // كاملة خاصة بيها، مش مرسومة على الفيديو — فتتبع الثيم. باقي ستايلات
  // الملف ده (الأيقونات/فلاش التشغيل/شريط الـ seek..) فضلت ثابتة عمدًا.
  const themeColors = useThemeColors();

  // ↔ toggleReelPause() — tap top/bottom half of the reel to pause/resume.
  const [paused, setPaused] = useState(false);
  // ↔ أثناء سحب كرة الـ seek الريل بيتوقف مؤقتًا (سحب سلس)، وعند الإفلات بيستأنف من نقطة الإفلات
  //   (حتى لو كان المستخدم موقفه قبل كده). holdPaused = الإيقاف الفعلي (يدوي أو أثناء السحب).
  const [scrubbing, setScrubbing] = useState(false);
  const holdPaused = paused || scrubbing;

  // ↔ استئناف تلقائى عند الرجوع: لو المستخدم وقّف الريل (باللمس) ثم انتقل لريل تانى (قبله أو بعده) ورجع له، الريل يكمّل من نفس النقطة
  // من غير ما يضغط على الشاشة. بنصفّر الإيقاف اليدوى لحظة ما الريل يخرج من كونه النشط *وهو الشاشة لسه فى التركيز* (يعنى بسبب التنقل
  // بين الريلز)؛ لو خرج لأن صفحة تانية اتفتحت فوقه (المعلن، التعليقات...) نسيب الإيقاف زى ما هو.
  const screenFocused = useIsFocused();
  const wasActiveRef = useRef(isActive);
  useEffect(() => {
    if (wasActiveRef.current && !isActive && screenFocused) {
      setPaused(false);
      setScrubbing(false);
    }
    wasActiveRef.current = isActive;
  }, [isActive, screenFocused]);
  // ↔ إصلاح باغ #2: حالة الأيقونة اللي بتفلاش عند كل تبديل (تشغيل/إيقاف)
  // — مستقلة عن `paused` نفسها، عشان تفضل تظهر لحظة الضغط حتى لو
  // `paused` اتغيّرت فورًا بعدها.
  const [tapFeedback, setTapFeedback] = useState<"play" | "pause" | null>(null);
  const tapFeedbackOpacity = useRef(new Animated.Value(0)).current;

  // ↔ isLongPressing / currentReelSpeed — long-press anywhere (not on a
  // button or the seek bar) doubles playback speed while held.
  const [speed, setSpeed] = useState<1 | 2>(1);

  // ---- video state ----
  const [videoPosMs, setVideoPosMs] = useState(0);
  const [videoDurMs, setVideoDurMs] = useState(0);
  const video = mode === "video" ? property.media.find((m) => m.type === "video") : undefined;

  // ↔ سرعة التنقل: الـ VideoView الأصلية بتبقى سودا لحد ما أول إطار
  // يتعرض. فبنحط صورة البوستر (أول إطار، خفيفة ومتحمّلة مسبقًا) فوق
  // الفيديو، وبنشيلها أول ما الفيديو يشتغل فعليًا (playingChange) — فالريل
  // بيظهر فورًا بدل شاشة سودا. لو الكارت خرج من النطاق القريب (الـ player
  // اتشال) البوستر بيرجع تاني عشان الدورة الجاية.
  const [videoStarted, setVideoStarted] = useState(false);

  // ↔ الفيديو الطولى (portrait) كان بيتعرض متوسَّط (contain) فى ارتفاع الشاشة كلها، فيطلع شريط أسود فاضى
  // فوقه (تحت الأزرار العلوية) وتحته. الآن بنثبّته من أعلى الشاشة بنسبته الأصلية بالظبط (من غير قص ولا
  // ضغط): الأزرار العلوية (إشعارات/فلتر/✕) عائمة فوق الريل نفسه، والمساحة الفاضية (لو فى) بتروح لأسفل
  // ورا شريط الـ seek وشريط المهام. النسبة بنحسبها من صورة بوستر الفيديو (نفس نسبة الفيديو).
  // ↔ صورة/اسم البائع على أيقونة البروفايل (+ متابعة): من نفس مصدر صفحة المعلن (profiles_public عبر
  // usePublicProfile) بدل النسخة المضمّنة جوه بيانات العقار، اللى كانت بتفضل قديمة/فاضية وبتظهر الحرف الأول بس
  // (مثلًا بعد رفع الصورة من «إدارة الحساب»). الكاش بيتحدّث لحظيًا بعد حفظ البروفايل (useProfile → publicProfile).
  const { data: sellerProfile } = usePublicProfile(property.seller.id, isNearActive);
  const seller = useMemo(() => {
    if (!sellerProfile) return property.seller;
    const name = sellerProfile.name || property.seller.name;
    return {
      ...property.seller,
      name,
      initial: name.charAt(0) || property.seller.initial,
      verified: sellerProfile.verified,
      avatarUrl: sellerProfile.avatarUrl ?? property.seller.avatarUrl ?? null,
    };
  }, [sellerProfile, property.seller]);

  const [cardW, setCardW] = useState(0);
  const [videoAspect, setVideoAspect] = useState<number | null>(() => (video ? VIDEO_ASPECT_CACHE.get(video.url) ?? null : null));
  const [aspectTimedOut, setAspectTimedOut] = useState(false);
  useEffect(() => {
    if (!video || videoAspect != null) return;
    // ↔ إصلاح «تأخير ظهور الريل أثناء التصفح»: صندوق الفيديو كان مخفى (opacity 0) لحد ما بوستر الريل يتحمّل ليعرف نسبة الأبعاد،
    // وتوليد البوستر من Cloudinary ممكن ياخد ثانية أو أكتر — فكانت الشاشة تفضل سودا حتى لو الفيديو جاهز. دلوقتي ننتظر 250ms فقط
    // (والفيديو نفسه بيظهر فورًا أول ما يبدأ التشغيل)، ونعرض الريل بالنسبة الافتراضية لحد ما النسبة الحقيقية توصل.
    const timeout = setTimeout(() => setAspectTimedOut(true), 250);
    return () => clearTimeout(timeout);
  }, [video, videoAspect]);
  const handlePosterLoad = (e: ImageLoadEventData) => {
    const w = e?.source?.width;
    const h = e?.source?.height;
    if (!video || !w || !h) return;
    const aspect = w / h;
    VIDEO_ASPECT_CACHE.set(video.url, aspect);
    setVideoAspect(aspect);
  };
  useEffect(() => {
    if (!isNearActive) setVideoStarted(false);
  }, [isNearActive]);

  // ↔ تركيب player الفيديو بالتدريج: الريل النشط بيتركّب له player فورًا، أما الجيران (±3) فبيتأخروا شوية ومتفاوتين
  // (حسب index) — عشان فتح التطبيق/القفز لريل بعيد ما يعملش 7 players مرة واحدة (ضغط على الـ decoders وتقطيع). الجار اللى
  // بيبقى هو النشط قبل انتهاء المهلة بيتركّب فورًا. خارج النافذة (isNearActive=false) الـ player بيتفك تمامًا.
  // ↔ احتساب مشاهدة للأدمن (إجمالي المشاهدات): الريل لازم يفضل نشط ~2.5 ثانية (مش مجرد عبور سريع)، ومرة لكل مستخدم/يوم.
  useEffect(() => {
    if (!isActive) return;
    const t = setTimeout(() => recordPropertyView(property.id), 2500);
    return () => clearTimeout(t);
  }, [isActive, property.id]);

  // ↔ فى وضع الصورة العائمة (PiP) بيتعرض الريل بس: بنخفى معلومات الإعلان والأزرار وشريط التقدم وأزرار الإجراءات.
  const pipUi = usePiPActive();
  const [playerMounted, setPlayerMounted] = useState(false);
  useEffect(() => {
    if (!isNearActive) { setPlayerMounted(false); return; }
    if (isActive) { setPlayerMounted(true); return; }
    const id = setTimeout(() => setPlayerMounted(true), 250 + (index % 4) * 150);
    return () => clearTimeout(id);
  }, [isNearActive, isActive, index]);

  // ↔ ترقية expo-av → expo-video: ReelVideoPlayer (تحت) بقى هو المسؤول
  // عن تشغيل/إيقاف/سرعة/كتم الفيديو داخليًا (بيقرا الـ props دي مباشرة)
  // — الـ effect القديم اللي كان بينده setStatusAsync يدويًا اتشال، لأن
  // expo-video بيدير الحالة دي من جوّه العنصر نفسه رد فعل على الـ props.
  // finishedRef/إعادة الموضع لصفر بعد didJustFinish بقت جوه
  // ReelVideoPlayer.tsx نفسه (نفس المنطق، مكانه اتغيّر بس).

  // ↔ موضع الفيديو الحالى (ثوانى) + آخر موضع — لمزامنة الموسيقى: لما الفيديو يلف من الأول (loop) الموسيقى ترجع
  // لأولها (فمدتها بتتضبط على مدة الفيديو: تتكرر لو أقصر وتتقطع لو أطول).
  const videoSecRef = useRef(0);
  const slideSecRef = useRef(0);
  function onVideoPosition(currentSec: number, durationSec: number) {
    if (currentSec < videoSecRef.current - 1) restartReelMusic();
    videoSecRef.current = currentSec;
    setVideoPosMs(currentSec * 1000);
    setVideoDurMs(durationSec * 1000);
  }

  function onVideoFinished() {
    onFinished?.();
  }

  function seekVideo(pct: number) {
    // ↔ نضبط الموضع ونشغّل فورًا من نقطة الإفلات، وبعدها نشيل حالة الإيقاف.
    videoRef.current?.seekToPct(pct);
    seekReelMusic(pct * (videoDurMs / 1000));
    setPaused(false);
    setScrubbing(false);
  }

  // ---- slideshow state ↔ startSlideshow()/updateSlideshowSeek() ----
  const images = mode === "slideshow" ? property.media.filter((m) => m.type === "image") : [];
  const [slideIdx, setSlideIdx] = useState(0);
  const [slideElapsedMs, setSlideElapsedMs] = useState(0);
  const slideTotalMs = images.length * BASE_SLIDE_MS;
  slideSecRef.current = slideElapsedMs / 1000;

  useEffect(() => {
    if (mode !== "slideshow" || images.length < 2 || !isActive || holdPaused) return;
    const tickMs = 100;
    const interval = BASE_SLIDE_MS / speed;
    const id = setInterval(() => {
      setSlideElapsedMs((prev) => {
        const next = (prev + tickMs * speed) % (interval * images.length);
        // ↔ #4 (تمرير تلقائي): الـ % فوق بيخلي next يلف لصفر تانى كل ما
        // يوصل لآخر الدورة — لو next أصغر من prev كده يبقى فعلاً لف
        // (خلّص دورة كاملة)، فده اللحظة المناسبة لتفعيل onFinished لو
        // autoAdvance شغال.
        if (next < prev) restartReelMusic();
        if (next < prev && autoAdvance) onFinished?.();
        setSlideIdx(Math.floor(next / interval) % images.length);
        return next;
      });
    }, tickMs);
    return () => clearInterval(id);
  }, [mode, images.length, isActive, holdPaused, speed, autoAdvance, onFinished]);

  // ↔ تحميل مسبق لكل صور العرض التتابعى (حتى ١٥) أول ما الريل يقرب يبقى نشط، عشان التنقل بين الصور من غير وميض/تأخير.
  const imagesKey = images.map((m) => m.url).join("|");
  useEffect(() => {
    if (mode !== "slideshow" || images.length < 2 || !isNearActive) return;
    try {
      const r = Image.prefetch(images.map((m) => cldOptimized(m.url))) as Promise<boolean> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* best-effort */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, imagesKey, isNearActive]);

  function seekSlideshow(pct: number) {
    const total = BASE_SLIDE_MS * images.length;
    const elapsed = pct * total;
    setSlideElapsedMs(elapsed);
    seekReelMusic(elapsed / 1000);
    setSlideIdx(Math.min(images.length - 1, Math.floor(elapsed / BASE_SLIDE_MS)));
    setPaused(false);
    setScrubbing(false);
  }

  // ↔ maybePlayReelMusicFor() — only plays when there's no video (mode
  // 'none' or 'slideshow') and the property has a `music` track set, and
  // stops the moment this reel isn't the active/playing one, same as the
  // pause-tied start/stop in the original's toggleReelPause().
  // ↔ موسيقى الإعلان بتشتغل مع الفيديو كمان (بصوت أخفض من صوته) وتتزامن معه، ومع العرض التتابعى للصور. المكتبة
  // (Cloudinary) لازم تكون اتحمّلت قبل البدء عشان المقطع المختار يتحل صح (ما نبدأش بمقطع افتراضى بالغلط).
  const { tracks: musicTracks, isLoading: musicLibLoading } = useMusicLibrary();
  const musicLibKey = musicTracks.map((tr) => `${tr.title}|${tr.url ?? ""}`).join(",");
  useEffect(() => {
    const ready = (mode !== "video" || videoStarted) && !musicLibLoading;
    const shouldPlay = !!property.music && ready && isActive && !holdPaused;
    if (shouldPlay) {
      startReelMusic(property.id, property.music, {
        volume: mode === "video" ? VIDEO_MUSIC_VOLUME : 1,
        positionSec: mode === "video" ? videoSecRef.current : slideSecRef.current,
      });
      // ↔ #4 (كتم صوت الخلفية): بيحدّث مستوى صوت الموسيقى الشغالة فورًا
      // مع أي تغيير فى musicMuted، من غير ما يوقف ويشغّل الموسيقى تانى.
      setReelMusicMuted(musicMuted);
    } else {
      stopReelMusic();
    }
    return () => {
      stopReelMusic();
    };
  }, [mode, property.music, property.id, isActive, holdPaused, musicMuted, videoStarted, musicLibLoading, musicLibKey]);

  function togglePause() {
    setPaused((prev) => {
      const next = !prev;
      // ↔ إصلاح باغ #2: أيقونة تشغيل/إيقاف واضحة بتظهر لمدة قصيرة عند كل
      // تبديل (سواء وقف أو شغّل) وبعدين تختفي تدريجيًا — بدل ما كانت
      // أيقونة الإيقاف بس هي اللي بتفضل ظاهرة طول ما الفيديو واقف.
      setTapFeedback(next ? "pause" : "play");
      tapFeedbackOpacity.stopAnimation();
      tapFeedbackOpacity.setValue(1);
      Animated.timing(tapFeedbackOpacity, {
        toValue: 0, duration: 300, delay: 450, easing: Easing.out(Easing.ease), useNativeDriver: true,
      }).start();
      return next;
    });
  }

  // ---- #1/#2/#3: لوحة تفاصيل العقار المصغّرة ----
  // ↔ detailsMounted يفضل true أثناء أنيميشن الإغلاق كمان (مش بس وهي
  // مفتوحة) عشان اللوحة تتحرك للأسفل وتختفي بالتدريج بدل ما تختفي فجأة،
  // وبعدين يتشال المكوّن فعليًا لما الأنيميشن يخلص (مفيش استعلامات شغالة
  // فى الخلفية من غير داعٍ وهي مقفولة).
  // ↔ التعليقات (طلب المستخدم): نفس اللوحة السفلية بتتفتح بمحتوى التعليقات بدل التفاصيل — الريل بيتصغّر فوق وبيفضل شغّال.
  // detailsMounted/sheetAnim بقوا يخدموا اللوحتين (تفاصيل أو تعليقات)؛ sheetKind بيحدد المحتوى المعروض (ويفضل ثابت أثناء أنيميشن الإغلاق).
  const [commentsOpen, setCommentsOpen] = useState(initialCommentsOpen);
  const [sheetKind, setSheetKind] = useState<"details" | "comments">(initialCommentsOpen ? "comments" : "details");
  const panelOpen = detailsOpen || commentsOpen;
  const kb = useKeyboardState();
  const [detailsMounted, setDetailsMounted] = useState(false);
  const sheetAnim = useRef(new Animated.Value(0)).current;
  // ↔ انسيابية سحب لوحة التعليقات/التفاصيل لأسفل: حركة اللوحة نفسها (فتح/إغلاق + السحب بالإصبع) على transform بالـ native driver
  // (openProg للفتح/الإغلاق، dragY للسحب) — مفيش layout ولا JS لكل فريم. sheetAnim (JS) بس للمينى-بلاير/الشفافية. قبل كده السحب كان
  // بيحرّك sheetAnim فكل فريم بيعمل إعادة layout لارتفاع الميديا فكانت الحركة «بتقف» وإنت بتسحب.
  const openProg = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  // فتح التفاصيل بيقفل التعليقات (لوحة واحدة فى المرة).
  useEffect(() => {
    if (detailsOpen) {
      setSheetKind("details");
      setCommentsOpen(false);
    }
  }, [detailsOpen]);

  // الكارت اللى مبقاش نشط بيقفل تعليقاته؛ والتعليقات المفتوحة بتقفل سحب قائمة الريلز الرأسية.
  useEffect(() => {
    if (!isActive && commentsOpen) setCommentsOpen(false);
  }, [isActive, commentsOpen]);
  useEffect(() => {
    if (!commentsOpen || !isActive) return;
    setReelSheetLocked(true);
    return () => setReelSheetLocked(false);
  }, [commentsOpen, isActive]);

  const contentScrollY = useRef(0);
  const openComments = useCallback(() => {
    if (detailsOpen) onCloseDetails();
    contentScrollY.current = 0;
    setSheetKind("comments");
    setCommentsOpen(true);
  }, [detailsOpen, onCloseDetails]);
  const closeSheet = useCallback(() => {
    if (commentsOpen) setCommentsOpen(false);
    else onCloseDetails();
  }, [commentsOpen, onCloseDetails]);
  // ↔ الـ PanResponder (تحت) بيتبني مرة واحدة، فبيقرا أحدث closeSheet/sheetHeight من refs.
  const closeSheetRef = useRef(closeSheet);
  closeSheetRef.current = closeSheet;

  useEffect(() => {
    if (panelOpen) {
      setDetailsMounted(true);
      dragY.setValue(0);
      contentScrollY.current = 0; // ↔ ScrollView جديدة فى القمة — موضع السكرول القديم كان بيمنع السحب بعد إعادة الفتح
      Animated.timing(openProg, {
        toValue: 1, duration: SHEET_ANIM_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
      Animated.timing(sheetAnim, {
        toValue: 1, duration: SHEET_ANIM_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(openProg, {
        toValue: 0, duration: SHEET_ANIM_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true,
      }).start();
      Animated.timing(sheetAnim, {
        toValue: 0, duration: SHEET_ANIM_MS, easing: Easing.in(Easing.cubic), useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) { setDetailsMounted(false); dragY.setValue(0); }
      });
    }
  }, [panelOpen, sheetAnim, openProg, dragY]);

  // ↔ زرار الرجوع فى أندرويد وهو فاتح اللوحة يقفلها بدل ما يسيب شاشة
  // الريلز بالكامل — متوقّع من أي "sheet" بيتفتح فوق شاشة قائمة.
  useEffect(() => {
    if (!isActive) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (panelOpen) {
        closeSheetRef.current();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [isActive, panelOpen]);

  // ↔ أثناء كتابة تعليق: الريل أصغر، ومفيش فراغ سفلى لشريط المهام (الكيبورد فوقه)، وعلى آيفون اللوحة بتقف فوق الكيبورد مباشرة.
  const typing = sheetKind === "comments" && kb.visible;
  const miniH = typing ? COMPACT_MEDIA_HEIGHT : MINI_MEDIA_HEIGHT;
  const bottomGap = typing ? 0 : controlsBottomOffset;
  const mediaHeight = sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [reelHeight, miniH] });
  const sheetHeight = Math.max(reelHeight - miniH - bottomGap - (sheetKind === "comments" ? kb.inset : 0), 0);
  const sheetHeightRef = useRef(sheetHeight);
  sheetHeightRef.current = sheetHeight;
  const sheetTranslateY = Animated.add(openProg.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight, 0] }), dragY);
  const mediaOverlayOpacity = sheetAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 0, 0] });
  const miniHandleOpacity = sheetAnim;

  // ↔ ارتفاع صندوق الفيديو: فى الوضع العادى = ارتفاع الفيديو الطبيعى بعرض الكارت (أو ارتفاع الشاشة لو أقل)،
  // ومع فتح لوحة التفاصيل بيتقلّص مع mediaHeight لحد المينى-بلاير. الفيديو العريض (landscape) أو اللى
  // نسبته لسه مجهولة بيفضل زى ما كان (متوسَّط contain).
  const naturalVideoH = videoAspect != null && videoAspect < 1 && cardW > 0 ? Math.min(reelHeight, cardW / videoAspect) : null;
  const videoBoxHeight = naturalVideoH != null && naturalVideoH > miniH
    ? mediaHeight.interpolate({ inputRange: [miniH, reelHeight], outputRange: [miniH, naturalVideoH], extrapolate: "clamp" })
    : mediaHeight;
  const videoBoxReady = videoAspect != null || aspectTimedOut || videoStarted;

  // ↔ #2 (صفحة تفاصيل العقار): سحب اللوحة لأسفل لازم يقفلها ويرجّع الريل
  // fullscreen كامل تانى (الوصف/الكماليات والمرافق/المخطط تختفي، بالظبط
  // زي الضغط على زرار الإغلاق). السحب هنا معلّق على شريط المسكة
  // (sheetGrabRow) بس، مش على المحتوى كله، عشان اسكرول التفاصيل يفضل
  // شغال طبيعي من غير ما يتعارض مع جيستشر السحب.
  const claimDy = useRef(0);
  // ↔ إصلاح «زرار إغلاق لوحة التفاصيل مش شغّال»: onStartShouldSetPanResponder بترجع false (الضغطة العادية تعدّى للزرار)،
  // والسحب بيتمسك بس لما يبقى فيه حركة فعلية لأسفل.
  function handleSheetDragGrant(_evt: unknown, gesture: PanResponderGestureState) {
    dragY.stopAnimation();
    claimDy.current = gesture.dy; // الإزاحة اللى حصلت قبل ما نمسك اللمسة (سكرول لقمة المحتوى) ما تتحسبش — مفيش قفزة
  }
  function handleSheetDragMove(_evt: unknown, gesture: PanResponderGestureState) {
    if (sheetHeightRef.current <= 0) return;
    dragY.setValue(Math.max(0, gesture.dy - claimDy.current));
  }
  function handleSheetDragRelease(_evt: unknown, gesture: PanResponderGestureState) {
    const d = Math.max(0, gesture.dy - claimDy.current);
    const shouldClose = d > sheetHeightRef.current * 0.25 || (gesture.vy > 0.8 && d > 20);
    if (shouldClose) {
      // اللوحة بتكمّل نزولها من مكانها الحالى (dragY + حركة الإغلاق) من غير قفزة، والريل بيرجع fullscreen.
      closeSheetRef.current();
    } else {
      Animated.spring(dragY, { toValue: 0, bounciness: 0, speed: 16, useNativeDriver: true }).start();
    }
  }
  function handleSheetDragTerminate() {
    Animated.spring(dragY, { toValue: 0, bounciness: 0, speed: 16, useNativeDriver: true }).start();
  }

  const sheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 4 && gesture.dy > 0,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: handleSheetDragGrant,
      onPanResponderMove: handleSheetDragMove,
      onPanResponderRelease: handleSheetDragRelease,
      onPanResponderTerminate: handleSheetDragTerminate,
    })
  ).current;

  // ↔ طلب "قفل اللوحة بالسحب لأسفل من فوق المحتوى نفسه، مش بس من شريط
  // المسكة": بنتتبّع موضع تمرير محتوى الوصف (contentScrollY)، وبنستخدم
  // onMoveShouldSetPanResponderCapture (مرحلة "capture"، بتتنفّذ قبل ما
  // الـ ScrollView الأصلية تاخد اللمسة لنفسها) عشان نتحكّم بس لما يكونوا
  // الشرطين الاتنين متحققين مع بعض: (1) المستخدم واصل لقمة المحتوى فعليًا
  // (contentScrollY <= 0)، و(2) بيسحب لأسفل فعلًا (مش بيمرر لفوق أو
  // بيلمس بس). فى أي حالة تانية (لسه بيمرّر جوه المحتوى، أو بيدوس على
  // زرار/رابط جوه الوصف) بترجع false فورًا، فالـ ScrollView والعناصر
  // اللي جواها تفضل شغالة عادي 100% من غير أي تعارض.
  const contentPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
        contentScrollY.current <= 0 && gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: handleSheetDragGrant,
      onPanResponderMove: handleSheetDragMove,
      onPanResponderRelease: handleSheetDragRelease,
      onPanResponderTerminate: handleSheetDragTerminate,
    })
  ).current;

  return (
    <View style={{ height: reelHeight, backgroundColor: "#000" }}>
      <Animated.View style={{ height: mediaHeight, width: "100%", overflow: "hidden", backgroundColor: "#000" }} onLayout={(e) => setCardW(e.nativeEvent.layout.width)}>
        {mode === "video" && video ? (
          <>
            {/* ↔ مجسّ نسبة الفيديو: صورة بوستر مخفية (1×1) لحد ما النسبة تتعرف — بيشتغل حتى لو الفيديو
                بدأ يشتغل قبل ما بوستر الواجهة يتحمّل. */}
            {videoAspect == null && (
              <View style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} pointerEvents="none">
                <Image source={{ uri: cldReelPoster(video.url) }} style={{ width: 1, height: 1 }} onLoad={handlePosterLoad} />
              </View>
            )}
            <Animated.View
              style={{ position: "absolute", top: 0, left: 0, right: 0, height: videoBoxHeight, overflow: "hidden", opacity: videoBoxReady ? 1 : 0 }}
              pointerEvents="none"
            >
              {isNearActive && playerMounted && (
                <ReelVideoPlayer
                  ref={videoRef}
                  uri={video.url}
                  isActive={isActive}
                  paused={holdPaused}
                  speed={speed}
                  // ↔ #4 (تمرير تلقائي): لما autoAdvance مفعّل، الفيديو مبيلفّش
                  // تانى من نفسه — بيوصل لنهايته فعليًا (playToEnd جوه
                  // ReelVideoPlayer.tsx) عشان الشاشة الأب تقدر تنتقل للريل اللي
                  // بعده. لما يبقى معطّل، بيرجع لسلوك اللف اللانهائي الأصلي.
                  autoAdvance={autoAdvance}
                  // ↔ #4 (كتم صوت الخلفية): بيضيف تفضيل الكتم اليدوي فوق شرط
                  // "مش الريل النشط" الموجود أصلاً (isActive) بدل ما يستبدله.
                  muted={!isActive || musicMuted}
                  onPosition={onVideoPosition}
                  onFinished={onVideoFinished}
                  onPlayingChange={(playing) => { if (playing) setVideoStarted(true); }}
                  onPiPClosed={() => setPaused(true)}
                />
              )}
              {/* ↔ perf audit fix #1 (محدّث): الكروت خارج النطاق القريب من الريل
                  النشط ما فيهاش player حقيقي — بتعرض بس البوستر. والكروت
                  القريبة بتعرض نفس البوستر فوق الفيديو لحد ما يشتغل فعليًا.
                  contentFit=contain زي VideoView بالظبط عشان التبديل بينهم
                  يبقى من غير أي قفزة فى الشكل. pointerEvents=none عشان مفيش
                  لمسة تتبلع (نفس سبب الباغ الموثّق فى ReelVideoPlayer). */}
              {!(isNearActive && playerMounted && videoStarted) && (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <Image source={{ uri: cldReelPoster(video.url) }} style={StyleSheet.absoluteFill} contentFit="contain" onLoad={handlePosterLoad} />
                </View>
              )}
            </Animated.View>
          </>
        ) : mode === "slideshow" && images.length > 0 ? (
          // ↔ #3: "من غير ما يقتصّه" — contentFit يتغيّر لـ contain وهو
          // مصغّر عشان الصورة تبان كاملة جوه المساحة الصغيرة، بدل ما
          // تتقصّ حواف زي وضع العرض العادي (cover).
          <Image source={{ uri: cldOptimized(images[slideIdx].url) }} style={StyleSheet.absoluteFill} contentFit={detailsMounted ? "contain" : "cover"} />
        ) : (
          <ReelBackground index={index} type={property.type} />
        )}

        {/* ↔ .reel-pause-indicator — إصلاح باغ #2: فلاش قصير عند كل تبديل
            (تشغيل أو إيقاف) بدل ما تفضل أيقونة الإيقاف ظاهرة باستمرار. */}
        {tapFeedback && !detailsMounted && !pipUi && (
          <Animated.View style={[styles.pauseIndicator, { opacity: tapFeedbackOpacity }]} pointerEvents="none">
            <Svg width={40} height={40} viewBox="0 0 24 24" fill="white">
              {tapFeedback === "pause" ? <Path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <Path d="M8 5v14l11-7z" />}
            </Svg>
          </Animated.View>
        )}

        {/* ↔ .long-press-indicator */}
        {speed === 2 && !detailsMounted && !pipUi && (
          <View style={styles.longPressIndicator} pointerEvents="none">
            <Text style={styles.longPressText}>⚡ 2X</Text>
          </View>
        )}

        {!detailsMounted && (
          // ↔ .reel-tap-top / .reel-tap-bottom + startLongPress/endLongPress
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={togglePause}
            onLongPress={() => setSpeed(2)}
            delayLongPress={LONG_PRESS_MS}
            onPressOut={() => setSpeed(1)}
          />
        )}

        {!pipUi && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: mediaOverlayOpacity }]} pointerEvents={detailsMounted ? "none" : "box-none"}>
          <ReelInfoOverlay
            property={property}
            onOpenDetails={() => onOpenDetails(property.id)}
            onReport={onReport ? () => onReport(property) : undefined}
          />

          <ReelCaptionsOverlay property={property} isActive={isActive} />

          {mode === "video" && (
            <ReelSeekBar
              currentSec={videoPosMs / 1000}
              durationSec={videoDurMs / 1000}
              isPlaying={isActive && !holdPaused}
              onTogglePlay={togglePause}
              onSeek={seekVideo}
              onScrubStart={() => setScrubbing(true)}
              onScrubCancel={() => setScrubbing(false)}
            />
          )}
          {mode === "slideshow" && images.length > 1 && (
            <ReelSeekBar
              currentSec={slideElapsedMs / 1000}
              durationSec={slideTotalMs / 1000}
              isPlaying={isActive && !holdPaused}
              onTogglePlay={togglePause}
              onSeek={seekSlideshow}
              onScrubStart={() => setScrubbing(true)}
              onScrubCancel={() => setScrubbing(false)}
            />
          )}

          <ReelActionRail
            seller={seller}
            likes={property.likes}
            comments={property.comments ?? 0}
            liked={isLiked}
            saved={isFavorite}
            following={isFollowing}
            comparing={isComparing}
            onOpenSeller={() => onOpenSeller(property.seller.id)}
            onToggleFollow={() => onToggleFollow(property.seller.id)}
            onToggleLike={() => onToggleLike(property.id)}
            onOpenComments={openComments}
            onShare={() => onShare(property)}
            onToggleSave={() => onToggleFavorite(property.id)}
            onToggleCompare={() => onToggleCompare(property.id)}
          />
        </Animated.View>
        )}

        {/* ↔ mini-player: الضغط على الريل المصغّر يرجّعه كامل الشاشة تاني
            (زي الضغط على الـ mini-player بتاع يوتيوب شورتس عشان يتكبّر) */}
        {detailsMounted && (
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet}>
            <Animated.View style={[styles.miniHandleWrap, { opacity: miniHandleOpacity }]} pointerEvents="none">
              <View style={styles.miniHandle} />
            </Animated.View>
          </Pressable>
        )}
      </Animated.View>

      {detailsMounted && (
        <Animated.View
          style={[styles.sheet, { height: sheetHeight, backgroundColor: themeColors.card, transform: [{ translateY: sheetTranslateY }] }]}
        >
          <View style={styles.sheetGrabRow} {...sheetPanResponder.panHandlers}>
            <View style={[styles.sheetGrabHandle, { backgroundColor: themeColors.border }]} />
            <Pressable style={[styles.sheetCloseBtn, { backgroundColor: themeColors.surface }]} onPress={closeSheet} hitSlop={10}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={themeColors.textSubtle} strokeWidth={2.5}>
                <Path d="M6 6l12 12M18 6L6 18" />
              </Svg>
            </Pressable>
          </View>
          {sheetKind === "comments" ? (
            <ReelCommentsPanel
              property={property}
              scrollAreaProps={contentPanResponder.panHandlers}
              onScrollY={(y) => { contentScrollY.current = y; }}
            />
          ) : (
            <>
          <View style={{ flex: 1 }} {...contentPanResponder.panHandlers}>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 16 }}
                showsVerticalScrollIndicator={false}
                onScroll={(e) => { contentScrollY.current = e.nativeEvent.contentOffset.y; }}
                scrollEventThrottle={16}
              >
                <PropertyDetailsContent property={property} />
              </ScrollView>
            </View>
            <PropertyCtaBar property={property} />
            </>
          )}
        </Animated.View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  pauseIndicator: {
    position: "absolute", top: "50%", left: "50%", marginTop: -20, marginLeft: -20, opacity: 0.85,
  },
  longPressIndicator: {
    position: "absolute", top: "50%", left: "50%", marginTop: -16, marginLeft: -34,
    backgroundColor: "rgba(0,0,0,0.7)", paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, zIndex: 50,
  },
  longPressText: { color: "white", fontSize: 12, fontWeight: "900" },
  miniHandleWrap: { position: "absolute", top: 6, left: 0, right: 0, alignItems: "center" },
  miniHandle: { width: 36, height: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.6)" },
  sheet: {
    backgroundColor: "white", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 20,
  },
  sheetGrabRow: { alignItems: "center", paddingTop: 8, paddingBottom: 4, minHeight: 44 },
  sheetGrabHandle: { width: 36, height: 4, borderRadius: 999, backgroundColor: "#e5e7eb" },
  sheetCloseBtn: {
    position: "absolute", top: 8, ...CLOSE_BTN_SIDE_STYLE, width: 28, height: 28, borderRadius: 14,
    backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center", zIndex: 5, elevation: 5,
  },
});
