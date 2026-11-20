// يقسم migrations الحديثة إلى «إضافية» (آمنة لنسخ التطبيق القديمة) و«تضييق» (تكسر النسخ القديمة أو تسحب صلاحيات) اعتمادًا على
// علامات -- @@TIGHTEN-BEGIN / -- @@TIGHTEN-END داخل ملفات migrations نفسها (مصدر واحد: لا نسخ مكرّرة تنحرف).
// الاستخدام:  node scripts/stage-migrations.mjs [--from=20261114000000] [--out=supabase/staged]
// الناتج:     <out>/additive/*.sql  (نفس الأسماء؛ تُنشر الآن)
//             <out>/tightening/TBD_*_tighten.sql  (تُنشر لاحقًا؛ أعد تسميتها بتاريخ التطبيق الفعلى ثم انقلها إلى supabase/migrations)
// الاستخدام الاعتيادى: إن لم توجد نسخ منشورة قديمة فطبّق supabase/migrations كما هى. وإلا: additive الآن، ثم ارفع app_version_requirements، ثم tightening.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const from = arg("from", "20261114000000");
const out = join(root, arg("out", "supabase/staged"));
const dir = join(root, "supabase", "migrations");

const BEGIN = "-- @@TIGHTEN-BEGIN";
const END = "-- @@TIGHTEN-END";
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "additive"), { recursive: true });
mkdirSync(join(out, "tightening"), { recursive: true });

const summary = [];
for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql") && f.slice(0, 14) >= from).sort()) {
  const text = readFileSync(join(dir, name), "utf8");
  const lines = text.split("\n");
  const additive = [];
  const tight = [];
  let inBlock = false;
  let blocks = 0;
  for (const line of lines) {
    const t = line.trim();
    if (t === BEGIN) { if (inBlock) throw new Error(`${name}: BEGIN متداخل`); inBlock = true; blocks++; tight.push(`-- (من ${name}) كتلة ${blocks}`); continue; }
    if (t === END) { if (!inBlock) throw new Error(`${name}: END بلا BEGIN`); inBlock = false; tight.push(""); continue; }
    (inBlock ? tight : additive).push(line);
  }
  if (inBlock) throw new Error(`${name}: BEGIN بلا END`);
  writeFileSync(join(out, "additive", name), additive.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");
  if (blocks) {
    const head = [
      `-- «تضييق» مُولَّد من ${name} (${blocks} كتلة). يُطبَّق *بعد* نشر النسخة الجديدة وبعد رفع app_version_requirements.min_version`,
      `-- فوق النسخة القديمة (انظر supabase/staged/README.md). أعد تسمية هذا الملف بتاريخ التطبيق الفعلى (YYYYMMDDHHMMSS_...) ثم انقله إلى supabase/migrations.`,
      `-- يعتمد على الجزء الإضافى من الملف الأصلى (المُطبَّق قبله).`,
      "",
    ];
    writeFileSync(join(out, "tightening", `TBD_${name.replace(/\.sql$/, "")}_tighten.sql`), head.concat(tight).join("\n") + "\nnotify pgrst, 'reload schema';\n", "utf8");
  }
  summary.push({ migration: name, tighteningBlocks: blocks });
}
writeFileSync(
  join(out, "README.md"),
  `# نشر مرحلى للـ migrations (إضافى ثم تضييق)\n\n` +
    `**متى؟** فقط إن كانت هناك نسخ تطبيق قديمة منشورة. إن لم توجد فطبّق \`supabase/migrations\` كما هى (كل شيء دفعة واحدة).\n\n` +
    `## الترتيب\n` +
    `1. **نشر الدوال** (\`livekit-recording\`, \`livekit-webhook\`, \`live-recording-url\`, …). فى المرحلة الإضافية اضبط سر \`LEGACY_PUBLIC_RECORDING_URL=1\` للـ webhook ليستمر تخزين رابط التسجيل العام للنسخ القديمة (والحاوية تبقى عامة).\n` +
    `2. **مجلد additive/** بالترتيب (أو الملفات نفسها من migrations/ بعد حذف كتل التضييق عبر هذا السكربت).\n` +
    `3. **بناء ونشر النسخة الجديدة** (متجرا Google/Apple + الويب). لا تنتقل للتضييق قبل أن تنتشر.\n` +
    `4. **رفع الحد الأدنى:** \`update public.app_version_requirements set min_version = '<إصدار النسخة الجديدة>' where platform in ('android','ios');\` ثم راقب (شاشة «تحديث مطلوب» تظهر للنسخ الأقدم). الصفين يُنشآن فى migration 20261116100002 بقيمة 0.0.0 (خامل).\n` +
    `5. **بعد أن ينخفض استخدام القديم** (راجع لوحة التحليلات/تسجيل الدخول): ضع سر \`LEGACY_PUBLIC_RECORDING_URL\` على 0، وانقل ملفات **tightening/** (بعد إعادة تسميتها بتاريخ اليوم) إلى migrations وطبّقها بالترتيب.\n` +
    `6. هجّر ملفات التسجيلات القديمة (\`scripts/migrate-live-recordings.mjs\`) بعد التضييق (الحاوية خاصة).\n\n` +
    `## ما الذى يضيّقه كل ملف\n` +
    summary.filter((s) => s.tighteningBlocks).map((s) => `- \`${s.migration}\`: ${s.tighteningBlocks} كتلة`).join("\n") +
    `\n\nالمصدر الوحيد هو علامات \`-- @@TIGHTEN-BEGIN/END\` داخل migrations؛ أعد توليد هذا المجلد بـ \`node scripts/stage-migrations.mjs\` بعد أى تعديل.\n`,
  "utf8",
);
console.table(summary);
console.log(`✓ ${out}`);
