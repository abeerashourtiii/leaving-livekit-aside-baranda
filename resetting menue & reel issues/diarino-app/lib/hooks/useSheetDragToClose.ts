import { useCallback, useEffect, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { Animated, BackHandler, Easing, NativeScrollEvent, NativeSyntheticEvent, PanResponder } from "react-native";

// ↔ سحب صفحة تفاصيل العقار لأسفل لإغلاقها من أي مكان داخل الصفحة (بعد الوصول
// لقمة المحتوى)، بنفس السلوك على أندرويد وآيفون والويب والـ APK.
//
// الفكرة:
//  * الصفحة بقت "شيت" بنرسمه إحنا (backdrop + لوحة بتتحرّك بـ translateY) بدل
//    formSheet الأصلى — لأن formSheet الأصلى مالوش سحب-للإغلاق من وسط المحتوى
//    على أندرويد/الويب، وعلى آيفون بيتعارض مع سكرول المحتوى.
//  * onMoveShouldSetPanResponderCapture (مرحلة الـ capture) بتخلّينا ناخد اللمسة
//    قبل الـ ScrollView — بس لما scrollY <= 0 والحركة لتحت وعمودية. غير كده
//    السكرول شغّال عادي تمامًا.
//  * لو المستخدم بدأ السحب فى نص الصفحة وسكرول لفوق لحد القمة وكمّل لتحت فى
//    نفس اللمسة، بنحسب الإزاحة من اللحظة اللى وصل فيها للقمة (claimDy) فمفيش
//    قفزة مفاجئة فى الشيت.
//  * الحركة بـ Animated + useNativeDriver (translateY/opacity فقط)، والإفلات
//    بيعتمد على المسافة والسرعة (fling) ومدة الإغلاق بتتناسب مع المسافة
//    المتبقية، فالانزلاق ناعم وانسيابي.
export function useSheetDragToClose(onClosed: () => void, sheetHeight: number) {
  const translateY = useRef(new Animated.Value(sheetHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const scrollYRef = useRef(0);
  const claimDy = useRef(0);
  const closingRef = useRef(false);
  const heightRef = useRef(sheetHeight);
  heightRef.current = sheetHeight;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  // فتح: انزلاق من تحت + ظهور تدريجى للخلفية المعتمة.
  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [translateY, backdropOpacity]);

  // إغلاق: distance = المسافة اللى فاضلة للنزول، velocity بالبكسل/ملّي ثانية (اختياري).
  const close = useCallback(
    (fromDy = 0, velocity = 0) => {
      if (closingRef.current) return;
      closingRef.current = true;
      const remaining = Math.max(heightRef.current - fromDy, 1);
      const speed = Math.max(velocity, 1.1); // px/ms
      const duration = Math.round(Math.min(300, Math.max(170, remaining / speed)));
      Animated.parallel([
        Animated.timing(translateY, { toValue: heightRef.current, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration, useNativeDriver: true }),
      ]).start(() => onClosedRef.current());
    },
    [translateY, backdropOpacity]
  );

  const springBack = useCallback(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, bounciness: 0, speed: 16, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [translateY, backdropOpacity]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        !closingRef.current && scrollYRef.current <= 0 && g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
      onPanResponderGrant: (_, g) => {
        // الإزاحة اللى حصلت قبل ما نمسك اللمسة (سكرول لقمة الصفحة) ما تتحسبش.
        claimDy.current = g.dy;
      },
      onPanResponderMove: (_, g) => {
        const d = Math.max(0, g.dy - claimDy.current);
        translateY.setValue(d);
        backdropOpacity.setValue(Math.max(0, 1 - d / heightRef.current));
      },
      onPanResponderRelease: (_, g) => {
        const d = Math.max(0, g.dy - claimDy.current);
        const threshold = Math.min(160, heightRef.current * 0.2);
        if (d > threshold || (g.vy > 0.8 && d > 20)) close(d, g.vy);
        else springBack();
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => springBack(),
    })
  ).current;

  // زر الرجوع فى أندرويد: نفس الانزلاق الناعم بدل الاختفاء المفاجئ.
  // useFocusEffect (مش useEffect) عشان المستمع يشتغل بس وقت ما الصفحة هى
  // اللى فوق — لو فتحت شاشة تانية فوقها (بائع/محادثة...) زر الرجوع يقفل
  // الشاشة دى الأول مش صفحة التفاصيل اللى تحتها.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        close();
        return true;
      });
      return () => sub.remove();
    }, [close])
  );

  return { translateY, backdropOpacity, panHandlers: panResponder.panHandlers, onScroll, close };
}
