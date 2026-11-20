// ↔ بيتشغّل بعد patch-package (postinstall): يتأكد إن تعديل expo-video الخاص بالصورة العائمة (PiP) اتطبّق فعلًا على أندرويد.
// بدون التعديل: نافذة PiP بتعرض واجهة التطبيق كلها مصغّرة (أزرار الريل ظاهرة) والفيديو ممكن يقف، لأن expo-video الأصلى بيجرّب
// يعرض كل مشغّلات الفيديو المحمّلة (الريل النشط ± 3) مع بعض. التعديل: patches/expo-video+2.0.6.patch.
// لو فشل: شغّل `npx patch-package` وشوف الخطأ (غالبًا نسخة expo-video اتغيّرت عن 2.0.6 فلازم يتجدّد الـ patch).
import { existsSync, readFileSync } from "node:fs";

const dir = "node_modules/expo-video";
if (!existsSync(dir)) process.exit(0); // مش متثبّتة (مثلًا بيئة بدون الحزمة) — مفيش حاجة نفحصها
const marker = `${dir}/android/src/main/java/expo/modules/video/PiPSessionFragment.kt`;
let version = "?";
try { version = JSON.parse(readFileSync(`${dir}/package.json`, "utf8")).version; } catch { /* تجاهل */ }
if (!existsSync(marker)) {
  console.error(
    `\n✖ تعديل الصورة العائمة (PiP) لـ expo-video غير مطبّق (النسخة المثبّتة ${version}، المطلوب 2.0.6).\n` +
      `  شغّل: npx patch-package   ثم أعد المحاولة. بدونه لن تعمل نافذة PiP بشكل صحيح على أندرويد/APK.\n`
  );
  process.exit(1);
}
console.log(`✓ تعديل PiP لـ expo-video مطبّق (النسخة ${version}).`);
