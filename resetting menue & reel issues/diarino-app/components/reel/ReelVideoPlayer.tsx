import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { isAppForeground, setPiPActive } from "../../lib/pipState";
import { useEventListener } from "expo";
import { usePiPPreference } from "../../lib/hooks/usePiPPreference";

export type ReelVideoPlayerHandle = { seekToPct: (pct: number) => void };

type Props = {
  uri: string;
  isActive: boolean;
  paused: boolean;
  speed: 1 | 2;
  autoAdvance: boolean;
  muted: boolean;
  onPosition: (currentSec: number, durationSec: number) => void;
  onFinished: () => void;
  // ↔ بيتنده لما الفيديو يبدأ يشتغل فعليًا (أول مرة isPlaying = true) —
  // ReelCard بيستخدمه يشيل صورة البوستر اللي فوق الفيديو (لحد وقتها
  // الـ VideoView الأصلية بتبقى سودا)، فمفيش وميض أسود عند الوصول لريل.
  onPlayingChange?: (isPlaying: boolean) => void;
  // ↔ بيتنده لما المستخدم يقفل نافذة PiP العائمة بزر ✕ (مش بزر التوسيع): الريل وقف بصوته،
  // وReelCard بيحوّل حالته لـ "متوقف" فلما المستخدم يرجع للتطبيق يلاقيه واقف (زى يوتيوب).
  onPiPClosed?: () => void;
};

