// ↔ C8 (iOS): expo-location (SDK 52) يضيف دائمًا مفتاحَى NSLocationAlwaysUsageDescription / NSLocationAlwaysAndWhenInUseUsageDescription بنص إنجليزى
//   عام، والتطبيق يحتاج «أثناء الاستخدام» فقط (عرض العقارات القريبة/تحديد موقع الإعلان) — وجود «Always» بلا استخدام خلفى خطر على مراجعة آبل.
//   هذا الـ plugin يحذف المفتاحين بعد expo-location. الترتيب: الـ mods تُنفَّذ بترتيب عكسى للتسجيل، فنسجّله فى app.json قبل expo-location
//   (وبعده أيضًا احتياطًا — الحذف idempotent). ملف ios/Baranda/Info.plist المُدرَج فى المستودع عُدِّل مباشرة كذلك.
const { withInfoPlist } = require("expo/config-plugins");

module.exports = function withWhenInUseLocationOnly(config) {
  return withInfoPlist(config, (cfg) => {
    delete cfg.modResults.NSLocationAlwaysUsageDescription;
    delete cfg.modResults.NSLocationAlwaysAndWhenInUseUsageDescription;
    return cfg;
  });
};
