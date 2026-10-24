import { Redirect } from "expo-router";

// ↔ صندوق المحادثات القديم اتدمج فى صفحة «العروض» (/offers): كل المحادثات الآن محادثات عروض (على ريلز أو طلبات) مقسّمة وبالأحدث أولًا.
// الروابط القديمة لـ /chat بتتحوّل هنا تلقائيًا (أندرويد/آيفون/الويب/APK).
export default function ChatIndexRedirect() {
  return <Redirect href="/offers" />;
}
