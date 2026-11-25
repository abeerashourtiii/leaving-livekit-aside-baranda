// ↔ PiP (أندرويد): من غير smallestScreenSize فى android:configChanges بيعيد النظام إنشاء الـ MainActivity عند الدخول فى نافذة PiP
//   والخروج منها (تتغيّر أصغر أبعاد الشاشة) فيُعاد بناء شاشة React كلها: القائمة ترجع لأول ريل ويضيع موضع التشغيل. إضافة القيمة تخلّى
//   الـ Activity تفضل حيّة وتستقبل التغيير فقط (onConfigurationChanged). ملف android/app/src/main/AndroidManifest.xml المُدرَج فى
//   المستودع عُدِّل مباشرة كذلك؛ الـ plugin ده يحافظ على نفس القيمة لو اتعمل expo prebuild من جديد (idempotent).
const { withAndroidManifest } = require("expo/config-plugins");

const REQUIRED = ["keyboard", "keyboardHidden", "orientation", "screenSize", "smallestScreenSize", "screenLayout", "uiMode"];

module.exports = function withPiPConfigChanges(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const activity = app?.activity?.find((a) => a.$["android:name"] === ".MainActivity");
    if (activity) {
      const current = String(activity.$["android:configChanges"] || "").split("|").filter(Boolean);
      activity.$["android:configChanges"] = [...new Set([...current, ...REQUIRED])].join("|");
    }
    return cfg;
  });
};
