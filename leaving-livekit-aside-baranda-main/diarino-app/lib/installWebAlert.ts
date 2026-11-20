import { Alert, Platform } from "react-native";
import { pushDialog, DialogButton, DialogOptions } from "./dialogStore";

// ↔ يُستورد مرة واحدة من app/_layout.tsx (side-effect). على الويب فقط: يستبدل Alert.alert الفارغة (react-native-web) بمودال حقيقى
//   (AlertHost) — فتشتغل كل استدعاءات Alert.alert فى المشروع (92 استدعاء) بدون تعديل كل ملف: أزرار التأكيد والرسائل.
//   على أندرويد/آيفون/APK لا يتغيّر شيء.
if (Platform.OS === "web") {
  (Alert as unknown as { alert: (title: string, message?: string, buttons?: DialogButton[], options?: DialogOptions) => void }).alert = (
    title,
    message,
    buttons,
    options,
  ) => pushDialog(title, message, buttons, options);
}
