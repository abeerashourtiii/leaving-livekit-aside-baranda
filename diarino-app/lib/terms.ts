import { Platform, Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { router, type Href } from "expo-router";
import { TERMS_URL } from "../data/policies";

// ↔ فتح الصفحة الموحدة للشروط والأحكام وسياسات الاستخدام (https://baranda.shop/terms):
//  • الويب: تبويب جديد (window.open) — المستخدم يرجع لنموذج التسجيل زى ما هو.
//  • أندرويد/آيفون/APK: متصفح داخل التطبيق (Custom Tabs / SFSafariViewController) فيرجع المستخدم لنفس الشاشة بعد القراءة.
//  • لو تعذر الفتح (لا إنترنت/لا متصفح) نعرض نص الشروط المضمّن داخل التطبيق (app/policy/terms) بدل ما يحصل صمت.
export async function openTermsPage(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      // ملاحظة: مفيش "noopener" فى window.open لأنه بيرجّع null دايمًا (فنفتح تبويبين)؛ بنفصل opener يدويًا.
      const w = typeof window !== "undefined" ? window.open(TERMS_URL, "_blank") : null;
      if (w) { try { w.opener = null; } catch { /* ignore */ } return; }
      await Linking.openURL(TERMS_URL);
      return;
    }
    await WebBrowser.openBrowserAsync(TERMS_URL);
  } catch {
    try {
      await Linking.openURL(TERMS_URL);
    } catch {
      router.push("/policy/terms" as Href);
    }
  }
}
