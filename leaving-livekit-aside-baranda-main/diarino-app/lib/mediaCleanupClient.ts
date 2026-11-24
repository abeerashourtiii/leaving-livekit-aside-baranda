import { supabase } from "./supabase";

// ↔ بعد حذف أى عنصر فيه وسائط (إعلان...) نطلب من الخادم حذف ملفات Cloudinary الخاصة بصاحب الحذف فورًا بدل انتظار الجدولة.
//   تذهب الطلبات إلى Edge Function `cloudinary-cleanup` (mode "process_own") التى تحمل الـ API Secret على الخادم وتحذف فقط ما التقطه الطابور
//   لهذا المستخدم ولم يعد مستخدمًا فى أى سجل نشط. best-effort: أى فشل يُتجاهل (الجدولة تعيد المحاولة) ولا يؤثر على نجاح الحذف نفسه.
export function requestOwnMediaCleanup(): void {
  void (async () => {
    try {
      await supabase.functions.invoke("cloudinary-cleanup", { body: { mode: "process_own" } });
    } catch {
      /* الطابور يُعاد معالجته من الجدولة */
    }
  })();
}
