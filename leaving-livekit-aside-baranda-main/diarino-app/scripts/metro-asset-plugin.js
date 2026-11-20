// ↔ H6: Metro asset plugin (نقطة التوسعة الرسمية لـ Metro: transformer.assetPlugins) — يغيّر `httpServerLocation` للأصول المضمّنة وقت البناء.
//   قبل: expo export يُخرج ملفات الأصول المضمّنة (صور/صوت/فيديو القائمة والدخول والإقلاع) تحت `/assets/assets/*` — مسار + كاش immutable سنة يجعل أى
//   استجابة خاطئة قديمة تبقى فى المتصفح/الحافة، وبعض الإضافات تعامل `/assets/` بشكل خاص — وكان scripts/postbuild-web.mjs يستبدل النص
//   "/assets/assets/" → "/media/" *داخل ملف JS المبنى* ثم يعيد تسميته بـ md5 جديد (هش، ويكسر أى source map).
//   الآن: المسار الصحيح يُنتَج من المصدر مباشرة (`/media/...`)، فلا يُعدَّل أى ملف JS بعد البناء ولا يتغيّر اسمه (الـ source maps سليمة).
//   • أصول التطبيق: /assets/assets/<dir>  ⇒  /media/<dir>   (نفس الشكل الذى كان ينتجه postbuild بالضبط، فلا تتغيّر قواعد _headers ولا المسارات المنشورة).
//   • أصول المكتبات (/assets/node_modules/...) لا تُمَسّ.
//   يُفعَّل فقط لبناء الويب (metro.config.js: SHAHIR_WEB_BUILD=1 من scripts/build-web.mjs) — بنية أندرويد/آيفون/APK لا تتأثر إطلاقًا.
const APP_ASSETS_PREFIX = "/assets/assets";
const WEB_MEDIA_PREFIX = "/media";

function rewriteHttpServerLocation(location) {
  if (typeof location !== "string") return location;
  if (location === APP_ASSETS_PREFIX || location.startsWith(`${APP_ASSETS_PREFIX}/`)) {
    return WEB_MEDIA_PREFIX + location.slice(APP_ASSETS_PREFIX.length);
  }
  return location;
}

module.exports = function shahirWebAssetPath(assetData) {
  assetData.httpServerLocation = rewriteHttpServerLocation(assetData.httpServerLocation);
  return assetData;
};
module.exports.rewriteHttpServerLocation = rewriteHttpServerLocation;
