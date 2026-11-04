import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

// ↔ حالة لوحة المفاتيح لموبايل (على الويب مفيش أحداث كيبورد، فبترجع visible=false دايمًا).
//  • visible: لوحة المفاتيح ظاهرة.
//  • height: ارتفاع لوحة المفاتيح الفعلى.
//  • inset: المقدار اللى لازم نرفع به أى لوحة/حقل مثبّت أسفل الشاشة عشان يفضل ظاهر فوق الكيبورد. بقى = height على أندرويد وآيفون:
//    آيفون: الكيبورد بيغطّى الشاشة من غير resize. أندرويد: سواء النافذة اتصغّرت (adjustResize) أو لأ (أندرويد 15 edge-to-edge)،
//    كارت الريل ارتفاعه ثابت (ارتفاع الشاشة) فالجزء السفلى منه — وفيه مربع كتابة التعليق — بيبقى ورا الكيبورد فى الحالتين.
export function useKeyboardState(): { visible: boolean; height: number; inset: number } {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return { visible: height > 0, height, inset: height };
}
