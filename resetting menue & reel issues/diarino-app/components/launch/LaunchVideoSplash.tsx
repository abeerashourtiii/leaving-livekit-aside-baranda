import { useCallback, useEffect, useRef } from "react";
import type { ComponentProps } from "react";
import { Animated, Easing, Platform, StatusBar, StyleSheet } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEventListener } from "expo";

// ↔ شاشة الإقلاع: فيديو قصير (3 ثوانٍ) فيه لوجو التطبيق وتحته اسم "Baranda"
// بأنيميشن، على الخلفية الخضرا الزيتونية #7E9967 (نفس لون خلفية الصفحات
// الداخلية فى الوضع الفاتح). بتحل محل شاشتين كانوا بيظهروا بالتتابع:
//   1) الـ splash الأصلي (لوجو صغير جدًا) — دلوقتي لون أخضر ساكت بس (من غير
//      لوجو) فى ملفات أندرويد/آيفون الأصلية، وبعده الفيديو بيكمّل من نفس اللون.
//   2) IntroSplash (لوجو كبير ومقصوص بـ cover) — اتشالت خالص.
//
// ✦ مكان العرض: overlay فوق التطبيق كله من app/_layout.tsx مرة واحدة فى كل
//   إقلاع بارد — فالتطبيق بيتحمّل تحته (الجلسة، اللغة، البيانات) طول مدة
//   الفيديو، ومش بيتكرر عند تسجيل الخروج أو الرجوع لأول صفحة.
// ✦ contentFit="contain": الفيديو 1080×1920 (9:16) وخلفيته نفس لون الـ container
//   (#7E9866 فى الفيديو بعد تحويل YUV ≈ #7E9967 بفرق وحدة لونية واحدة غير
//   مرئي) — فمهما كانت نسبة الشاشة (أندرويد/آيفون/تابلت/ويب عريض) اللوجو
//   والاسم بيظهروا كاملين من غير أي اقتصاص، والزيادة على الجوانب خضرا مندمجة.
// ✦ الستارة الخضرا (cover): الـ VideoView الأصلية بتبقى سودا لحد ما أول إطار
//   يتعرض، فبنغطّيها بستارة بنفس لون الخلفية وبنشيلها (fade) أول ما الفيديو
//   يشتغل فعليًا — فمفيش وميض أسود. (opacity على الـ SurfaceView نفسها مش
//   مضمون على أندرويد، عشان كده الستارة فوقها مش opacity عليها.)
// ✦ أمان الإقلاع: لو الفيديو ما بدأش خلال START_TIMEOUT_MS (جهاز/متصفح بيمنع
//   التشغيل التلقائي أو الملف مش بيتفك) أو حصل خطأ، أو عدّى HARD_CAP_MS —
//   الشاشة بتتقفل وبيظهر التطبيق عادي. الإقلاع عمره ما بيعلق على الفيديو.
export const LAUNCH_BACKGROUND = "#7E9967";

const LAUNCH_VIDEO = require("../../assets/splash/baranda_splash.mp4");

const START_TIMEOUT_MS = 2500;
const HARD_CAP_MS = 6000;
const REVEAL_MS = 250;
const EXIT_MS = 280;

const useNative = Platform.OS !== "web";

// لون شريط الحالة الأصلي على أندرويد (android:statusBarColor فى styles.xml).
const ANDROID_STATUS_BAR_DEFAULT = "#EFEBE3";

export function LaunchVideoSplash({ onDone }: { onDone: () => void }) {
  const player = useVideoPlayer(LAUNCH_VIDEO, (p) => {
    p.loop = false;
    p.muted = true;
    p.play();
  });

  const cover = useRef(new Animated.Value(1)).current;     // 1 = ستارة ظاهرة (الفيديو مخفي)
  const container = useRef(new Animated.Value(1)).current; // 1 = الشاشة ظاهرة
  const startedRef = useRef(false);
  const finishedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    try { player.pause(); } catch { /* player اتشال */ }
    Animated.timing(container, {
      toValue: 0, duration: EXIT_MS, easing: Easing.out(Easing.quad), useNativeDriver: useNative,
    }).start(() => onDoneRef.current());
  }, [container, player]);

  useEventListener(player, "playingChange", (payload) => {
    if (!payload.isPlaying || startedRef.current) return;
    startedRef.current = true;
    Animated.timing(cover, {
      toValue: 0, duration: REVEAL_MS, easing: Easing.out(Easing.quad), useNativeDriver: useNative,
    }).start();
  });

  useEventListener(player, "playToEnd", finish);

  useEventListener(player, "statusChange", (payload) => {
    if (payload.status === "error") finish();
  });

  // ↔ أندرويد: شريط الحالة ليه لون خاص بيه (بيج) خارج نافذة التطبيق، فبنخليه أخضر
  // طول الفيديو عشان الشاشة تبان متصلة، ونرجّعه للونه الأصلي لما الفيديو يخلص.
  // (فى وضع edge-to-edge الأمر ممكن يتجاهل — مفيش ضرر، بنحاوط بـ try/catch.)
  useEffect(() => {
    if (Platform.OS !== "android") return;
    try { StatusBar.setBackgroundColor(LAUNCH_BACKGROUND, true); } catch { /* ignore */ }
    return () => {
      try { StatusBar.setBackgroundColor(ANDROID_STATUS_BAR_DEFAULT, true); } catch { /* ignore */ }
    };
  }, []);

  useEffect(() => {
    const startTimer = setTimeout(() => {
      if (!startedRef.current) finish();
    }, START_TIMEOUT_MS);
    const capTimer = setTimeout(finish, HARD_CAP_MS);
    return () => { clearTimeout(startTimer); clearTimeout(capTimer); };
  }, [finish]);

  return (
    <Animated.View style={[styles.root, { opacity: container }]}>
      <VideoView
        player={player as unknown as ComponentProps<typeof VideoView>["player"]}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture={false}
        pointerEvents="none"
      />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.cover, { opacity: cover }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // zIndex/elevation عالية: فوق Stack وكل الشاشات وأي modal presentation.
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: LAUNCH_BACKGROUND, zIndex: 9999, elevation: 9999 },
  cover: { backgroundColor: LAUNCH_BACKGROUND },
});
