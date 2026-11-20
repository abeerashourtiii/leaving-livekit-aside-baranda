// قياس تغطية ترجمة الإنجليزية (M4): يستخرج كل نصوص t("...") العربية الثابتة من الكود ويقارنها بالقاموسين (مطابقة تامة فقط، كما يعمل translate()).
// الاستخدام:  node --experimental-strip-types scripts/i18n-coverage.mjs [--list] [--phase=أ|ب|ج|د] [--json]
//   --list   يطبع قائمة النصوص المفقودة (مجمّعة بالمرحلة ثم الملف)
//   --phase  يقصر القائمة على مرحلة واحدة
// يفشل (رمز خروج 1) إذا نزلت التغطية الكلية أو تغطية أى مرحلة عن العتبة فى scripts/i18n-coverage.config.json.
// لوحة الأدمن (app/admin و components/admin) خارج القياس: تبقى بالعربية فقط. النصوص الديناميكية (قالب `${}` أو متغيّر) لا تُستخرج — حدّ معروف.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
const wantList = args.includes("--list");
const wantJson = args.includes("--json");
const onlyPhase = args.find((a) => a.startsWith("--phase="))?.slice(8);

const { I18N_DICT } = await import(join(ROOT, "data", "i18n-dict.ts"));
const { I18N_EXACT } = await import(join(ROOT, "data", "i18n-exact.ts"));
const known = new Set([...Object.keys(I18N_DICT), ...Object.keys(I18N_EXACT)]);

const SCAN_DIRS = ["app", "components", "lib"];
const isAdmin = (rel) => /(^|\/)admin(\/|$)/.test(rel) || /(^|\/)Admin[A-Za-z]*\.tsx?$/.test(rel);
const ARABIC = /[\u0600-\u06FF]/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

// المرحلة (بحسب أولوية المنتج): أ الدخول والتسجيل والبداية | ب الفيد والبحث وتفاصيل العقار | ج الشات والعروض والنشر | د الحساب والإعدادات والفواتير والإشعارات
function phaseOf(rel) {
  const r = rel.toLowerCase();
  if (/(auth|login|signup|sign-in|onboard|launch|consent|welcome|reset-password|guestlogin|permissiongate|profilesession|phone)/.test(r)) return "أ";
  if (/^app\/chat|^app\/offers|^app\/publish|components\/(publish|requests|live)|^app\/live|^app\/\(tabs\)\/requests|chat|offer|^app\/compare$/.test(r)) return "ج";
  if (/^app\/\(tabs\)\/(index|search)|^app\/property|^app\/seller|components\/(reel|search|property)|^app\/compare|^app\/index/.test(r)) return "ب";
  return "د";
}

const STR = /\bt\(\s*(["'`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1\s*[,)]/g;
const found = new Map(); // text -> { files:Set, phase }
for (const dir of SCAN_DIRS) {
  const base = join(ROOT, dir);
  if (!existsSync(base)) continue;
  for (const file of walk(base)) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (isAdmin(rel)) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(STR)) {
      const quote = m[1];
      let text = m[2];
      if (quote === "`" && text.includes("${")) continue;
      text = text.replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n");
      if (!ARABIC.test(text)) continue;
      const entry = found.get(text) ?? { files: new Set(), phase: phaseOf(rel) };
      entry.files.add(rel);
      found.set(text, entry);
    }
  }
}

const phases = { "أ": { total: 0, covered: 0 }, "ب": { total: 0, covered: 0 }, "ج": { total: 0, covered: 0 }, "د": { total: 0, covered: 0 } };
const missing = [];
for (const [text, { files, phase }] of found) {
  phases[phase].total++;
  if (known.has(text)) phases[phase].covered++;
  else missing.push({ text, phase, files: [...files].sort() });
}
const total = found.size;
const covered = total - missing.length;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 100);

const cfgPath = join(ROOT, "scripts", "i18n-coverage.config.json");
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : { minOverall: 0, minPhase: {} };

const summary = {
  total, covered, percent: pct(covered, total),
  phases: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, { ...v, percent: pct(v.covered, v.total) }])),
  dictionaryKeys: known.size,
};

if (wantJson) {
  console.log(JSON.stringify({ summary, missing }, null, 2));
} else {
  console.log(`نصوص t() العربية المختلفة (بدون لوحة الأدمن): ${total} — مغطّاة بترجمة مطابقة: ${covered} (${summary.percent}%) — مفتاح فى القاموسين: ${known.size}`);
  console.table(Object.fromEntries(Object.entries(summary.phases).map(([k, v]) => [`المرحلة ${k}`, { الإجمالى: v.total, مغطّى: v.covered, المفقود: v.total - v.covered, "التغطية %": v.percent, "العتبة %": cfg.minPhase?.[k] ?? "-" }])));
  if (wantList) {
    const list = missing.filter((m) => !onlyPhase || m.phase === onlyPhase).sort((a, b) => a.phase.localeCompare(b.phase) || a.files[0].localeCompare(b.files[0]));
    let last = "";
    for (const m of list) {
      const head = `[${m.phase}] ${m.files[0]}`;
      if (head !== last) { console.log(`\n${head}`); last = head; }
      console.log(`  - ${m.text.replace(/\n/g, "\\n")}`);
    }
  }
}

const failures = [];
if (summary.percent < (cfg.minOverall ?? 0)) failures.push(`التغطية الكلية ${summary.percent}% أقل من العتبة ${cfg.minOverall}%`);
for (const [k, v] of Object.entries(summary.phases)) {
  const min = cfg.minPhase?.[k];
  if (typeof min === "number" && v.percent < min) failures.push(`المرحلة ${k}: ${v.percent}% أقل من العتبة ${min}%`);
}
if (failures.length) {
  console.error("✗ فشل اختبار تغطية الترجمة:\n  " + failures.join("\n  "));
  process.exit(1);
}
if (!wantJson) console.log("✓ التغطية ≥ العتبات المتفق عليها.");
