// ↔ محرّك تبديل (إعجاب/مفضلة) متفائل وآمن من الضغط المتكرر:
//   • الحالة «المطلوبة» تتحدد من آخر ضغطة (desired) لا من الكاش القديم، فالضغطتان السريعتان = إضافة ثم حذف (أو العكس)
//     بترتيب مضمون، وبطلب واحد فى الوقت لنفس العنصر (لا إدراج مرتين).
//   • الواجهة تتغيّر فورًا (apply)، ولو فشل طلب الخادم نرجع للحالة المؤكّدة ونُظهر رسالة (failed) — لا فشل صامت.
//   • إشارة التوصية (confirmed) بتُسجَّل فقط بعد نجاح الخادم.
//   • طلبات الإرسال تكرارية الأمان (idempotent): الإضافة تعتبر «موجود بالفعل 23505» نجاحًا، والحذف لصف غير موجود نجاحًا.
type Opts = {
  key: string;
  /** الحالة المعروضة الآن (من الكاش) — تُستخدم فقط عند أول ضغطة لعنصر لا توجد له عملية جارية. */
  current: boolean;
  apply: (state: boolean) => void;
  send: (state: boolean) => Promise<void>;
  confirmed: (state: boolean) => void;
  failed: () => void;
};
type Entry = { confirmed: boolean; desired: boolean; running: boolean; latest: Opts };
const entries = new Map<string, Entry>();

export function requestToggle(opts: Opts): void {
  let e = entries.get(opts.key);
  if (!e) {
    e = { confirmed: opts.current, desired: opts.current, running: false, latest: opts };
    entries.set(opts.key, e);
  }
  e.latest = opts;
  const next = !e.desired;
  e.desired = next;
  opts.apply(next);
  if (e.running) return;
  e.running = true;
  const entry = e;
  void (async () => {
    try {
      while (entry.desired !== entry.confirmed) {
        const target = entry.desired;
        try {
          await entry.latest.send(target);
          entry.confirmed = target;
          entry.latest.confirmed(target);
        } catch (err) {
          console.warn("toggle failed:", err);
          entry.desired = entry.confirmed;
          entry.latest.apply(entry.confirmed);
          entry.latest.failed();
          break;
        }
      }
    } finally {
      entry.running = false;
      if (entry.desired === entry.confirmed) entries.delete(opts.key);
    }
  })();
}
