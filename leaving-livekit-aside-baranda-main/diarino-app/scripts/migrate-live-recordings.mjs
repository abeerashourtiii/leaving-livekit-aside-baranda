// تهجير تسجيلات البث القديمة إلى أسماء عشوائية (recordings/<uuid>.mp4) وتحديث المسار فى live_recording_private،
// أو حذف القديم غير المنشور عند الطلب. نقل ملفات التخزين لا يمكن من SQL، لذلك هذا السكربت (بمفتاح الخدمة).
//
// ترتيب التشغيل: (1) نشر دوال livekit-recording/livekit-webhook/live-recording-url  (2) تطبيق migrations حتى 20261115000000
//                (3) هذا السكربت (تشغيل تجريبى أولًا)  — الأمر الافتراضى لا يغيّر شيئًا (dry-run) ويكتب تقريرًا CSV.
//
// المتغيرات:  SUPABASE_URL  SUPABASE_SERVICE_ROLE_KEY  [RECORDING_BUCKET=live-recordings]
//             CONFIRM_PROJECT_REF=<ref المشروع كما فى الرابط>  (إلزامى مع --apply، حماية من تشغيله على مشروع خطأ)
// الأعلام:    --apply                      ينفّذ فعليًا (بدونه: عرض فقط)
//             --delete-unpublished-before=YYYY-MM-DD   مع --apply: يحذف ملفات التسجيلات *غير المنشورة* الأقدم من التاريخ بدل نقلها
//                                         (تُصفَّر حالتها إلى none، ولا يمكن التراجع). المنشورة تُنقل دائمًا.
//             --out=<path>                 مسار التقرير (الافتراضى recordings-migration-report.csv)
// الأمان: لا يمسّ إلا صفوف مسارها لا يطابق النمط recordings/<uuid>.mp4؛ فإعادة التشغيل آمنة (idempotent). النقل: move ثم تحديث القاعدة،
//         وإن فشل التحديث يُعاد الملف لمكانه. لا يطبع المفاتيح.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => args.find((a) => a.startsWith(`${n}=`))?.slice(n.length + 1);

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.RECORDING_BUCKET || "live-recordings";
const APPLY = flag("--apply");
const DELETE_BEFORE = val("--delete-unpublished-before");
const OUT = val("--out") || "recordings-migration-report.csv";

if (!URL_ || !KEY) { console.error("✗ SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY مطلوبان."); process.exit(1); }
const ref = new URL(URL_).hostname.split(".")[0];
if (APPLY && process.env.CONFIRM_PROJECT_REF !== ref) {
  console.error(`✗ للتنفيذ الفعلى اضبط CONFIRM_PROJECT_REF=${ref} (يجب أن يطابق مشروع الرابط).`);
  process.exit(1);
}
let deleteCutoff = null;
if (DELETE_BEFORE) {
  deleteCutoff = new Date(`${DELETE_BEFORE}T00:00:00Z`);
  if (Number.isNaN(deleteCutoff.getTime())) { console.error("✗ تاريخ --delete-unpublished-before غير صالح."); process.exit(1); }
}

const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const store = db.storage.from(BUCKET);
const RANDOM_RE = /^recordings\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/i;

const rows = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await db
    .from("live_recording_private")
    .select("live_id, recording_filepath, lives!inner(id, title, host_id, status, published_public, recording_status, created_at)")
    .not("recording_filepath", "is", null)
    .order("live_id")
    .range(from, from + 499);
  if (error) { console.error("✗ تعذّرت القراءة:", error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 500) break;
}

const todo = rows.filter((r) => !RANDOM_RE.test(r.recording_filepath));
console.log(`${APPLY ? "تنفيذ" : "تجربة (بلا تغيير)"} — مشروع ${ref}، حاوية ${BUCKET}: ${rows.length} تسجيل، منها ${todo.length} بمسار قديم.`);

const report = [];
for (const r of todo) {
  const live = r.lives;
  const published = !!live.published_public;
  const oldPath = r.recording_filepath;
  const shouldDelete = !!deleteCutoff && !published && new Date(live.created_at) < deleteCutoff;
  const entry = { live_id: r.live_id, host_id: live.host_id, created_at: live.created_at, published, old_path: oldPath, new_path: "", action: shouldDelete ? "delete" : "rename", result: "" };

  if (!APPLY) { entry.result = "dry-run"; report.push(entry); continue; }

  try {
    if (shouldDelete) {
      const { error } = await store.remove([oldPath]);
      if (error) throw new Error(`remove: ${error.message}`);
      const { error: e2 } = await db.from("live_recording_private").delete().eq("live_id", r.live_id);
      if (e2) throw new Error(`db delete: ${e2.message}`);
      const { error: e3 } = await db.from("lives").update({ recording_status: "none" }).eq("id", r.live_id);
      if (e3) throw new Error(`db status: ${e3.message}`);
      entry.result = "deleted";
    } else {
      const newPath = `recordings/${randomUUID()}.mp4`;
      entry.new_path = newPath;
      const { error: mvErr } = await store.move(oldPath, newPath);
      if (mvErr) {
        entry.result = /not found|does not exist|404/i.test(mvErr.message) ? "missing-file (لم يُغيَّر شيء)" : `move-failed: ${mvErr.message}`;
        entry.new_path = "";
      } else {
        const { error: upErr } = await db.from("live_recording_private").update({ recording_filepath: newPath }).eq("live_id", r.live_id);
        if (upErr) {
          await store.move(newPath, oldPath); // تراجع
          entry.result = `db-update-failed (أُعيد الملف): ${upErr.message}`;
          entry.new_path = "";
        } else {
          entry.result = "renamed";
        }
      }
    }
  } catch (err) {
    entry.result = `error: ${err.message}`;
  }
  report.push(entry);
}

const cols = ["live_id", "host_id", "created_at", "published", "action", "old_path", "new_path", "result"];
const csv = [cols.join(","), ...report.map((e) => cols.map((c) => `"${String(e[c]).replace(/"/g, '""')}"`).join(","))].join("\n");
writeFileSync(OUT, csv, "utf8");
console.table(report.map((e) => ({ live: e.live_id.slice(0, 8), published: e.published, action: e.action, result: e.result })));
const tally = report.reduce((a, e) => ((a[e.result.split(" ")[0].split(":")[0]] = (a[e.result.split(" ")[0].split(":")[0]] || 0) + 1), a), {});
console.log("ملخص:", tally, `— التقرير الكامل: ${OUT}`);
if (!APPLY) console.log("لم يتغيّر شيء. أعد التشغيل مع --apply (و CONFIRM_PROJECT_REF) للتنفيذ.");
