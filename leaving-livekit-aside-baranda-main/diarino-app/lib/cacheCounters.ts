import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

// ↔ تحديث عدّادات (الإعجاب/التعليقات) فى كاش الريلز والطلبات «فى مكانها» بدل invalidateQueries(["properties"]).
//   السبب: invalidateQueries كان يعيد جلب كل صفحات الفيد المحمّلة (select *) بعد كل إعجاب/تعليق/حذف — استهلاك بيانات
//   وتقطيع، وكان ممكن الفيد يتحرك أثناء السحب. هنا بنعدّل صف العقار نفسه فى كل الكاشات التى تحتويه (قائمة، صفحات
//   infinite، تفاصيل) ولا نلمس باقى الصفوف (نفس المرجع ← لا إعادة رسم)، وللتصحيح بنجلب *عمودًا واحدًا لصف واحد* فقط.
//   نفس السلوك على أندرويد وآيفون والويب وAPK (الكود مشترك).
type Counted = { id: string; likes?: number; comments?: number };
const isRow = (v: unknown): v is Counted => !!v && typeof v === "object" && typeof (v as Counted).id === "string";

function mapRows(old: unknown, fn: (r: Counted) => Counted): unknown {
  if (Array.isArray(old)) {
    let changed = false;
    const next = old.map((x) => {
      if (!isRow(x)) return x;
      const y = fn(x);
      if (y !== x) changed = true;
      return y;
    });
    return changed ? next : old;
  }
  if (old && typeof old === "object" && Array.isArray((old as { pages?: unknown }).pages)) {
    const o = old as { pages: unknown[] };
    let changed = false;
    const pages = o.pages.map((pg) => {
      const n = mapRows(pg, fn);
      if (n !== pg) changed = true;
      return n;
    });
    return changed ? { ...o, pages } : old;
  }
  if (isRow(old)) return fn(old);
  return old;
}

export type CounterRoot = "properties" | "requests";

function updateRow(qc: QueryClient, root: CounterRoot, id: string, fn: (r: Counted) => Counted) {
  qc.setQueriesData({ queryKey: [root] }, (old: unknown) => mapRows(old, (r) => (r.id === id ? fn(r) : r)));
}

/** يزيد/ينقص عدّاد الإعجابات أو التعليقات لصف واحد فى كل الكاشات (لا يتجاوز الصفر). */
export function patchCounters(qc: QueryClient, root: CounterRoot, id: string, delta: { likes?: number; comments?: number }) {
  updateRow(qc, root, id, (r) => {
    const next: Counted = { ...r };
    if (delta.likes !== undefined && typeof r.likes === "number") next.likes = Math.max(0, r.likes + delta.likes);
    // الطلبات القديمة (قبل migration التعليقات) comments فيها undefined: لا نخترع عدّادًا.
    if (delta.comments !== undefined && typeof r.comments === "number") next.comments = Math.max(0, r.comments + delta.comments);
    return next.likes === r.likes && next.comments === r.comments ? r : next;
  });
}

/** يضبط قيمة عدّاد التعليقات الحقيقية القادمة من الخادم. */
export function setCommentCount(qc: QueryClient, root: CounterRoot, id: string, count: number) {
  updateRow(qc, root, id, (r) => (typeof r.comments === "number" && r.comments === count ? r : { ...r, comments: count }));
}

/** تصحيح عدّاد التعليقات من الخادم: عمود واحد لصف واحد (بدل إعادة جلب الفيد). أى فشل يُتجاهل — العدّاد المتفائل يكفى مؤقتًا. */
export async function refreshCommentCount(qc: QueryClient, kind: "reel" | "request", id: string): Promise<void> {
  try {
    const table = kind === "reel" ? "properties" : "requests";
    const { data, error } = await supabase.from(table).select("comment_count").eq("id", id).maybeSingle();
    if (error || !data) return;
    const n = (data as { comment_count?: number | null }).comment_count;
    if (typeof n === "number") setCommentCount(qc, kind === "reel" ? "properties" : "requests", id, n);
  } catch {
    /* best-effort */
  }
}
