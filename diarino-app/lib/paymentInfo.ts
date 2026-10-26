// ↔ بيانات استلام رسوم الخدمة (InstaPay) — تظهر فى صفحة الفاتورة (app/invoice/[propertyId].tsx).
// لتغيير الحساب مستقبلًا عدّل هذا الملف فقط (والصورة assets/instapay-recipient.jpg)، ثم eas update + إعادة تصدير الويب.
// الصورة هى لقطة شاشة InstaPay لاسم المرسل إليه المُقنَّع، ليتأكد المستخدم من صحة المستلم قبل التحويل.
export const PAYMENT_INFO = {
  method: "InstaPay",
  bankName: "البنك الأهلي المصري",
  accountNumber: "1845001175566600014",
  accountName: "baranda",
  // الاسم كما يظهر فى InstaPay عند التحويل (مُقنَّع).
  maskedRecipientName: "معتز ج*** ا*** ف*** ا*******",
} as const;

// ↔ طرق الدفع المتاحة لكل الفواتير (رسوم «تم البيع / تم الإيجار» + الترويج المدفوع للإعلانات).
// أرقام المحافظ بتتغيّر هنا فقط (وبعدها eas update + إعادة تصدير الويب).
export type PaymentMethodKey = "vodafone_cash" | "etisalat_cash" | "instapay";

export const PAYMENT_METHODS: { key: PaymentMethodKey; label: string }[] = [
  { key: "vodafone_cash", label: "فودافون كاش" },
  { key: "etisalat_cash", label: "اتصالات كاش" },
  { key: "instapay", label: "إنستاباي" },
];

export const WALLET_NUMBERS: Record<"vodafone_cash" | "etisalat_cash", string> = {
  vodafone_cash: "01030141847",
  etisalat_cash: "01117107131",
};

export function isPaymentMethodKey(v: unknown): v is PaymentMethodKey {
  return v === "vodafone_cash" || v === "etisalat_cash" || v === "instapay";
}

export function paymentMethodLabel(v: string | null | undefined): string {
  return PAYMENT_METHODS.find((m) => m.key === v)?.label ?? "";
}

// تحقق مشترك (نفس شروط الخادم): اسم ثلاثى = 3 كلمات على الأقل، ورقم تواصل من 7 إلى 15 رقمًا.
export function isValidTripleName(name: string): boolean {
  return name.trim().split(/\s+/).filter((w) => w.length >= 2).length >= 3;
}
export function isValidContactPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}
