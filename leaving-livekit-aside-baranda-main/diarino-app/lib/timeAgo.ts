// ↔ وقت نسبى مختصر للتعليقات: «الآن / قبل 5 د / قبل 3 س / قبل 2 يوم / تاريخ». بيتبع لغة الواجهة.
export function timeAgo(iso: string, language: string): string {
  const ar = language !== "en";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return ar ? "الآن" : "now";
  if (mins < 60) return ar ? `قبل ${mins} د` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return ar ? `قبل ${hours} س` : `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return ar ? `قبل ${days} يوم` : `${days}d`;
  return new Date(iso).toLocaleDateString(ar ? "ar-EG" : "en-US", { year: "numeric", month: "short", day: "numeric" });
}
