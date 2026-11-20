// اختبارات وحدة سريعة للمنطق الصرف (بلا حزم ولا شبكة ولا قاعدة بيانات):
//   adminValidation (A4/A5) · appVersion (الحد الأدنى للإصدار) · videoBuffer (D1) · arabicText (M5)
// الاستخدام:  node --experimental-strip-types scripts/test-units.mjs      (أو: npm run test:units)
// ملاحظة تقنية: ملفات lib تستورد بعضها بلا امتداد (أسلوب TypeScript)، وNode يحتاج الامتداد، فتُنسخ هنا إلى مجلد مؤقت بعد إضافة .ts
//   للاستيرادات النسبية فقط — دون تعديل المصدر.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "shahir-units-"));
const FILES = ["numberInput", "adminValidation", "appVersion", "videoBuffer", "arabicText"];
for (const f of FILES) {
  const src = readFileSync(join(root, "lib", `${f}.ts`), "utf8").replace(/(from\s+["'])(\.\/[^"']+?)(["'])/g, (m, a, p, c) => (p.endsWith(".ts") ? m : `${a}${p}.ts${c}`));
  writeFileSync(join(tmp, `${f}.ts`), src, "utf8");
}
const load = (f) => import(pathToFileURL(join(tmp, `${f}.ts`)).href);
const { parseAdminInt, parseAdminMoney, parseAdminDate, validateSponsoredTargeting: v } = await load("adminValidation");
const { isBelowMinVersion, compareVersions, parseVersion } = await load("appVersion");
const { applyReelBufferOptions, ACTIVE_FORWARD_BUFFER_SEC, NEIGHBOR_FORWARD_BUFFER_SEC } = await load("videoBuffer");
const { normalizeArabic, includesNormalized, dedupeNormalized } = await load("arabicText");

let pass = 0;
const failed = [];
const t = (name, cond) => { if (cond) pass++; else failed.push(name); };
const TODAY = "2026-11-16";

