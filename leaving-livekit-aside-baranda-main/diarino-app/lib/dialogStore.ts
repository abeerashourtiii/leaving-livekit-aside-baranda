// ↔ مخزن مودال التنبيه/التأكيد الموحّد (للويب). Alert.alert فى react-native-web (0.19.x) دالة فارغة: أى زر تأكيد أو رسالة
//   خطأ تعتمد عليها كانت «لا تفعل شيئًا» على نسخة الويب (ترقية/إلغاء أدمن، إلغاء صفقة، تحقق نموذج النشر…).
//   lib/installWebAlert.ts بيستبدلها على الويب بهذا المخزن، وcomponents/shared/AlertHost.tsx بيعرضه. أندرويد وآيفون يستخدمان
//   Alert الأصلى كما هو بدون أى تغيير.
export type DialogButton = { text?: string; onPress?: (value?: string) => void; style?: "default" | "cancel" | "destructive" };
export type DialogOptions = { cancelable?: boolean; onDismiss?: () => void };
export type DialogRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: DialogButton[];
  options?: DialogOptions;
};

let counter = 0;
let queue: DialogRequest[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribeDialogs(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
/** الحوار الظاهر الآن (الأول فى الطابور). المرجع ثابت بين التغييرات فيصلح لـ useSyncExternalStore. */
export function getCurrentDialog(): DialogRequest | null {
  return queue[0] ?? null;
}

export function pushDialog(title: string, message?: string, buttons?: DialogButton[], options?: DialogOptions) {
  queue = [...queue, { id: ++counter, title: title ?? "", message, buttons: buttons && buttons.length ? buttons : [{ text: "OK" }], options }];
  emit();
}

/** يغلق الحوار الحالى ثم ينفّذ onPress الخاص بالزر (بعد الإغلاق، كما يفعل Alert الأصلى). */
export function resolveDialog(id: number, button?: DialogButton) {
  const current = queue[0];
  if (!current || current.id !== id) return;
  queue = queue.slice(1);
  emit();
  try {
    if (button) button.onPress?.();
    else current.options?.onDismiss?.();
  } catch (err) {
    console.warn("dialog handler failed:", err);
  }
}
