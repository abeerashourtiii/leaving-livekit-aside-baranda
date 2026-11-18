// ↔ نوع الحساب (إجبارى): فرد / مطور عقارى / بروكر — عمود profiles.account_type
// (supabase/migrations/20261009000000_account_type_and_admin_users.sql).
export type AccountType = "individual" | "developer" | "broker";

export const ACCOUNT_TYPES: AccountType[] = ["individual", "developer", "broker"];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  individual: "فرد",
  developer: "مطور عقاري",
  broker: "بروكر",
};

export function isAccountType(v: unknown): v is AccountType {
  return v === "individual" || v === "developer" || v === "broker";
}
