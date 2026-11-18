// ↔ شروط كلمة المرور القوية (تسجيل حساب جديد + تعيين كلمة مرور جديدة): 8 أحرف على الأقل، وتحتوى على أرقام،
// وحروف إنجليزية صغيرة، وحرف إنجليزى كبير (Capital) واحد على الأقل. تسجيل الدخول لا يطبّق الشروط (حتى لا نمنع أصحاب
// كلمات المرور القديمة من الدخول). نفس الشروط مضبوطة فى Supabase (supabase/config.toml) — راجع docs/password-policy.md.
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRuleKey = "length" | "digit" | "lower" | "upper";

export const PASSWORD_RULES: { key: PasswordRuleKey; label: string; test: (p: string) => boolean }[] = [
  { key: "length", label: "8 أحرف على الأقل", test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { key: "digit", label: "رقم واحد على الأقل", test: (p) => /[0-9]/.test(p) },
  { key: "lower", label: "حرف إنجليزي صغير (a-z)", test: (p) => /[a-z]/.test(p) },
  { key: "upper", label: "حرف إنجليزي كبير Capital (A-Z)", test: (p) => /[A-Z]/.test(p) },
];

export function isStrongPassword(password: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(password));
}

export const WEAK_PASSWORD_MESSAGE = "كلمة المرور يجب ألا تقل عن 8 أحرف وتحتوي على أرقام وحروف إنجليزية وحرف كبير (Capital)";
