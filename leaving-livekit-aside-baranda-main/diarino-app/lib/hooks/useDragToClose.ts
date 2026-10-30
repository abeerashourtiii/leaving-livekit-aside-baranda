import { useCallback, useEffect, useRef } from "react";
import { Animated, Easing, PanResponder, NativeSyntheticEvent, NativeScrollEvent } from "react-native";

// ↔ منطق مشترك لكل الشيتات المنبثقة (فلاتر البحث/الريلز/الطلبات، تقديم عرض، الإبلاغ، المتابعين...): السحب لأسفل من *أى مكان*
// داخل الصفحة بيقفلها، وبانسيابية على أندرويد/آيفون/الويب/APK.
//  • مرحلة capture: بنمسك السحب العمودى لتحت *قبل* أى عنصر جوّه (حقول كتابة، أزرار، شرائح) — فى «bubble» العادية كان أى
//    عنصر تفاعلى بياخد اللمسة الأول فالسحب ما كانش بيشتغل فوقه (زى صفحة تقديم عرض اللى فيها خانات كتابة).
//  • لو الشيت فيه ScrollView/FlatList مرّر `onScroll` (الراجعة) له: السحب بيقفل بس لما المحتوى يبقى فى الأعلى (scrollY <= 0)، ولو
//    وصل للقمة وإنت لسه ماسك بإصبعك وكمّلت لتحت، الإزاحة بتتحسب من لحظة الوصول (claimDy) فمفيش قفزة.
//  • كل الحركة translateY/opacity بالـ native driver (ما فيش layout أثناء السحب) → مفيش «وقفات» أثناء النزول.
//  • مرور الشيت من جديد (visible=true) بيصفّر موضع السكرول القديم (كان بيفضل رقم قديم فيمنع السحب بعد إعادة الفتح).
//  • الإفلات بيعتمد على المسافة والسرعة (fling)، ومدة الإغلاق بتتناسب مع المسافة المتبقية.
export function useDragToClose(
  onClose: () => void,
  opts?: { dismissThreshold?: number; flingDistance?: number; visible?: boolean }
) {
  const dismissThreshold = opts?.dismissThreshold ?? 110;
  const flingDistance = opts?.flingDistance ?? 800;
  const visible = opts?.visible;

  const translateY = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(1)).current;
  const scrollYRef = useRef(0);
  const claimDy = useRef(0);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  const reset = useCallback(() => {
    translateY.stopAnimation();
    backdropOpacity.stopAnimation();
    translateY.setValue(0);
    backdropOpacity.setValue(1);
    scrollYRef.current = 0;
    claimDy.current = 0;
    closingRef.current = false;
  }, [translateY, backdropOpacity]);

  // كل ما الشيت يتفتح من جديد: وضع نظيف (الموضع والسكرول القديمين).
  useEffect(() => {
    if (visible) reset();
  }, [visible, reset]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        !closingRef.current && scrollYRef.current <= 0 && g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
      onMoveShouldSetPanResponder: (_, g) =>
        !closingRef.current && scrollYRef.current <= 0 && g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_, g) => {
        translateY.stopAnimation();
        claimDy.current = g.dy; // الإزاحة اللى حصلت قبل ما نمسك اللمسة ما تتحسبش
      },
      onPanResponderMove: (_, g) => {
        const d = Math.max(0, g.dy - claimDy.current);
        translateY.setValue(d);
        backdropOpacity.setValue(Math.max(0, 1 - d / 500));
      },
      onPanResponderRelease: (_, g) => {
        const d = Math.max(0, g.dy - claimDy.current);
        if (d > dismissThreshold || (g.vy > 0.8 && d > 20)) {
          closingRef.current = true;
          const remaining = Math.max(flingDistance - d, 1);
          const duration = Math.round(Math.min(260, Math.max(150, remaining / Math.max(g.vy, 1.4))));
          Animated.parallel([
            Animated.timing(translateY, { toValue: flingDistance, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration, useNativeDriver: true }),
          ]).start(() => {
            translateY.setValue(0);
            backdropOpacity.setValue(1);
            closingRef.current = false;
            onCloseRef.current();
          });
        } else {
          Animated.parallel([
            Animated.spring(translateY, { toValue: 0, bounciness: 0, speed: 16, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          ]).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.parallel([
          Animated.spring(translateY, { toValue: 0, bounciness: 0, speed: 16, useNativeDriver: true }),
          Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]).start();
      },
    })
  ).current;

  return {
    translateY,
    backdropOpacity,
    panHandlers: panResponder.panHandlers,
    onScroll,
    reset,
  };
}
