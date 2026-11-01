import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { signOut } from "./useAuth";
import { useCurrentUser } from "./useCurrentUser";

// ↔ حذف الحساب من داخل التطبيق (شرط App Store وGoogle Play) — الدالة public.delete_my_account()
// (supabase/migrations/20261015000000_account_deletion_and_live_rights.sql، ومعدّلة فى 20261026000000_admin_account_deletion_approval.sql).
// الدالة بتحذف المستخدم من auth.users فتنتشر الحذفات لكل بياناته (ملف شخصى، إعلانات، تعليقات، مفضلة، محادثات، إشعارات...).
// الأماكن: «تعديل بيانات الحساب» (app/edit-profile.tsx) — مش فى الإعدادات.
// الأخطاء المتوقعة من الخادم:
//   has_open_fees                      → عليه رسوم صفقات مستحقة لم تُسدَّد (سياسة البيع والرسوم)
//   super_admin_cannot_delete          → المشرف الأعلى لازم ينقل الصلاحية أولًا
//   admin_requires_super_admin_approval→ أى مشرف: الحذف مش مباشر، بيتحوّل تلقائيًا لطلب حذف يوافق عليه المشرف الأعلى (السوبر أدمن)
// ملاحظة: ملفات Cloudinary (صور/فيديو/موسيقى) بتفضل على Cloudinary — بس مفيش أى سجل فى قاعدة البيانات بيشاور عليها
// (راجع docs/account-deletion.md).
export type DeleteAccountError = "has_open_fees" | "super_admin_cannot_delete" | "unknown";
export type DeleteAccountResult = "deleted" | "requested";

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation<DeleteAccountResult, Error>({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delete_my_account");
      if (error) {
        if (/admin_requires_super_admin_approval/i.test(error.message)) {
          // ↔ المشرف: بدل الحذف المباشر نرسل طلبًا للسوبر أدمن (لا يُحذف الحساب إلا بموافقته).
          const req = await supabase.rpc("request_admin_account_deletion");
          if (req.error) throw mapDeleteError(req.error.message, req.error);
          await qc.invalidateQueries({ queryKey: ["myDeletionRequest"] });
          return "requested";
        }
        throw mapDeleteError(error.message, error);
      }
      // المستخدم اتحذف على الخادم: نمسح الجلسة المحلية والكاش (signOut بيمسح queryClient وباقى الحالة).
      await signOut();
      return "deleted";
    },
  });
}

function mapDeleteError(message: string, original: Error | { message: string }): Error {
  if (/has_open_fees/i.test(message)) return new Error("has_open_fees");
  if (/super_admin_cannot_delete/i.test(message)) return new Error("super_admin_cannot_delete");
  return original instanceof Error ? original : new Error(message);
}

export function deleteAccountErrorCode(err: unknown): DeleteAccountError {
  const msg = err instanceof Error ? err.message : "";
  if (msg === "has_open_fees" || msg === "super_admin_cannot_delete") return msg;
  return "unknown";
}

// ↔ آخر طلب حذف حساب للمشرف الحالى (معلّق / مرفوض...) — بيظهر فى «تعديل بيانات الحساب».
export type DeletionRequest = {
  id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
};

export function useMyDeletionRequest() {
  const { user } = useCurrentUser();
  const uid = user && !user.is_anonymous ? user.id : undefined;
  return useQuery<DeletionRequest | null>({
    queryKey: ["myDeletionRequest", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_deletion_requests")
        .select("id, status, requested_at, decided_at, decision_note")
        .eq("user_id", uid as string)
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null; // قبل تطبيق الـ migration الجدول مش موجود: نتجاهل بهدوء
      return (data as DeletionRequest | null) ?? null;
    },
  });
}

export function useCancelDeletionRequest() {
  const qc = useQueryClient();
  return useMutation<void, Error>({
    mutationFn: async () => {
      const { error } = await supabase.rpc("cancel_admin_account_deletion_request");
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["myDeletionRequest"] }),
  });
}

// ↔ للسوبر أدمن فقط (لوحة التحكم ← المشرفون): الطلبات المعلّقة + موافقة/رفض.
export type PendingDeletionRequest = {
  id: string; user_id: string | null; user_name: string | null; user_email: string | null; requested_at: string;
};

export function usePendingDeletionRequests(enabled: boolean) {
  return useQuery<PendingDeletionRequest[]>({
    queryKey: ["pendingDeletionRequests"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_deletion_requests")
        .select("id, user_id, user_name, user_email, requested_at")
        .eq("status", "pending")
        .order("requested_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PendingDeletionRequest[];
    },
  });
}

export function useDecideDeletionRequest() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; approve: boolean; note?: string }>({
    mutationFn: async ({ id, approve, note }) => {
      const { error } = approve
        ? await supabase.rpc("admin_approve_account_deletion", { p_request_id: id })
        : await supabase.rpc("admin_reject_account_deletion", { p_request_id: id, p_note: note ?? null });
      if (error) {
        if (/has_open_fees/i.test(error.message)) throw new Error("has_open_fees");
        if (/super_admin_cannot_delete/i.test(error.message)) throw new Error("super_admin_cannot_delete");
        if (/request_not_found/i.test(error.message)) throw new Error("request_not_found");
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pendingDeletionRequests"] });
      qc.invalidateQueries({ queryKey: ["adminList"] });
    },
  });
}
