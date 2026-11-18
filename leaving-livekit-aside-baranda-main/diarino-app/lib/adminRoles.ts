import { supabase } from "./supabase";

// ↔ ترقية مستخدم إلى أدمن / إلغاء الصلاحية — عبر الدالة admin_set_admin_role (migration 20261025000000_admin_role_management.sql)
// بدل INSERT/DELETE مباشر على user_roles اللى كان بيفشل (سياسات RLS ذاتية المرجع) بدون سبب واضح. الصلاحية للمشرف الأعلى فقط.
export async function setAdminRole(input: { userId: string; makeAdmin: boolean; fullAccess?: boolean; permissions?: string[] }): Promise<void> {
  const { error } = await supabase.rpc("admin_set_admin_role", {
    p_user_id: input.userId,
    p_make_admin: input.makeAdmin,
    p_full_access: input.fullAccess ?? true,
    p_permissions: input.permissions ?? [],
  });
  if (error) throw error;
}

type PgLikeError = { message?: string; code?: string };

// رسالة عربية واضحة لسبب الفشل (بدون كشف تفاصيل داخلية). للأخطاء غير المعروفة نضيف رمز SQLSTATE فقط لتسهيل التشخيص.
export function adminRoleErrorMessage(err: unknown, fallback: string): string {
  const e = (err ?? {}) as PgLikeError;
  const msg = String(e.message ?? "");
  if (msg.includes("cannot_demote_super_admin")) return "لا يمكن إلغاء صلاحية المشرف الأعلى.";
  if (msg.includes("user_not_eligible")) return "لا يمكن ترقية حساب ضيف. يجب أن يكون للمستخدم حساب مسجّل.";
  if (msg.includes("user_not_found")) return "لم يتم العثور على هذا المستخدم أو ليس له ملف شخصي.";
  if (msg.includes("forbidden") || e.code === "42501") return "هذه العملية متاحة للمشرف الأعلى فقط.";
  if (msg.includes("Could not find the function") || e.code === "PGRST202") return "لم يُطبَّق تحديث قاعدة البيانات بعد: طبّق ملف 20261025000000_admin_role_management.sql ثم حاول مرة أخرى.";
  return e.code ? `${fallback} (رمز الخطأ: ${e.code})` : fallback;
}
