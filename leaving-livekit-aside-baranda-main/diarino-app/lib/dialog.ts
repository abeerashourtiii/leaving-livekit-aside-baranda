import { Alert } from "react-native";

// ↔ واجهة موحّدة للتأكيد/التنبيه (للكود الجديد): تعمل على أندرويد وآيفون (Alert الأصلى) وعلى الويب (مودال AlertHost عبر
//   lib/installWebAlert.ts). للكود القديم يكفى Alert.alert نفسه — بعد التركيب بيشتغل على الويب كمان.
export function confirmDialog(
  title: string,
  message: string,
  opts: { confirmText: string; cancelText: string; destructive?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: opts.cancelText, style: "cancel", onPress: () => resolve(false) },
        { text: opts.confirmText, style: opts.destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function alertDialog(title: string, message?: string): Promise<void> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [{ text: "OK", onPress: () => resolve() }], { onDismiss: () => resolve() });
  });
}
