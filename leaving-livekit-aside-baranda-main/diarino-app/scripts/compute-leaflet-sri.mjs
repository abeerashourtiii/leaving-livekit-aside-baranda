// يحسب SRI (sha384) لملفات Leaflet الفعلية من unpkg ويكتب lib/leafletSri.ts. يحتاج إنترنت. تشغيل: node scripts/compute-leaflet-sri.mjs [version]
// (يعادل: openssl dgst -sha384 -binary FILE | openssl base64 -A) — يُنفَّذ يدويًا ثم يُراجَع الناتج قبل الـ commit.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const version = process.argv[2] || "1.9.4";
const base = `https://unpkg.com/leaflet@${version}/dist`;
async function sri(file) {
  const res = await fetch(`${base}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
}
const [css, js] = await Promise.all([sri("leaflet.css"), sri("leaflet.js")]);
writeFileSync(
  new URL("../lib/leafletSri.ts", import.meta.url),
  `// مُولَّد بـ scripts/compute-leaflet-sri.mjs (Leaflet ${version}) — لا تعدّله يدويًا.\nexport const LEAFLET_SRI: { version: string | null; css: string | null; js: string | null } = {\n  version: ${JSON.stringify(version)},\n  css: ${JSON.stringify(css)},\n  js: ${JSON.stringify(js)},\n};\n`,
);
console.log({ version, css, js });
