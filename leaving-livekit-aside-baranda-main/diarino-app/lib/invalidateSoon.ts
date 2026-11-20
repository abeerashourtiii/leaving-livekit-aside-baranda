import type { QueryClient, QueryKey } from "@tanstack/react-query";

// ↔ تجميع (coalesce) إعادة الجلب: رسالة واردة واحدة كانت تطلق نحو 6 إعادات جلب (قناة المحادثة + useOffersRealtimeSync + onSuccess
//   للإرسال…). هنا كل طلبات invalidate لنفس المفتاح خلال delayMs بتتحوّل لإعادة جلب واحدة فقط.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function invalidateSoon(qc: QueryClient, queryKey: QueryKey, delayMs = 400) {
  const k = JSON.stringify(queryKey);
  if (timers.has(k)) return;
  timers.set(k, setTimeout(() => {
    timers.delete(k);
    void qc.invalidateQueries({ queryKey });
  }, delayMs));
}
