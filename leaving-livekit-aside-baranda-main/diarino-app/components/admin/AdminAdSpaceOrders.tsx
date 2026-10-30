import { useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, Alert, ActivityIndicator, Linking } from "react-native";
import { Image } from "expo-image";
import { PROMO_STATUS_LABELS, PromoStatus } from "../../lib/hooks/usePromotions";
import { AdminAdSpaceOrder, useAdminAdSpaceOrders, useAdminUpdateAdSpaceOrder } from "../../lib/hooks/useAdSpaceOrders";
import { paymentMethodLabel } from "../../lib/paymentInfo";
import { cldOptimized } from "../../lib/cloudinary";
import { logAndGetSafeMessage } from "../../lib/errors";
import { showToast } from "../shared/Toast";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ حجوزات «المساحة الإعلانية» (من صفحة القائمة): الصورة + المدة + بيانات التحويل (طريقة السداد، اسم الراسل ثلاثيًا، رقم التواصل).
// راجع التحويل وصورة الإعلان (مطابقتها للشروط والسياسات) ثم «تأكيد السداد وتفعيل الإعلان»: بيُنشئ بانر فى «المساحة الإعلانية»
// (يظهر فى صفحة القائمة وفى صفحة البحث مع كل الفلاتر) بتاريخ نهاية حسب المدة. «رفض/إيقاف» بيوقف البانر لو كان شغالًا.
const STATUS_COLORS: Record<PromoStatus, string> = {
  pending_payment: "#D97706", submitted: "#0EA5E9", active: "#15803D", rejected: "#DC2626", cancelled: "#6B7280", expired: "#6B7280",
};
const FILTERS: { key: PromoStatus | "all"; label: string }[] = [
  { key: "submitted", label: "بانتظار المراجعة" },
  { key: "pending_payment", label: "بانتظار السداد" },
  { key: "active", label: "المفعّلة" },
  { key: "all", label: "الكل" },
];
const fmtMoney = (n: number) => `${n.toLocaleString("en-US")} ج.م`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" }) : "—");

