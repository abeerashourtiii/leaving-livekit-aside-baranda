import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase";

// ↔ العلامات الحمراء فى القائمة الجانبية للأدمن: ريلز قيد المراجعة، الدعم (بلاغات/مقترحات بدون رد + تواصل)، الصفقات والرسوم
// (تأكيدات سداد/صفقات قيد المراجعة + ترويج + مساحة إعلانية). الدالة admin_pending_counts تحسب فقط الأقسام اللى
// لدى المشرف صلاحيتها (غيرها 0). بتتجدد كل 30 ثانية وعند فتح الشاشة.
export type AdminPendingCounts = { reels: number; support: number; deals: number };

export function useAdminPendingCounts(enabled: boolean) {
  return useQuery<AdminPendingCounts>({
    queryKey: ["adminPendingCounts"],
    enabled,
    refetchInterval: 30_000,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_pending_counts");
      if (error) return { reels: 0, support: 0, deals: 0 }; // قبل تطبيق الـ migration: بدون علامات
      const row = (data ?? [])[0];
      return { reels: row?.reels_pending ?? 0, support: row?.support_pending ?? 0, deals: row?.deals_pending ?? 0 };
    },
  });
}
