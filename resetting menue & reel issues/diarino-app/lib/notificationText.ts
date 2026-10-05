// ↔ ترجمة نصوص الإشعارات الجاية من قاعدة البيانات (triggers بتكتبها عربى جاهز) +
// الوقت النسبى ("قبل 5 د" ...) لما التطبيق يكون بالإنجليزية. العناوين اللى بعد ":"
// بتعدّى على t() (القاموس للعناوين المعروفة، وأى عنوان كتبه المستخدم بيفضل زي ما هو).
const PREFIXES: [string, string][] = [
  ["تم الإعجاب بإعلانك: ", "Your listing was liked: "],
  ["تم حفظ إعلانك في المفضلة: ", "Your listing was saved to favorites: "],
  ["نشر إعلانًا جديدًا: ", "Posted a new listing: "],
  ["عقار جديد يطابق تنبيهك: ", "New property matching your alert: "],
  ["انخفض سعر عقار محفوظ لديك: ", "Price dropped on a property you saved: "],
  ["رسالة جديدة من ", "New message from "],
  ["رسالة جديدة: ", "New message: "],
];
const EXACT: Record<string, string> = {
  "أصبح لديك متابع جديد": "You have a new follower",
  "رسالة جديدة": "New message",
};

export function translateNotifText(text: string, t: (s: string) => string, isEn: boolean): string {
  if (!isEn || !text) return text;
  if (EXACT[text]) return EXACT[text];
  for (const [ar, en] of PREFIXES) {
    if (text.startsWith(ar)) return en + t(text.slice(ar.length));
  }
  // نص مش من القوالب المعروفة (غالبًا رسالة شات كتبها مستخدم): يفضل زي ما هو
  // بدل ترجمة بالكلمة تبوّظه.
  return text;
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
function latinDigits(s: string) {
  return s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[\u200e\u200f]/g, "");
}

export function translateRelativeTime(time: string, isEn: boolean): string {
  if (!isEn || !time) return time;
  if (time === "الآن") return "Just now";
  if (time === "أمس") return "Yesterday";
  let m = time.match(/^قبل (\d+) د$/); if (m) return `${m[1]} min ago`;
  m = time.match(/^قبل (\d+) س$/); if (m) return `${m[1]} h ago`;
  m = time.match(/^قبل (\d+) يوم$/); if (m) return `${m[1]} ${Number(m[1]) === 1 ? "day" : "days"} ago`;
  return latinDigits(time); // تاريخ بصيغة ar-EG → أرقام لاتينية
}
