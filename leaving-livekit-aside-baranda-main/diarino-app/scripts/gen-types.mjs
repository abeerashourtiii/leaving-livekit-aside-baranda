// يولّد src/types/supabase.ts من قاعدة بيانات *تجريبية/محلية* بعد تطبيق كل الـ migrations (لا من الإنتاج).
// الاستخدام (واحد منها):
//   node scripts/gen-types.mjs --local                       # Supabase CLI المحلى (supabase start) — الأسهل
//   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/gen-types.mjs   # أى Postgres محلى/تجريبى
//   SUPABASE_TEST_PROJECT_ID=<ref> node scripts/gen-types.mjs   # مشروع تجريبى بعيد (يلزم `supabase login`)
// الكتابة آمنة: يُنتَج الناتج فى ملف مؤقت ويُستبدل الملف الحقيقى فقط عند النجاح وناتج غير فارغ (لا يُفرَّغ الملف عند فشل الأمر).
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const target = join(root, "src", "types", "supabase.ts");
const base = ["supabase", "gen", "types", "typescript", "--schema", "public"];
let args;
if (process.argv.includes("--local")) args = [...base, "--local"];
else if (process.env.SUPABASE_DB_URL) args = [...base, "--db-url", process.env.SUPABASE_DB_URL];
else if (process.env.SUPABASE_TEST_PROJECT_ID) args = [...base, "--project-id", process.env.SUPABASE_TEST_PROJECT_ID];
else { console.error("✗ حدّد المصدر: --local أو SUPABASE_DB_URL أو SUPABASE_TEST_PROJECT_ID (قاعدة تجريبية فقط، ليس الإنتاج)."); process.exit(1); }

const res = spawnSync("npx", ["--yes", ...args], { cwd: root, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
if (res.status !== 0 || !res.stdout || res.stdout.length < 1000 || !res.stdout.includes("export type Database")) {
  console.error("✗ فشل التوليد؛ لم يُعدَّل src/types/supabase.ts.\n" + (res.stderr || "").slice(0, 2000));
  process.exit(1);
}
const backup = join(tmpdir(), `supabase.types.backup.${Date.now()}.ts`);
copyFileSync(target, backup);
writeFileSync(target, res.stdout, "utf8");
console.log(`✓ كُتب ${target} (${statSync(target).size} بايت). نسخة احتياطية من القديم: ${backup}`);
console.log("التالى: npm install && npx tsc --noEmit — وأصلح الأخطاء حتى تصفر.");
