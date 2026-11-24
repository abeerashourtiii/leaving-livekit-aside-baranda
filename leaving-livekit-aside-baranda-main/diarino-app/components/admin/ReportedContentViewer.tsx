import { useCallback, useState, type ReactElement } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { router, type Href } from "expo-router";
import { supabase } from "../../lib/supabase";
import { RequestDetailsCard } from "../requests/RequestDetailsCard";
import { useRequestById } from "../../lib/hooks/useRequests";
import { showToast } from "../shared/Toast";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ لوحة الأدمن ← الدعم ← «البلاغات»: زر «عرض» يفتح المحتوى المُبلَّغ عنه ليراه المشرف قبل أن يقرر (رد / تجاهل / حذف):
//   • ريل / إعلان  → شاشة الريل نفسها (/property/<id>/reel) ومنها تفاصيل الإعلان.
//   • بث مباشر     → البث الحى (/live/<room_name>) إن كان مستمرًا، وإلا إعادة البث المسجّلة (/live/replay/<id>) إن كان التسجيل جاهزًا.
//   • طلب          → نافذة بتفاصيل الطلب كاملة (النوع والغرض والميزانية والموقع والوصف وصاحب الطلب).
//   • تعليق        → المحتوى الذى كُتب عليه التعليق (ريل أو طلب).
// الرابط المرجعى القديم /requests?id= لم تكن شاشة الطلبات تفتحه، ولذلك نعرض الطلب فى نافذة بدل التنقل.
// يعمل بنفس الكود على أندرويد/آيفون/الويب/APK. المحتوى المحذوف أو غير المتاح بحسب الصلاحية يظهر له تنبيه بدل شاشة فارغة.
export type ReportedTarget = { targetType: string; targetId: string; title: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function openProperty(propertyId: string): Promise<void> {
  const { data, error } = await supabase.from("properties").select("id").eq("id", propertyId).maybeSingle();
  if (error || !data) {
    showToast("المحتوى غير متاح (قد يكون حُذف أو لا تملك صلاحية عرضه)");
    return;
  }
  router.push(`/property/${encodeURIComponent(propertyId)}/reel` as Href);
}

async function openLive(liveId: string): Promise<void> {
  type LiveRow = { id: string; room_name: string; status: string; recording_status: string | null };
  const cols = "id, room_name, status, recording_status";
  let row: LiveRow | null = null;
  if (UUID_RE.test(liveId)) {
    const { data } = await supabase.from("lives").select(cols).eq("id", liveId).maybeSingle();
    row = (data as LiveRow | null) ?? null;
  }
  if (!row) {
    const { data } = await supabase.from("lives").select(cols).eq("room_name", liveId).maybeSingle();
    row = (data as LiveRow | null) ?? null;
  }
  if (!row) {
    showToast("البث غير متاح (قد يكون حُذف)");
    return;
  }
  if (row.status === "live") {
    router.push(`/live/${encodeURIComponent(row.room_name)}` as Href);
  } else if (row.recording_status === "ready") {
    router.push(`/live/replay/${encodeURIComponent(row.id)}` as Href);
  } else {
    showToast("انتهى البث ولا يوجد تسجيل متاح للعرض");
  }
}

export function useReportedContentViewer(): { open: (t: ReportedTarget) => Promise<void>; element: ReactElement } {
  const [request, setRequest] = useState<{ id: string; title: string } | null>(null);

  const open = useCallback(async (t: ReportedTarget) => {
    try {
      if (t.targetType === "live") return await openLive(t.targetId);
      if (t.targetType === "request") return setRequest({ id: t.targetId, title: t.title });
      if (t.targetType === "comment") {
        const { data: rc } = await supabase.from("reel_comments").select("property_id").eq("id", t.targetId).maybeSingle();
        if (rc?.property_id) return await openProperty(String(rc.property_id));
        const { data: qc } = await supabase.from("request_comments").select("request_id").eq("id", t.targetId).maybeSingle();
        if (qc?.request_id) return setRequest({ id: String(qc.request_id), title: t.title });
        showToast("المحتوى غير متاح (قد يكون حُذف)");
        return;
      }
      return await openProperty(t.targetId); // property (ريل / إعلان) وأى نوع آخر
    } catch {
      showToast("تعذر فتح المحتوى، حاول مرة أخرى");
    }
  }, []);

  return { open, element: <RequestPreviewModal request={request} onClose={() => setRequest(null)} /> };
}

function RequestPreviewModal({ request, onClose }: { request: { id: string; title: string } | null; onClose: () => void }) {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { data, isLoading } = useRequestById(request?.id);
  return (
    <Modal visible={!!request} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.heading}>الطلب المُبلَّغ عنه</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {request ? <RequestDetailsCard requestId={request.id} fallbackTitle={request.title} /> : null}
            {request && !isLoading && !data ? (
              <Text style={styles.note}>لم يعد الطلب متاحًا (قد يكون حُذف) — العنوان أعلاه هو آخر ما سُجّل فى البلاغ.</Text>
            ) : null}
          </ScrollView>
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeText}>إغلاق</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    wrap: { flex: 1, justifyContent: "center", paddingHorizontal: 22 },
    card: { backgroundColor: c.card, borderRadius: 18, padding: 18, maxHeight: "86%", gap: 10 },
    heading: { fontSize: 15, fontWeight: "900", color: c.text, textAlign: "center" },
    note: { fontSize: 12, color: c.textSubtle, lineHeight: 19, textAlign: "center", marginTop: 10 },
    closeBtn: { backgroundColor: "#22A652", borderRadius: 12, paddingVertical: 11, alignItems: "center" },
    closeText: { color: "white", fontWeight: "900", fontSize: 13.5 },
  });
}
