import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

// ↔ حالة لوحة المفاتيح لموبايل (على الويب مفيش أحداث كيبورد، فبترجع visible=false دايمًا).
//  • visible: لوحة المفاتيح ظاهرة (الشاشة بتتضغط لتناسب الكيبورد فى أندرويد/آيفون).
//  • inset: الارتفاع اللى لازم نطرحه من اللوحة السفلية — على آيفون الكيبورد بيغطّى الشاشة (من غير resize) فنرفع اللوحة بمقداره؛
//    على أندرويد (adjustResize) نافذة التطبيق نفسها بتصغر فمفيش حاجة نطرحها.
export function useKeyboardState(): { visible: boolean; inset: number } {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return { visible: height > 0, inset: Platform.OS === "ios" ? height : 0 };
}