// A5: أعداد/مبالغ
t("blank int => null", parseAdminInt("", 1, 10) === null && parseAdminInt("  ", 1, 10) === null);
t("0 rejected when min 1", parseAdminInt("0", 1, 10) === null);
t("decimal rejected", parseAdminInt("2.5", 1, 10) === null);
t("arabic digits ok", parseAdminInt("٧", 1, 10) === 7);
t("out of range", parseAdminInt("91", 1, 90) === null);
t("money blank null", parseAdminMoney("") === null);
t("money 0 is 0 (UI must confirm)", parseAdminMoney("0") === 0);
t("money negative/garbage null", parseAdminMoney("-5") === null && parseAdminMoney("abc") === null);
// تواريخ
t("date ok", parseAdminDate("2026-12-31") === "2026-12-31");
t("date arabic digits", parseAdminDate("٢٠٢٦-١٢-٣١") === "2026-12-31");
t("date invalid day", parseAdminDate("2026-02-30") === null);
t("date bad format", parseAdminDate("31/12/2026") === null && parseAdminDate("") === null);
// A4: الريل المميز
t("no limit rejected (no reach, no end date)", v({ reach: "", ageMin: "", ageMax: "", endDate: "" }, TODAY).ok === false);
t("reach only ok", JSON.stringify(v({ reach: "500", ageMin: "", ageMax: "" }, TODAY)) === '{"ok":true,"reachGoal":500}');
t("end date only ok", JSON.stringify(v({ reach: "", ageMin: "", ageMax: "", endDate: "2026-12-01" }, TODAY)) === '{"ok":true,"endDate":"2026-12-01"}');
t("end date today ok", v({ reach: "", ageMin: "", ageMax: "", endDate: TODAY }, TODAY).ok === true);
t("end date past rejected", v({ reach: "", ageMin: "", ageMax: "", endDate: "2026-11-15" }, TODAY).ok === false);
t("end date garbage rejected", v({ reach: "100", ageMin: "", ageMax: "", endDate: "soon" }, TODAY).ok === false);
t("reach 0 rejected", v({ reach: "0", ageMin: "", ageMax: "", endDate: "2026-12-01" }, TODAY).ok === false);
t("age 17 rejected", v({ reach: "10", ageMin: "17", ageMax: "" }, TODAY).ok === false);
t("min>max rejected", v({ reach: "10", ageMin: "40", ageMax: "30" }, TODAY).ok === false);
t("valid combo", JSON.stringify(v({ reach: "500", ageMin: "25", ageMax: "40", endDate: "2026-12-31" }, TODAY)) === '{"ok":true,"reachGoal":500,"ageMin":25,"ageMax":40,"endDate":"2026-12-31"}');
// الحد الأدنى للإصدار
t("1.0.0 < 1.1.0", isBelowMinVersion("1.0.0", "1.1.0"));
t("equal not below", !isBelowMinVersion("1.1.0", "1.1.0"));
t("1.10.0 not below 1.9.0", !isBelowMinVersion("1.10.0", "1.9.0"));
t("2 vs 1.9.9", !isBelowMinVersion("2", "1.9.9"));
t("0.0.0 => no block", !isBelowMinVersion("1.0.0", "0.0.0"));
t("garbage => no block", !isBelowMinVersion("abc", "1.0.0") && !isBelowMinVersion("1.0.0", "x.y") && !isBelowMinVersion(null, "1.0.0"));
t("parse short", JSON.stringify(parseVersion("1.2")) === "[1,2,0]" && compareVersions("1.0.0", "1.0.1") === -1);
// D1: التخزين المسبق
{
  const p = { bufferOptions: { waitsToMinimizeStalling: true } };
  t("active => 11s & keeps other fields", applyReelBufferOptions(p, true) === true && p.bufferOptions.preferredForwardBufferDuration === ACTIVE_FORWARD_BUFFER_SEC && p.bufferOptions.waitsToMinimizeStalling === true);
  t("neighbor => 2.5s", applyReelBufferOptions(p, false) === true && p.bufferOptions.preferredForwardBufferDuration === NEIGHBOR_FORWARD_BUFFER_SEC);
  t("unsupported player => false (no throw)", applyReelBufferOptions({}, true) === false && applyReelBufferOptions(null, true) === false);
  const bad = {}; Object.defineProperty(bad, "bufferOptions", { set() { throw new Error("nope"); }, get() { return undefined; } });
  const warn = console.warn; console.warn = () => {};
  t("throwing setter => false (no throw)", applyReelBufferOptions(bad, true) === false);
  console.warn = warn;
  t("constants ~11 / ~2.5", ACTIVE_FORWARD_BUFFER_SEC === 11 && NEIGHBOR_FORWARD_BUFFER_SEC === 2.5);
}
// M5: تطبيع عربى
t("اسكندرية matches الإسكندرية", includesNormalized("الإسكندرية", "اسكندرية"));
t("المنوفيه matches المنوفية", includesNormalized("المنوفية", "المنوفيه") && normalizeArabic("المنوفية") === normalizeArabic("المنوفيه"));
t("diacritics & tatweel stripped", normalizeArabic("مَكَّـة") === "مكه");
t("alef/yaa/taa-marbuta unified", normalizeArabic("أإآ ة ى") === "ااا ه ي");
t("empty needle never matches", !includesNormalized("القاهرة", "  "));
t("dedupe keeps first spelling", JSON.stringify(dedupeNormalized(["الإسكندرية", "الاسكندريه", "القاهرة"])) === JSON.stringify(["الإسكندرية", "القاهرة"]));

rmSync(tmp, { recursive: true, force: true });
console.log(`اختبارات الوحدة: ${pass} نجح، ${failed.length} فشل`);
if (failed.length) { for (const n of failed) console.error("  ✗ " + n); process.exit(1); }
console.log("✓ كلها نجحت");
