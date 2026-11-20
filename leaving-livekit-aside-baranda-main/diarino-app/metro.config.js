// Metro config (Expo). الإعداد الافتراضى كما هو، مع إضافة واحدة لبناء الويب فقط (H6):
//   asset plugin يضع الأصول المضمّنة تحت /media بدل /assets/assets (شوف scripts/metro-asset-plugin.js) بدل تعديل ملف JS بعد البناء.
//   يُفعَّل بالمتغير SHAHIR_WEB_BUILD=1 (يضبطه scripts/build-web.mjs — يعمل على ويندوز/ماك/لينكس). بدونه (تطوير، أندرويد، آيفون، EAS) لا شيء يتغيّر.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

if (process.env.SHAHIR_WEB_BUILD === "1") {
  // نُبقى plugins الافتراضية (مثل expo-asset/tools/hashAssetFiles التى تضيف hash لأسماء الملفات) ونضيف plugin بعدها.
  config.transformer = {
    ...config.transformer,
    assetPlugins: [...(config.transformer?.assetPlugins ?? []), require.resolve("./scripts/metro-asset-plugin.js")],
  };
}

module.exports = config;
