// ↔ إعدادات «فتح فى التطبيق» لروابط المشاركة (https://baranda.shop/property/<id>/reel، /seller/<id>، /compare?ids=…) على نسخة الويب.
// الاستضافة: Cloudflare Pages (docs/cloudflare-setup.md). لما التطبيق ينزل المتاجر: حطّ الرابطين تحت فيظهروا فى الرسالة.
export const ANDROID_PACKAGE = "com.diarino.app";
export const APP_URL_SCHEME = "diarino"; // app.json ← scheme

// TODO: روابط المتاجر بعد النشر، مثال:
//   PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.diarino.app"
//   APP_STORE_URL  = "https://apps.apple.com/app/id0000000000"
export const PLAY_STORE_URL = "";
export const APP_STORE_URL = "";

// المسارات اللى بتظهر لها رسالة «هل تريد المتابعة من التطبيق؟» على متصفح الموبايل.
export const OPEN_IN_APP_PATHS = /^\/(property|seller|compare)(\/|$)/;
export const WEB_CHOICE_HOURS = 24; // اختيار «المتابعة على الويب» بيتفتكر المدة دى على نفس المتصفح
