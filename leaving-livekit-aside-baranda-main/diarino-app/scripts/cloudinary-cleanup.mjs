#!/usr/bin/env node
// scripts/cloudinary-cleanup.mjs
//
// تشغيل تنظيف ملفات Cloudinary اليتيمة يدويًا (أو من أى جدولة خارجية) عبر Edge Function `cloudinary-cleanup`.
// لا يحتوى أى سر Cloudinary: الدالة على الخادم هى التى تتصل بـ Cloudinary بالـ API Secret.
//
// الاستخدام:
//   SUPABASE_URL=https://<ref>.supabase.co CLEANUP_CRON_SECRET=<السر> node scripts/cloudinary-cleanup.mjs stats
//   ... node scripts/cloudinary-cleanup.mjs process [--limit=50]        # معالجة الطابور (حذف فعلى بعد التحقق من عدم الاستخدام)
//   ... node scripts/cloudinary-cleanup.mjs scan                         # فحص اليتامى (معاينة فقط — لا يحذف ولا يدخل الطابور)
//   ... node scripts/cloudinary-cleanup.mjs scan --queue                 # إدخال اليتامى (من سجل الرفع) إلى الطابور
//   ... node scripts/cloudinary-cleanup.mjs scan --source=cloudinary --prefix=uploads/   # سرد Cloudinary نفسه (المعاينة فقط من هنا؛ الإدخال للطابور يحتاج المشرف الرئيسى من لوحة الأدمن)
const [mode = "stats", ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
const url = process.env.SUPABASE_URL;
const secret = process.env.CLEANUP_CRON_SECRET;
if (!url || !secret) { console.error("SUPABASE_URL و CLEANUP_CRON_SECRET مطلوبان."); process.exit(1); }
if (!["stats", "process", "scan"].includes(mode)) { console.error("mode غير معروف: stats | process | scan"); process.exit(1); }

const body = { mode };
if (mode === "process" && flags.limit) body.limit = Number(flags.limit);
if (mode === "scan") {
  body.source = flags.source === "cloudinary" ? "cloudinary" : "ledger";
  body.dryRun = !flags.queue;
  if (flags.prefix) body.prefix = String(flags.prefix);
  if (flags.olderThanHours) body.olderThanHours = Number(flags.olderThanHours);
}
const res = await fetch(`${url.replace(/\/$/, "")}/functions/v1/cloudinary-cleanup`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-cleanup-secret": secret },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log(res.status, text);
process.exit(res.ok ? 0 : 1);
