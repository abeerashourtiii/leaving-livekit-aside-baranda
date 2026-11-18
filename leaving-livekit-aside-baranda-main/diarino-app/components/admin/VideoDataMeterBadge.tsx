import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { useIsAdmin } from "../../lib/hooks/useIsAdmin";
import { ASSUMED_MBPS, getVideoMeterReport, resetVideoMeter, useVideoMeter } from "../../lib/videoDataMeter";

// ↔ D3: شارة صغيرة (للأدمن فقط وعند تفعيلها من الإعدادات) تعرض تقدير بيانات الفيديو المحمّلة فى هذه الجلسة؛ الضغط يعرض تفصيل كل ريل،
//   وفيه زر تصفير لبدء قياس جديد (قبل/بعد). تقدير نسبى — شوف lib/videoDataMeter.ts.
export function VideoDataMeterBadge() {
  const { isAdmin } = useIsAdmin();
  const meter = useVideoMeter();
  if (!isAdmin || !meter.enabled) return null;

  function showReport() {
    const rows = getVideoMeterReport(15);
    const lines = rows.map((r, i) => `${i + 1}. ${r.mb.toFixed(2)} MB (${Math.round(r.sec)}s) — …${r.uri.slice(-22)}`).join("\n");
    Alert.alert(
      `بيانات الفيديو (تقديرية) ≈ ${meter.estMB.toFixed(1)} MB`,
      `${meter.reels} ريل · افتراض ${ASSUMED_MBPS} Mbps\n\n${lines || "لا بيانات بعد"}`,
      [{ text: "تصفير", style: "destructive", onPress: resetVideoMeter }, { text: "إغلاق", style: "cancel" }],
    );
  }

  return (
    <Pressable style={styles.badge} onPress={showReport} accessibilityRole="button">
      <Text style={styles.text}>📊 {meter.estMB.toFixed(1)} MB · {meter.reels}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { position: "absolute", top: 90, left: 10, zIndex: 50, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  text: { color: "white", fontSize: 11, fontWeight: "800" },
});
