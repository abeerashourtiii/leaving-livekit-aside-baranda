import { access, cp, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(appRoot, "dist");
const publishDir = resolve(appRoot, "../docs");
const indexPath = resolve(outputDir, "index.html");

async function ensureFileAbsent(directory, fileName) {
  try {
    await access(resolve(directory, fileName));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${fileName} must not be present in ${directory}; Cloudflare Pages needs SPA fallback.`);
}

let html;
try {
  html = await readFile(indexPath, "utf8");
} catch (error) {
  throw new Error(`Web export is missing ${indexPath}; run expo export before syncing.`, {
    cause: error,
  });
}

const bundlePath = html.match(
  /<script\b[^>]*\bsrc=["'](\/?_expo\/static\/js\/web\/[^"']+\.js)["'][^>]*>/i,
)?.[1];

if (!bundlePath) {
  throw new Error(`Could not find the Expo web bundle reference in ${indexPath}.`);
}

const bundleFile = resolve(outputDir, bundlePath.replace(/^\/+/, ""));
if (!bundleFile.startsWith(`${outputDir}${sep}`)) {
  throw new Error(`The Expo web bundle path is outside the export directory: ${bundlePath}`);
}

try {
  await access(bundleFile);
} catch (error) {
  throw new Error(`The exported index references a missing JavaScript bundle: ${bundlePath}`, {
    cause: error,
  });
}

await ensureFileAbsent(outputDir, "404.html");
await ensureFileAbsent(publishDir, "404.html");

await cp(outputDir, publishDir, { recursive: true, force: true });

try {
  await access(resolve(publishDir, bundlePath.replace(/^\/+/, "")));
} catch (error) {
  throw new Error(`The JavaScript bundle was not copied to the publish directory: ${bundlePath}`, {
    cause: error,
  });
}

console.log(`Web export and referenced bundle synced to ${publishDir}.`);
