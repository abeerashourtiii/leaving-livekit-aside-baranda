import { openExternalUrl } from "./linking";

// ↔ K5: نافذة الخريطة المحلية (WebView) كانت بـ originWhitelist=["*"] بلا onShouldStartLoadWithRequest، فالضغط على رابط «© OpenStreetMap contributors» أو
//   «Leaflet» فى شريط النسبة كان ينقل الـ WebView نفسه لموقع خارجى (تضيع الخريطة ولا رجوع). الآن أى تنقل غير صفحة الخريطة المحلية يُرفض داخل
//   الـ WebView ويُفتح فى المتصفح الخارجى عبر المنقّى الموحّد (lib/linking.ts: https/tel/mailto فقط). (بلاطات الخريطة وسكربت Leaflet موارد فرعية ولا
//   تمر من هنا.) أبقينا originWhitelist=["*"] عمدًا: التقليص يجعل RN-WebView يفتح الروابط بـ Linking.openURL الخام، فنتجاوز المنقّى.
export function onShouldStartMapRequest(request: { url: string }): boolean {
  const url = request.url ?? "";
  if (url === "about:blank" || url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:")) return true;
  openExternalUrl(url);
  return false;
}
