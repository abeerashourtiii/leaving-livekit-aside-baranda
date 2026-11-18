import { supabase } from "./supabase";

// ↔ M1: «تجاهل» فى صندوق الدعم = حذف ناعم (dismissed_at) عبر RPC admin_dismiss_support_item، ويُحذف نهائيًا بعد 30 يومًا (مهمة يومية).
// قبل تطبيق migration 20261116000001 (الدالة غير موجودة) نرجع للحذف المباشر القديم حتى لا يتعطل الأدمن.
export type SupportItemKind = "report" | "suggestion" | "contact" | "ad_contact";

const TABLE_BY_KIND: Record<SupportItemKind, string> = {
  report: "reports",
  suggestion: "suggestions",
  contact: "support_messages",
  ad_contact: "ad_contacts",
};

export async function dismissSupportItem(kind: SupportItemKind, id: string): Promise<void> {
  const { error } = await supabase.rpc("admin_dismiss_support_item", { p_kind: kind, p_id: id });
  if (!error) return;
  const missing = error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
  if (!missing) throw error;
  const { error: delErr } = await supabase.from(TABLE_BY_KIND[kind] as "reports").delete().eq("id", id);
  if (delErr) throw delErr;
}
