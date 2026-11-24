import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, View, type LayoutChangeEvent } from "react-native";

// ↔ مسار أفقى "محايد للاتجاه" تبنى عليه الكاروسيلات اليدوية (AutoCarousel = «إعلانات مميزة»، وقسم «الخدمات»).
//   المشكلة التى يحلها: على بعض أجهزة الأندرويد (APK) والمتصفحات يوضع المسار داخل الحاوية بحسب اتجاه التطبيق (RTL) رغم
//   direction:"ltr"، فيُضاف الإزاحة المحسوبة فوق موضع المسار الفعلى فيُقصّ أول كارت من اليمين.
//   الحل: نقيس موضع المسار الفعلى (layout.x) ونطرحه من الإزاحة، ونكتشف مرة واحدة هل الصف معكوس فنعكس ترتيب الخلايا،
//   فيكون الناتج واحدًا على أندرويد/آيفون/الويب/APK: «translate» = موضع الحافة اليسرى للمسار داخل الحاوية بالـ dp،
//   والخلية الأولى فى visual أقصى اليسار دائمًا.
//   كل خلية عرضها cellW وبها حشو أفقى متماثل (pad) فلا نعتمد على margin اليمين/اليسار (يُقلبان فى RTL).
type Props<T> = {
  visual: T[]; // العناصر من اليسار إلى اليمين
  keyOf: (item: T, index: number) => string;
  cellW: number;
  pad: number;
  translate: Animated.Value; // موضع الحافة اليسرى للمسار داخل الحاوية (dp)
  contentDir: "ltr" | "rtl";
  renderItem: (item: T, innerWidth: number, index: number) => ReactNode;
};

export function LtrTrack<T>({ visual, keyOf, cellW, pad, translate, contentDir, renderItem }: Props<T>) {
  const n = visual.length;
  const trackX = useRef(new Animated.Value(0)).current;
  const [measured, setMeasured] = useState(false);
  const [dirKnown, setDirKnown] = useState(n < 2);
  const [rowRtl, setRowRtl] = useState(false);
  const decided = useRef(false);
  const xs = useRef<Record<string, number>>({});
  const tx = useMemo(() => Animated.subtract(translate, trackX), [translate, trackX]);

  const keys = visual.map((it, i) => keyOf(it, i));
  const order = visual.map((_, i) => i);
  if (rowRtl) order.reverse();

  useEffect(() => {
    if (n < 2) setDirKnown(true);
  }, [n]);
  // احتياط: لو لم تصل أحداث القياس لأى سبب لا نُبقى الشريط مخفيًا.
  useEffect(() => {
    const id = setTimeout(() => setDirKnown(true), 600);
    return () => clearTimeout(id);
  }, []);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    trackX.setValue(Math.round(e.nativeEvent.layout.x));
    setMeasured(true);
  };
  const onCellLayout = (key: string, e: LayoutChangeEvent) => {
    xs.current[key] = e.nativeEvent.layout.x;
    if (decided.current || n < 2) return;
    const first = xs.current[keys[order[0]]];
    const last = xs.current[keys[order[n - 1]]];
    if (first === undefined || last === undefined) return;
    decided.current = true;
    setRowRtl(first > last); // أول خلية مرسومة على اليمين = الصف معكوس
    setDirKnown(true);
  };

  return (
    <Animated.View
      onLayout={onTrackLayout}
      style={{
        flexDirection: "row",
        direction: "ltr",
        width: n * cellW,
        opacity: measured && dirKnown ? 1 : 0,
        transform: [{ translateX: tx }],
      }}
    >
      {order.map((i) => (
        <View
          key={keys[i]}
          onLayout={(e) => onCellLayout(keys[i], e)}
          style={{ width: cellW, paddingHorizontal: pad, direction: contentDir }}
        >
          {renderItem(visual[i], cellW - pad * 2, i)}
        </View>
      ))}
    </Animated.View>
  );
}
