// بناء الويب (يستبدل السلسلة القديمة فى package.json): يعمل على ويندوز/ماك/لينكس (لا حاجة لـ cross-env).
//   1) generate-terms-page  2) expo export --platform web (مع SHAHIR_WEB_BUILD=1 لتفعيل asset plugin الخاص بالويب)  3) postbuild-web (وسوم المعاينة + تحقق).
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function run(cmd, args, env = {}) {
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (res.status !== 0) {
    console.error(`✗ فشلت الخطوة: ${cmd} ${args.join(" ")}`);
    process.exit(res.status ?? 1);
  }
}

run(process.execPath, ["scripts/generate-terms-page.mjs"]);
run("npx", ["expo", "export", "--platform", "web"], { SHAHIR_WEB_BUILD: "1" });
run(process.execPath, ["scripts/postbuild-web.mjs"]);
