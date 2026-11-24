import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { View, Animated, PanResponder, Platform, StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";

// ↔ شريط أفقى متحرك تلقائيًا (Auto-scroll) مع سحب يدوى — مكوّن عام قابل لإعادة الاستخدام (يستخدمه شريط «إعلانات مميزة» فى 4 صفحات).
//   • مبنى بـ Animated + PanResponder (وليس ScrollView أفقى) لتوحيد سلوك اتجاه RTL بين أندرويد وآيفون والويب والـ APK: المسار دائمًا direction:ltr
//     والترتيب المرئى (يمين ← يسار) = ترتيب items، فالعنصر الأول على اليمين.
//   • الحركة التلقائية: كل autoMs يتحرك المحتوى نحو اليمين بمقدار كارت واحد (ينزلق العنصر التالى من اليسار) بحركة انسيابية، وعند آخر عنصر يعود للبداية.
//     تتوقف أثناء اللمس/السحب وبعده بـ pauseMs، ولا تتحرك لو كل العناصر ظاهرة (لا يوجد ما يُمرَّر).
//   • السحب يمينًا/يسارًا يتبع الإصبع مباشرة ثم يستقر على أقرب كارت. السحب الرأسى يمرّ للصفحة (ScrollView/FlatList) بلا تعطيل.
type Props<T> = {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T, width: number) => ReactNode;
  // عرض الكارت كدالة فى عرض الشريط (مثلاً 78% منه بحد أقصى).
  itemWidth: (viewportWidth: number) => number;
  gap?: number;
  autoMs?: number;
  pauseMs?: number;
  style?: StyleProp<ViewStyle>;
};

export function AutoCarousel<T>({ items, keyOf, renderItem, itemWidth, gap = 12, autoMs = 3200, pauseMs = 6000, style }: Props<T>) {
  const { language } = useLanguage();
  const contentDir = language === "ar" ? "rtl" : "ltr"; // المسار ltr دائمًا، أما محتوى الكارت فيتبع اتجاه اللغة
  const [vw, setVw] = useState(0);
  const n = items.length;
  const cardW = vw > 0 ? Math.max(1, Math.round(itemWidth(vw))) : 0;
  const step = cardW + gap;
  const trackW = n * cardW + Math.max(0, n - 1) * gap;
  const base = vw - trackW; // الإزاحة الابتدائية: آخر عنصر مرئيًا (الأول) ملاصق للحافة اليمنى
  const maxOff = Math.max(0, -base);
  const stops = maxOff > 0 && step > 0 ? Math.ceil(maxOff / step) + 1 : 1;

  const x = useRef(new Animated.Value(0)).current;
  const stopRef = useRef(0);
  const pausedUntil = useRef(0);
  const dragging = useRef(false);
  const geo = useRef({ base: 0, maxOff: 0, step: 1, stops: 1 });
  geo.current = { base, maxOff, step, stops };

  const goTo = useCallback(
    (p: number, animated = true) => {
      const g = geo.current;
      const clamped = Math.max(0, Math.min(g.stops - 1, p));
      stopRef.current = clamped;
      const toValue = g.base + Math.min(clamped * g.step, g.maxOff);
      if (!animated) {
        x.setValue(toValue);
        return;
      }
      Animated.timing(x, { toValue, duration: 520, useNativeDriver: Platform.OS !== "web" }).start();
    },
    [x]
  );

  // مقاس/عدد العناصر تغيّر: نعيد الضبط على الوضع الحالى بدون حركة.
  useEffect(() => {
    if (vw > 0) goTo(Math.min(stopRef.current, stops - 1), false);
  }, [vw, n, cardW, stops, goTo]);

  useEffect(() => {
    if (stops <= 1) return;
    const id = setInterval(() => {
      if (dragging.current || Date.now() < pausedUntil.current) return;
      goTo(stopRef.current >= geo.current.stops - 1 ? 0 : stopRef.current + 1);
    }, autoMs);
    return () => clearInterval(id);
  }, [stops, autoMs, goTo]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => geo.current.maxOff > 0 && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
        onPanResponderGrant: () => {
          dragging.current = true;
          x.stopAnimation();
        },
        onPanResponderMove: (_e, g) => {
          const { base: b, maxOff: m } = geo.current;
          const startOff = Math.min(stopRef.current * geo.current.step, m);
          x.setValue(b + Math.max(0, Math.min(m, startOff + g.dx)));
        },
        onPanResponderRelease: (_e, g) => {
          dragging.current = false;
          pausedUntil.current = Date.now() + pauseMs;
          const { maxOff: m, step: s, stops: st } = geo.current;
          const startOff = Math.min(stopRef.current * s, m);
          let off = Math.max(0, Math.min(m, startOff + g.dx + g.vx * 120)); // السحب لليمين يزيد الإزاحة (يظهر ما على اليسار)
          if (off > m - s * 0.15) off = m;
          goTo(Math.max(0, Math.min(st - 1, Math.round(off / Math.max(s, 1)))));
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
          goTo(stopRef.current);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [x, goTo, pauseMs]
  );

  const ordered = useMemo(() => [...items].reverse(), [items]); // اليسار ← اليمين
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== vw) setVw(w);
  };
  const webTouch = Platform.OS === "web" ? ({ touchAction: "pan-y", userSelect: "none" } as unknown as ViewStyle) : null;

  return (
    <View style={[styles.viewport, webTouch, style]} onLayout={onLayout} {...pan.panHandlers}>
      {cardW > 0 && (
        <Animated.View style={[styles.track, { width: trackW, transform: [{ translateX: x }] }]}>
          {ordered.map((it, i) => (
            <View key={keyOf(it)} style={{ width: cardW, marginRight: i === ordered.length - 1 ? 0 : gap, direction: contentDir }}>
              {renderItem(it, cardW)}
            </View>
          ))}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { width: "100%", overflow: "hidden", direction: "ltr" as const },
  track: { flexDirection: "row", direction: "ltr" as const },
});
