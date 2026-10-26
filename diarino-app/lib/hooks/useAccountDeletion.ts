import { useMutation } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { signOut } from "./useAuth";

// ↔ حذف الحساب من داخل التطبيق (شرط App Store وGoogle Play) — الدالة public.delete_my_account()
// (supabase/migrations/20261015000000_account_deletion_and_live_rights.sql).
// الدالة بتحذف المستخدم من auth.users فتنتشر الحذفات لكل بياناته (ملف شخصى، إعلانات، تعليقات، مفضلة، محادثات، إشعارات...).
// الأخطاء المتوقعة من الخادم:
//   has_open_fees               → عليه رسوم صفقات مستحقة لم تُسدَّد (سياسة البيع والرسوم)
//   super_admin_cannot_delete   → المشرف الأعلى لازم ينقل الصلاحية أولًا
// ملاحظة: ملفات Cloudinary (صور/فيديو/موسيقى) بتفضل على Cloudinary — بس مفيش أى سجل فى قاعدة البيانات بيشاور عليها
// (راجع docs/account-deletion.md).
export type DeleteAccountError = "has_open_fees" | "super_admin_cannot_delete" | "unknown";

export function useDeleteAccount() {
  return useMutation<void, Error>({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delete_my_account");
      if (error) {
        if (/has_open_fees/i.test(error.message)) throw new Error("has_open_fees");
        if (/super_admin_cannot_delete/i.test(error.message)) throw new Error("super_admin_cannot_delete");
        throw error;
      }
      // المستخدم اتحذف على الخادم: نمسح الجلسة المحلية والكاش (signOut بيمسح queryClient وباقى الحالة).
      await signOut();
    },
  });
}

export function deleteAccountErrorCode(err: unknown): DeleteAccountError {
  const msg = err instanceof Error ? err.message : "";
  if (msg === "has_open_fees" || msg === "super_admin_cannot_delete") return msg;
  return "unknown";
}