// ↔ ترقية expo-av → expo-video (طلب المستخدم — الميزة 2: PiP). العنصر ده
// بيحل محل <Video> بتاعت expo-av فى ReelCard.tsx بالظبط بنفس السلوك
// (كتم/تمرير تلقائي/سرعة 2x/تتبع الموضع/اكتشاف الانتهاء)، زائد PiP حقيقي
// عبر allowsPictureInPicture — أول مرة الخاصية دي بقت شغالة فعليًا فى
// التطبيق (كانت قبل كده مجرد تفضيل متخزّن بدون تشغيل فعلي، شوف
// usePiPPreference.ts).
//
// ↔ ليه فى كومبوننت منفصل: useVideoPlayer() هوك، ومينفعش يتنده شرطيًا
// جوه ReelCard (اللي بس بيعمل mount لعنصر الفيديو الحقيقي لما
// isNearActive تكون true). عزل الهوك هنا جوه كومبوننت بيتعمله mount/
// unmount بالكامل حسب isNearActive بيحل المشكلة من غير ما يخالف قواعد
// الـ Hooks.
export const ReelVideoPlayer = forwardRef<ReelVideoPlayerHandle, Props>(function ReelVideoPlayer(
  { uri, isActive, paused, speed, autoAdvance, muted, onPosition, onFinished, onPlayingChange, onPiPClosed },
  ref
) {
  const { preference: pipPreference } = usePiPPreference();
  const player = useVideoPlayer(uri, (p) => {
    p.loop = !autoAdvance;
    // ↔ مهم: timeUpdateEventInterval بيبقى 0 افتراضيًا فى expo-video (يعني
    // event الـ "timeUpdate" مش بيتبعت خالص من غير ما نحدده صراحةً) —
    // بدونها شريط الـ seek كان هيفضل واقف على 0:00 طول الوقت، من غير أي
    // خطأ ظاهر فى الكونسول يوضح السبب.
    p.timeUpdateEventInterval = 0.25;
    // ↔ إصلاح "الصوت بيتغيّر عند التسريع": على أندرويد قيمة preservesPitch
    // الافتراضية فى الكود الأصلى لـ expo-video هى false (عكس التوثيق) — يعني
    // عند 2x الصوت كان بيتسرّع مع ارتفاع طبقته (صوت رفيع/مختلف عن الأصلي).
    // بنفعّلها صراحةً (تصحيح الطبقة) فالصوت المسرَّع هو نفس الصوت الأصلي بنفس
    // الطبقة والجرس، بس أسرع — على أندرويد وآيفون والويب والـ APK.
    p.preservesPitch = true;
  });

  // ↔ نفس الـ workaround اللي كان موجود مع expo-av: لما الفيديو يوصل
  // لآخره من غير loop (autoAdvance مفعّل)، الـ player بيفضل واقف عند آخر
  // فريم ومبيرجعش لأول تلقائيًا — فلو المستخدم رجع لنفس الريل ده تانى،
  // finishedRef بيسجّل إننا محتاجين نرجّع currentTime لصفر قبل ما نشغّله.
  const finishedRef = useRef(false);

  // ↔ إصلاح "توقف شريط الـ seek عند إعادة الريل تلقائيًا": باغ موثّق فى
  // expo-video نفسها (expo/expo#34700 على أندرويد، #37299 على آيفون) —
  // عند لحظة اللف التلقائي (loop)، player.duration وplayer.currentTime
  // ممكن يترجعوا قيمة غلط لحظيًا (duration بيبقى 0 مثلاً) قبل ما يستقروا
  // تانى. من غير الحماية دي، onPosition(currentSec, 0) كانت بتتبعت لحظة
  // اللف، فـ ReelSeekBar بيحسب النسبة (currentSec/duration) بقيمة duration
  // صفر ويجمّد الشريط. الحل: بنحتفظ بآخر duration صحيحة (أكبر من صفر)
  // اتسجلت فعلاً، وبنفضل نبعتها حتى لو الحدث الحالي رجع قيمة فاسدة مؤقتًا.
  const lastGoodDurationRef = useRef(0);

  useEffect(() => { player.loop = !autoAdvance; }, [player, autoAdvance]);
  useEffect(() => { player.muted = muted; }, [player, muted]);
  // ↔ الترتيب مهم: preservesPitch الأول وبعدين playbackRate (أندرويد بيحسب
  // PlaybackParameters(speed, pitch) عند كل تغيير). speedRef بيخلّينا نعيد
  // تطبيق نفس القيمتين لحظة التشغيل كمان (بعض المنصات بترجّع المعدّل/الطبقة
  // الافتراضيين بعد تحميل المصدر أو بعد pause/play).
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
    player.preservesPitch = true;
    player.playbackRate = speed;
  }, [player, speed]);

  useEffect(() => {
    const shouldPlay = isActive && !paused;
    if (shouldPlay) {
      if (finishedRef.current) {
        finishedRef.current = false;
        player.currentTime = 0;
      }
      player.preservesPitch = true;
      player.playbackRate = speedRef.current;
      player.play();
    } else {
      player.pause();
    }
  }, [player, isActive, paused]);

  // ↔ إغلاق نافذة PiP بزر ✕ لازم يوقّف الريل وصوته. السبب إن الإغلاق بيوصل للتطبيق بنفس حدث
  // "التوسيع" (onPictureInPictureStop) وكان الصوت بيكمّل شغال فى الخلفية. الفرق بين الحالتين:
  // بعد التوسيع التطبيق بيرجع للواجهة، وبعد الإغلاق بيفضل فى الخلفية — فبنستنى لحظة (لحد ما
  // حالة التطبيق تستقر) ونوقف الـ player لو لسه فى الخلفية. أندرويد كمان عنده إيقاف أصلى فى
  // patches/expo-video+2.0.6.patch (PiPSessionFragment.onStop) — دى الحماية الثانية للمنصات كلها.
  const pipStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pipStopTimerRef.current) clearTimeout(pipStopTimerRef.current);
  }, []);
  const handlePiPStop = () => {
    setPiPActive(false);
    if (pipStopTimerRef.current) clearTimeout(pipStopTimerRef.current);
    pipStopTimerRef.current = setTimeout(() => {
      pipStopTimerRef.current = null;
      if (isAppForeground()) return; // رجع للتطبيق (توسيع) — الريل يكمّل عادى
      try { player.pause(); } catch { /* الـ player اتفكّ */ }
      onPiPClosed?.();
    }, 600);
  };

  useEventListener(player, "playingChange", (payload) => {
    onPlayingChange?.(payload.isPlaying);
  });

  useEventListener(player, "playToEnd", () => {
    if (autoAdvance) finishedRef.current = true;
    onFinished();
  });

  useEventListener(player, "timeUpdate", (payload) => {
    if (player.duration > 0) lastGoodDurationRef.current = player.duration;
    onPosition(payload.currentTime, lastGoodDurationRef.current);
  });

  useImperativeHandle(ref, () => ({
    seekToPct(pct: number) {
      if (!player.duration) return;
      finishedRef.current = false;
      player.currentTime = Math.max(0, Math.min(1, pct)) * player.duration;
      // ↔ الريل لازم *يستأنف* من نقطة إفلات الكرة: بنطلب التشغيل صراحةً بعد ضبط الموضع (بعض الـ players —
      //   الويب خصوصًا، وأحيانًا أثناء buffering على أندرويد/آيفون — بترجع لحالة "متوقف" بعد تغيير currentTime).
      //   ReelCard بيشيل حالة الإيقاف (paused/scrubbing) فى نفس اللحظة، فالـ effect تحت كمان بيشغّله.
      player.play();
    },
  }), [player]);

  return (
    <VideoView
      player={player as unknown as ComponentProps<typeof VideoView>["player"]}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
      // ↔ إصلاح "إيقاف/استمرار الريل شغّال على الويب بس، مش شغّال على
      // الـ APK/أندرويد/آيفون": باغ موثّق فى expo-video (expo/expo#30275،
      // #34630) — الـ VideoView الأصلية (SurfaceView على أندرويد) بتفضل
      // دايمًا فوق فى ترتيب استقبال اللمس على المنصات الأصلية بغض النظر
      // عن ترتيب الـ JSX، حتى لو الـ Pressable الشفاف بتاع "اضغط للإيقاف/
      // التشغيل" فى ReelCard.tsx متعرّف بعدها فى الكود (يعني المفروض يبقى
      // فوقها). ده اللي كان بيمنع الضغطة توصل للـ Pressable على المنصات
      // الأصلية بس — الويب (react-native-web) بيرندر VideoView كعنصر DOM
      // عادي محترم لترتيب العناصر، عشان كده كانت شغالة هناك بس.
      // pointerEvents="none" هنا بيمنع VideoView من إنها تاخد أي لمسة
      // أصلاً (مش محتاجينها؛ nativeControls أصلاً false)، فاللمس كله
      // بيوصل للـ Pressable اللي فوقها زي المفروض على كل المنصات.
      pointerEvents="none"
      // ↔ الميزة 2 (PiP): مفعّلة بس لو المستخدم وافق صراحةً من مودال
      // "عرض التطبيق فوق التطبيقات الأخرى" (شوف PictureInPictureModal.tsx)
      // — مش مفعّلة بشكل افتراضي لكل الفيديوهات.
      allowsPictureInPicture={pipPreference !== "declined"}
      startsPictureInPictureAutomatically={pipPreference !== "declined" && isActive}
      // ↔ شاشة الريلز بتثبّت ارتفاع الريل والريل النشط طول مدة PiP (شوف lib/pipState.ts) عشان
      // نافذة PiP تفضل بتعرض نفس الريل بدل ما تتبدّل أو تتوقف.
      onPictureInPictureStart={() => setPiPActive(true)}
      onPictureInPictureStop={handlePiPStop}
    />
  );
});
