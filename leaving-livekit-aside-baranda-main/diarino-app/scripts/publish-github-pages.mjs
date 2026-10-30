import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exportDir = resolve(appRoot, "dist");
const pagesDir = resolve(appRoot, "../../docs");
const cnameFile = resolve(pagesDir, "CNAME");

const indexHtml = resolve(exportDir, "index.html");
if (!existsSync(indexHtml)) {
  throw new Error(`Web export is missing index.html: ${exportDir}`);
}
if (!existsSync(cnameFile)) {
  throw new Error(`GitHub Pages CNAME is missing: ${cnameFile}`);
}

copyFileSync(indexHtml, resolve(exportDir, "404.html"));
copyFileSync(cnameFile, resolve(exportDir, "CNAME"));
mkdirSync(pagesDir, { recursive: true });
cpSync(exportDir, pagesDir, { recursive: true, force: true });
console.log(`Published web export to ${pagesDir}`);
