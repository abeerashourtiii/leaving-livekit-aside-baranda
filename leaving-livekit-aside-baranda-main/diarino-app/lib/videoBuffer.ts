// ↔ D1: ضبط حجم التخزين المسبق (forward buffer) لكل مشغّل ريل حسب دوره:
//   • الريل النشط: ~11 ثانية قدّامه (تشغيل سلس بلا توقف).
//   • الجيران (قبل/بعد): ~2.5 ثانية فقط — يكفى لبدء فورى عند الوصول إليهم دون هدر بيانات على ريلز يتخطاها المستخدم سريعًا.
// الخاصية player.bufferOptions (expo-video) تُضبط فقط إن كانت موجودة على المشغّل (حارس للنسخ التى لا تدعمها) وبـ try/catch فلا تُسقط التشغيل.
// راجع VideoPlayer.types.ts (BufferOptions) فى الحزمة المثبّتة للحقول المدعومة لكل منصة؛ preferredForwardBufferDuration (ثوانٍ) هو المشترك المعتمد هنا.
export const ACTIVE_FORWARD_BUFFER_SEC = 11;
export const NEIGHBOR_FORWARD_BUFFER_SEC = 2.5;

type MaybeBufferPlayer = { bufferOptions?: Record<string, unknown> } | null | undefined;

export function applyReelBufferOptions(player: unknown, isActive: boolean): boolean {
  const p = player as MaybeBufferPlayer;
  if (!p || typeof p !== "object" || !("bufferOptions" in p)) return false; // النسخة المثبّتة لا تدعمها
  try {
    p.bufferOptions = {
      ...(p.bufferOptions ?? {}),
      preferredForwardBufferDuration: isActive ? ACTIVE_FORWARD_BUFFER_SEC : NEIGHBOR_FORWARD_BUFFER_SEC,
    };
    return true;
  } catch (err) {
    console.warn("[videoBuffer] bufferOptions rejected:", err);
    return false;
  }
}