export function AdminAdSpaceOrders() {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { data: orders = [], isLoading, isError, error, refetch } = useAdminAdSpaceOrders(true);
  const update = useAdminUpdateAdSpaceOrder();
  const [filter, setFilter] = useState<PromoStatus | "all">("submitted");
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const visible = filter === "all" ? orders : orders.filter((o) => o.status === filter);

  function setStatus(o: AdminAdSpaceOrder, status: "pending_payment" | "submitted" | "active" | "rejected" | "cancelled") {
    update.mutate(
      { id: o.id, status, paymentRef: refs[o.id], adminNote: notes[o.id] },
      {
        onSuccess: () => showToast(status === "active" ? "تم تفعيل الإعلان" : "تم تحديث الطلب"),
        onError: (e) => Alert.alert("تعذر التحديث", logAndGetSafeMessage("ad space update failed", e, "تأكد من صلاحية قسم الصفقات وحاول مرة أخرى.")),
      }
    );
  }

  if (isLoading) return <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} />;
  if (isError) {
    return (
      <Pressable style={styles.card} onPress={() => refetch()}>
        <Text style={styles.errorText}>تعذر تحميل حجوزات المساحة الإعلانية (تأكد من تطبيق آخر migrations — 20261027000000). اضغط لإعادة المحاولة.{error instanceof Error && error.message ? `\n(${error.message})` : ""}</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.filtersRow}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} style={[styles.filterChip, filter === f.key && styles.filterChipOn]} onPress={() => setFilter(f.key)}>
            <Text style={[styles.filterText, filter === f.key && styles.filterTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {visible.length === 0 ? (
        <Text style={styles.empty}>لا توجد حجوزات في هذا التصنيف. (أسعار الباقات تُعدَّل من تبويب «الترويج المدفوع».)</Text>
      ) : (
        visible.map((o) => (
          <View key={o.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.title} numberOfLines={1}>{o.title || "—"}</Text>
              <View style={[styles.badge, { backgroundColor: STATUS_COLORS[o.status] }]}>
                <Text style={styles.badgeText}>{PROMO_STATUS_LABELS[o.status]}</Text>
              </View>
            </View>
            <View style={styles.previewBox}>
              <Image source={{ uri: cldOptimized(o.imageUrl, "w_700,q_auto,f_auto") }} style={styles.preview} contentFit="cover" />
            </View>
            <Text style={styles.hint}>
              {o.durationDays} يومًا · {fmtMoney(o.priceEgp)} · أُنشئ: {fmtDate(o.createdAt)}
              {o.startsAt ? ` · بدأ: ${fmtDate(o.startsAt)}` : ""}{o.endsAt ? ` · ينتهي: ${fmtDate(o.endsAt)}` : ""}
            </Text>
            <Text style={styles.payer}>{o.payerName || "—"}</Text>
            <View style={styles.contactRow}>
              {o.payerPhone ? (
                <>
                  <Pressable onPress={() => Linking.openURL(`tel:${o.payerPhone}`)}><Text style={styles.link}>📞 {o.payerPhone}</Text></Pressable>
                  <Pressable onPress={() => Linking.openURL(`https://wa.me/${o.payerPhone!.replace(/\D/g, "")}`)}><Text style={styles.link}>واتساب</Text></Pressable>
                </>
              ) : null}
              {o.payerEmail ? <Text style={styles.hint} selectable>{o.payerEmail}</Text> : null}
            </View>

            {(o.paymentSenderName || o.paymentContactPhone) ? (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmTitle}>تأكيد السداد من المعلن{o.paymentSubmittedAt ? ` · ${fmtDate(o.paymentSubmittedAt)}` : ""}</Text>
                <Text style={styles.hint} selectable>طريقة السداد: {paymentMethodLabel(o.paymentMethod) || "—"}</Text>
                <Text style={styles.hint} selectable>اسم الراسل: {o.paymentSenderName || "—"}</Text>
                <View style={styles.contactRow}>
                  <Text style={styles.hint} selectable>رقم التواصل: {o.paymentContactPhone || "—"}</Text>
                  {o.paymentContactPhone ? (
                    <Pressable onPress={() => Linking.openURL(`https://wa.me/${o.paymentContactPhone!.replace(/\D/g, "")}`)}><Text style={styles.link}>واتساب</Text></Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
            {o.paymentRef ? <Text style={styles.hint}>مرجع السداد: {o.paymentRef}</Text> : null}
            {o.adminNote ? <Text style={styles.hint}>ملاحظة: {o.adminNote}</Text> : null}

            {(o.status === "submitted" || o.status === "pending_payment" || o.status === "rejected") && (
              <>
                <TextInput style={styles.input} value={refs[o.id] ?? ""} onChangeText={(v) => setRefs((r) => ({ ...r, [o.id]: v }))} placeholder="مرجع التحويل / ملاحظة السداد" placeholderTextColor={themeColors.textSubtle} />
                <TextInput style={styles.input} value={notes[o.id] ?? ""} onChangeText={(v) => setNotes((r) => ({ ...r, [o.id]: v }))} placeholder="ملاحظة للمعلن (تظهر عند الرفض)" placeholderTextColor={themeColors.textSubtle} />
              </>
            )}
            <View style={styles.actionsRow}>
              {(o.status === "submitted" || o.status === "pending_payment" || o.status === "rejected") && (
                <Pressable style={[styles.actionBtn, { backgroundColor: "#15803D" }]} onPress={() => setStatus(o, "active")} disabled={update.isPending}>
                  <Text style={styles.actionText}>تأكيد السداد وتفعيل الإعلان</Text>
                </Pressable>
              )}
              {(o.status === "submitted" || o.status === "pending_payment") && (
                <Pressable style={[styles.actionBtn, { backgroundColor: "#DC2626" }]} onPress={() => setStatus(o, "rejected")} disabled={update.isPending}>
                  <Text style={styles.actionText}>رفض</Text>
                </Pressable>
              )}
              {o.status === "active" && (
                <Pressable style={[styles.actionBtn, { backgroundColor: "#6B7280" }]} onPress={() => setStatus(o, "cancelled")} disabled={update.isPending}>
                  <Text style={styles.actionText}>إيقاف الإعلان</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: themeColors.card, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: themeColors.border },
    hint: { fontSize: 12, color: themeColors.textSubtle, lineHeight: 19 },
    input: { backgroundColor: themeColors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, color: themeColors.text, borderWidth: 1, borderColor: themeColors.border },
    filtersRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    filterChip: { borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.border },
    filterChipOn: { backgroundColor: "#6366f1", borderColor: "#6366f1" },
    filterText: { fontSize: 12.5, fontWeight: "800", color: themeColors.textMuted },
    filterTextOn: { color: "#fff" },
    empty: { textAlign: "center", color: themeColors.textSubtle, marginTop: 20, fontSize: 13 },
    errorText: { color: "#DC2626", fontSize: 12.5, fontWeight: "800", textAlign: "center" },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
    title: { flex: 1, fontSize: 14, fontWeight: "900", color: themeColors.text },
    badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, maxWidth: "50%" },
    badgeText: { color: "#fff", fontSize: 11, fontWeight: "800", textAlign: "center" },
    previewBox: { aspectRatio: 1400 / 620, borderRadius: 12, overflow: "hidden", backgroundColor: themeColors.surface },
    preview: { width: "100%", height: "100%" },
    payer: { fontSize: 13, fontWeight: "800", color: themeColors.text },
    contactRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
    link: { color: "#6366f1", fontWeight: "800", fontSize: 12.5 },
    confirmBox: { backgroundColor: themeColors.isDark ? "rgba(14,165,233,0.14)" : "#f0f9ff", borderRadius: 12, padding: 10, gap: 4, borderWidth: 1, borderColor: "#0EA5E9" },
    confirmTitle: { fontSize: 12.5, fontWeight: "900", color: "#0369A1" },
    actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    actionBtn: { borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14 },
    actionText: { color: "#fff", fontSize: 12.5, fontWeight: "900" },
  });
}
