import { useRef, useState } from "react";
import { View, Platform, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useKeyboardState } from "../../lib/hooks/useKeyboardState";

// ↔ حاوية «ارفع المحتوى فوق الكيبورد» لأى شاشة/نافذة فيها مربع كتابة — شغّالة بنفس الكود على أندرويد/آيفون/الويب/APK.
//  • آيفون: الكيبورد بيغطّى الشاشة، فبنضيف padding سفلى بمقدار ارتفاعه (المحتوى بيقف فوقه، والنافذة السفلية بتطلع معاه).
//  • أندرويد: غالبًا النظام نفسه بيصغّر النافذة (adjustResize) فمفيش حاجة نضيفها؛ لكن لو النافذة ما اتصغّرتش (أندرويد 15
//    edge-to-edge أو النوافذ المنبثقة Modal) بنكتشف ده بقياس ارتفاع الحاوية نفسها (لو ما قلّش مع ظهور الكيبورد) ونضيف الـ padding بدله.
//  • الويب: مفيش كيبورد افتراضى، فالحاوية مجرد View عادى.
// الاستخدام: لفّ محتوى الشاشة (أو محتوى الـ Modal) بـ <KeyboardAvoid style={{ flex: 1 }}>…</KeyboardAvoid>.
// mode:
//  • "padding" (الافتراضى): شاشة كاملة فيها حقول — بنضيف padding سفلى فالمحتوى (ScrollView/حقول) بيتضغط فوق الكيبورد.
//  • "sheet": نافذة منبثقة (Modal) لوحتها ملزوقة فى أسفل الشاشة — بنرفعها كلها بمقدار الكيبورد.
//  • "center": نافذة منبثقة بكارت فى نص الشاشة — بنرفعها بنص مقدار الكيبورد (كفاية عشان الكارت يفضل فوقه).
export function KeyboardAvoid({ style, children, iosPadding = true, mode = "padding", pointerEvents }: { style?: StyleProp<ViewStyle>; children: React.ReactNode; iosPadding?: boolean; mode?: "padding" | "sheet" | "center"; pointerEvents?: "auto" | "none" | "box-none" | "box-only" }) {
  const { height: kb } = useKeyboardState();
  const baseline = useRef(0); // أكبر ارتفاع للحاوية والكيبورد مقفول
  const [h, setH] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const nh = e.nativeEvent.layout.height;
    if (kb === 0 || nh > baseline.current) baseline.current = nh;
    setH(nh);
  };

  let pad = 0;
  if (Platform.OS !== "web" && kb > 0) {
    if (Platform.OS === "ios") {
      pad = iosPadding ? kb : 0;
    } else {
      const resizedBySystem = baseline.current > 0 && h < baseline.current - kb * 0.5;
      pad = resizedBySystem ? 0 : kb;
    }
  }

  const extra: ViewStyle | null = !pad ? null
    : mode === "padding" ? { paddingBottom: pad }
    : { transform: [{ translateY: -(mode === "center" ? pad / 2 : pad) }] };

  return (
    <View style={[style, extra]} onLayout={onLayout} pointerEvents={pointerEvents}>
      {children}
    </View>
  );
}
