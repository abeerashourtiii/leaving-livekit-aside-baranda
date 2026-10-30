// يولّد الصفحة الموحدة للشروط والأحكام وسياسات الاستخدام (public/terms/index.html) من data/policies.ts
// (المصدر الوحيد للنصوص — نفس النصوص المعروضة داخل التطبيق).
//
// الاستخدام:   npm run build:terms      (شغّله بعد أى تعديل فى data/policies.ts وقبل `npx expo export --platform web`)
// النشر:       مجلد public/ بيتنسخ تلقائيًا لجذر dist عند `npx expo export --platform web`، فتظهر الصفحة على https://baranda.shop/terms
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let src = readFileSync(resolve(root, "data/policies.ts"), "utf8");

// تحويل ملف TypeScript البسيط لـ JavaScript قابل للتنفيذ (بدون الأنواع والـ export).
src = src
  .replace(/^export type [^\n]*\n/gm, "")
  .replace(/^export function isPolicyKey[\s\S]*$/m, "")
  .replace(/^export const (\w+)\s*:[^=\n]+=/gm, "const $1 =")
  .replace(/^export const /gm, "const ");
const { POLICIES, POLICY_KEYS, POLICIES_VERSION, TERMS_URL } = new Function(
  `${src}\nreturn { POLICIES, POLICY_KEYS, POLICIES_VERSION, TERMS_URL };`
)();

const ORDINALS = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن"];
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// روابط https داخل النص تتحول لروابط قابلة للضغط.
const linkify = (t) => esc(t).replace(/(https:\/\/[^\s)،.]+(?:\.[^\s)،.]+)*)/g, '<a href="$1">$1</a>');

function renderBody(body) {
  let html = "";
  let inList = false;
  for (const p of body) {
    const bullet = p.startsWith("• ");
    if (inList && !bullet) { html += "</ul>"; inList = false; }
    if (p.startsWith("## ")) html += `<h3>${esc(p.slice(3))}</h3>`;
    else if (bullet) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${linkify(p.slice(2))}</li>`; }
    else html += `<p>${linkify(p)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

const toc = POLICY_KEYS.map((k, i) => `<li><a href="#${k}">القسم ${ORDINALS[i]}: ${esc(POLICIES[k].title)}</a></li>`).join("");
const sections = POLICY_KEYS.map((k, i) =>
  `<section id="${k}"><h2><span class="num">القسم ${ORDINALS[i]}</span>${esc(POLICIES[k].title)}</h2>${renderBody(POLICIES[k].body)}</section>`
).join("\n");

const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>الشروط والأحكام وسياسات الاستخدام — باراندا</title>
<meta name="description" content="الشروط والأحكام وسياسات الاستخدام لتطبيق باراندا: شروط الاستخدام، الخصوصية والأمان، البيع والرسوم، نشر الصور والفيديو، حقوق النشر والملكية الفكرية.">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${TERMS_URL}">
<style>
:root{--bg:#f6f4ee;--card:#fff;--text:#1d2a24;--sub:#5b6b63;--green:#22a652;--line:#e3e0d6}
@media (prefers-color-scheme:dark){:root{--bg:#121714;--card:#1b231e;--text:#e9efe9;--sub:#9db0a4;--line:#2b3a31}}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:16px}
body{margin:0;background:var(--bg);color:var(--text);font-family:"Segoe UI",Tahoma,"Noto Naskh Arabic","Noto Sans Arabic",Arial,sans-serif;line-height:1.95;font-size:16px;-webkit-text-size-adjust:100%}
.wrap{max-width:860px;margin:0 auto;padding:20px 16px 56px}
header{padding:28px 0 8px;text-align:center}
header h1{margin:0 0 6px;font-size:1.6rem;line-height:1.5}
header p{margin:0;color:var(--sub);font-size:.92rem}
nav,section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-top:18px}
nav h2{margin:0 0 6px;font-size:1.05rem}
nav ul{margin:0;padding:0 18px 0 0}
nav li{margin:2px 0}
a{color:var(--green);font-weight:700;word-break:break-word}
section h2{margin:0 0 10px;font-size:1.3rem;line-height:1.6;color:var(--green);border-bottom:2px solid var(--line);padding-bottom:8px}
section h2 .num{display:block;font-size:.8rem;color:var(--sub);font-weight:600}
h3{margin:22px 0 4px;font-size:1.05rem;line-height:1.7}
p{margin:6px 0}
ul{margin:6px 0;padding:0 20px 0 0}
li{margin:5px 0}
footer{margin-top:22px;text-align:center;color:var(--sub);font-size:.85rem}
.top{display:inline-block;margin-top:10px;font-size:.85rem}
@media print{nav,.top{display:none}section{border:0;padding:0}}
</style>
</head>
<body>
<div class="wrap">
<header>
<h1>الشروط والأحكام وسياسات الاستخدام</h1>
<p>تطبيق باراندا — الإصدار ${esc(POLICIES_VERSION)}</p>
</header>
<nav aria-label="فهرس الأقسام"><h2>الأقسام</h2><ul>${toc}</ul></nav>
${sections}
<footer>الإصدار ${esc(POLICIES_VERSION)} — ${esc(TERMS_URL)}<br><a class="top" href="#">العودة لأعلى الصفحة</a></footer>
</div>
</body>
</html>
`;

const out = resolve(root, "public/terms/index.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html, "utf8");
console.log(`✓ ${out} (${POLICY_KEYS.length} أقسام، إصدار ${POLICIES_VERSION})`);
