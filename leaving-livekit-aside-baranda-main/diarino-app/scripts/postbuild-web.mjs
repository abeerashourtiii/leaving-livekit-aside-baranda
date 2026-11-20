// يُشغَّل تلقائيًا بعد `expo export --platform web` (انظر build:web فى package.json):
// يحقن وسوم المعاينة الافتراضية للموقع (Open Graph / Twitter / description) فى dist/index.html
// لتظهر لأى رابط من shahir.site غير روابط الإعلانات (روابط الإعلان لها وسوم خاصة تحقنها
// Cloudflare Pages Function: ../functions/property/[[path]].js).
// ثم يتحقق من مسارات الأصول (/media) — لا يعدّل ملفات JS (H6؛ التفاصيل فى القسم الأخير من هذا الملف).
// شغّله دائمًا عبر `npm run build:web` (scripts/build-web.mjs) وليس يدويًا ولا بـ `expo export` وحدها: الـ asset plugin الخاص بالويب لا يُفعَّل إلا هناك.
import { readFileSync, writeFileSync, existsSync, renameSync, readdirSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// POSTBUILD_ROOT: لتجربة السكربت على مجلد dist تجريبى (الاختبارات). الافتراضى: جذر التطبيق.
const root = process.env.POSTBUILD_ROOT ? resolve(process.env.POSTBUILD_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, "dist/index.html");
if (!existsSync(file)) { console.error("dist/index.html غير موجود — شغّل expo export أولًا"); process.exit(1); }

const TITLE = "Shahir — عقارات للبيع والإيجار";
const DESC = "Shahir منصة عقارية لعرض العقارات للبيع والإيجار بالفيديو والتواصل المباشر بين الباحثين عن العقار والمُعلنين.";
const IMG = "https://shahir.site/og-default.jpg";
const block = [
  `<meta name="description" content="${DESC}" />`,
  `<meta property="og:site_name" content="Shahir" />`,
  `<meta property="og:type" content="website" />`,
  `<meta property="og:locale" content="ar_EG" />`,
  `<meta property="og:url" content="https://shahir.site/" />`,
  `<meta property="og:title" content="${TITLE}" />`,
  `<meta property="og:description" content="${DESC}" />`,
  `<meta property="og:image" content="${IMG}" />`,
  `<meta property="og:image:width" content="1200" />`,
  `<meta property="og:image:height" content="630" />`,
  `<meta name="twitter:card" content="summary_large_image" />`,
  `<meta name="twitter:title" content="${TITLE}" />`,
  `<meta name="twitter:description" content="${DESC}" />`,
  `<meta name="twitter:image" content="${IMG}" />`,
].join("\n    ");

// أيقونات الويب بالهوية الجديدة: favicon.ico يُنشأ من assets/favicon.png عند expo export، ونضيف PNG 32 وأيقونة iOS (apple-touch-icon) من public/.
const links = [
  `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />`,
  `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />`,
  `<meta name="theme-color" content="#72904A" />`,
].join("\n    ");

let html = readFileSync(file, "utf8");
html = html
  .replace(/<link\s+[^>]*rel=["'](?:icon|apple-touch-icon)["'][^>]*>\s*/gi, "")
  .replace(/<meta\s+name=["']theme-color["'][^>]*>\s*/gi, "")
  .replace(/<meta\s+[^>]*(?:name|property)=["'](?:description|og:[^"']*|twitter:[^"']*)["'][^>]*>\s*/gi, "")
  .replace(/<title>[\s\S]*?<\/title>/i, `<title>${TITLE}</title>`)
  .replace(/<\/head>/i, `    ${block}\n    ${links}\n  </head>`);
writeFileSync(file, html);
console.log("✓ وسوم المعاينة الافتراضية أُضيفت إلى dist/index.html");

// ─────────────────────────────────────────────────────────────────────────────
// الأصول المضمّنة (صور/صوت/فيديو القائمة والدخول والإقلاع) — H6:
// كان هذا السكربت يستبدل النص "/assets/assets/" ← "/media/" *داخل ملف JS المبنى* ثم يعيد تسميته بـ md5 جديد (هش؛ يكسر أى source map ويعتمد على
// نص محدد فى الناتج). الآن المسار الصحيح (/media/...) يُنتَج من المصدر عبر Metro asset plugin (scripts/metro-asset-plugin.js، مفعّل لبناء
// الويب فقط من metro.config.js) فلا يُعدَّل أى ملف JS هنا ولا يتغيّر اسمه. هذا القسم صار تحققًا فقط:
//   1) لو Expo أخرج ملفات الأصول فى dist/assets/assets (لم يعكس المسار الجديد) ننقل *المجلد* إلى dist/media (نقل ملفات، لا تعديل JS).
//   2) نفشل البناء بوضوح لو بقى فى JS أى مرجع "/assets/assets" (يعنى أن الـ plugin لم يُطبَّق) أو أشار مرجع /media إلى ملف/مجلد غير موجود.
// صمّام طوارئ مؤقت: LEGACY_ASSET_REWRITE=1 يعيد الاستبدال النصى القديم (احذفه بعد أول بناء ناجح بالطريقة الجديدة).
// ─────────────────────────────────────────────────────────────────────────────
const OLD_DIR = resolve(root, "dist/assets/assets");
const NEW_DIR = resolve(root, "dist/media");
const jsDir = resolve(root, "dist/_expo/static/js/web");

if (existsSync(OLD_DIR) && !existsSync(NEW_DIR)) {
  renameSync(OLD_DIR, NEW_DIR);
  console.warn("⚠ Expo أخرج الأصول فى dist/assets/assets؛ نُقل المجلد إلى dist/media (نقل ملفات فقط). راجع metro.config.js إن لم يكن متوقعًا.");
}

const jsFiles = existsSync(jsDir) ? readdirSync(jsDir).filter((n) => /^index-[0-9a-f]+\.js$/.test(n)) : [];
const errors = [];

if (process.env.LEGACY_ASSET_REWRITE === "1") {
  console.warn("⚠ LEGACY_ASSET_REWRITE=1: استبدال نصى قديم داخل ملف JS (مؤقت — يكسر source maps).");
  for (const name of jsFiles) {
    const path = resolve(jsDir, name);
    const patched = readFileSync(path, "utf8").split("/assets/assets/").join("/media/");
    const newName = `index-${createHash("md5").update(patched).digest("hex")}.js`;
    writeFileSync(resolve(jsDir, newName), patched);
    if (newName !== name) {
      rmSync(path);
      writeFileSync(file, readFileSync(file, "utf8").split(name).join(newName));
    }
    console.log(`✓ ${name} → ${newName} (legacy)`);
  }
} else {
  const hasFiles = (dir) => existsSync(dir) && statSync(dir).isDirectory() && readdirSync(dir).length > 0;
  for (const name of jsFiles) {
    const code = readFileSync(resolve(jsDir, name), "utf8");
    if (code.includes("/assets/assets")) {
      errors.push(`${name}: ما زال يحوى مرجع "/assets/assets" — الـ asset plugin لم يُطبَّق (تأكد أن البناء تم عبر \`npm run build:web\` وأن SHAHIR_WEB_BUILD=1 وصل إلى Metro).`);
    }
    // مواضع الأصول (httpServerLocation) تحت /media يجب أن يقابلها مجلد غير فارغ فى dist/media.
    for (const m of code.matchAll(/httpServerLocation["']?\s*[:=]\s*["'](\/media[^"']*)["']/g)) {
      const dir = resolve(root, "dist", "." + m[1]);
      if (!hasFiles(dir)) errors.push(`${name}: مجلد الأصول ${m[1]} غير موجود أو فارغ فى dist.`);
    }
    // مراجع كاملة لملفات (…/media/dir/file.hash.ext) يجب أن يكون الملف موجودًا.
    for (const m of code.matchAll(/["'`](\/media\/[^"'`\s?#]+\.[a-z0-9]{2,5})["'`]/gi)) {
      if (!existsSync(resolve(root, "dist", "." + m[1]))) errors.push(`${name}: الملف ${m[1]} غير موجود فى dist.`);
    }
    console.log(`✓ ${name}: مراجع الأصول متسقة (ملف JS لم يُعدَّل)`);
  }
  if (jsFiles.length === 0) errors.push("لم أجد حزمة JS فى dist/_expo/static/js/web.");
}

if (errors.length > 0) {
  console.error("✗ فشل التحقق من مسارات الأصول:\n  - " + [...new Set(errors)].join("\n  - "));
  process.exit(1);
}
