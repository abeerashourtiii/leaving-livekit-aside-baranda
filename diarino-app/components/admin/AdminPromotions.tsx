import { useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, Alert, ActivityIndicator, Linking } from "react-native";
import {
  PROMO_KIND_LABELS, PROMO_STATUS_LABELS, PromoStatus, AdminPromotion, ageGroupLabel,
  useAdminPromotions, useAdminUpdatePromotion, usePromoSettings, useUpdatePromoSettings,
} from "../../lib/hooks/usePromotions";
import { paymentMethodLabel } from "../../lib/paymentInfo";
import { logAndGetSafeMessage } from "../../lib/errors";
import { showToast } from "../shared/Toast";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ «الترويج المدفوع» (اجعل الإعلان افتتاحي / مميز) — صلاحية deals. المسار: pending_payment (فاتورة صدرت) → submitted (الناشر أكّد السداد
// بطريقة + اسم ثلاثى + رقم تواصل) → راجِع التحويل فى محفظتك/حسابك وطابق الاسم والمبلغ ثم «تأكيد السداد وتفعيل الترويج»:
// بيُنشئ تلقائيًا صف فى «الريلز المميزة» (افتتاحي intro / مميز in_feed) لمدة 7 أيام (من اليوم) بنفس الفئة العمرية والهدف.
// «رفض» أو «إلغاء» بيوقف الترويج لو كان شغالًا. الأسعار والمدة من الإعدادات تحت.
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

export function AdminPromotions() {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { data: promos = [], isLoading, isError, refetch } = useAdminPromotions(true);
  const update = useAdminUpdatePromotion();
  const { settings } = usePromoSettings();
  const saveSettings = useUpdatePromoSettings();

  const [filter, setFilter] = useState<PromoStatus | "all">("submitted");
  const [featured, setFeatured] = useState<string | null>(null);
  const [intro3000, setIntro3000] = useState<string | null>(null);
  const [intro5000, setIntro5000] = useState<string | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const [b7, setB7] = useState<string | null>(null);
  const [b14, setB14] = useState<string | null>(null);
  const [b30, setB30] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const visible = filter === "all" ? promos : promos.filter((p) => p.status === filter);
  const pendingReview = promos.filter((p) => p.status === "submitted").length;

  function setStatus(p: AdminPromotion, status: "pending_payment" | "submitted" | "active" | "rejected" | "cancelled") {
    update.mutate(
      { id: p.id, status, paymentRef: refs[p.id], adminNote: notes[p.id] },
      {
        onSuccess: () => showToast(status === "active" ? "تم تفعيل الترويج" : "تم تحديث الطلب"),
        onError: (e) => {
          if (e instanceof Error && e.message === "property_unavailable") {
            Alert.alert("تعذر التفعيل", "الإعلان محذوف أو أُغلق بصفقة، لا يمكن ترويجه.");
            return;
          }
          Alert.alert("تعذر التحديث", logAndGetSafeMessage("promotion update failed", e, "تأكد من صلاحية قسم الصفقات وحاول مرة أخرى."));
        },
      }
    );
  }

  function handleSaveSettings() {
    const f = Number(featured ?? settings.featuredPriceEgp);
    const a = Number(intro3000 ?? settings.intro3000PriceEgp);
    const b = Number(intro5000 ?? settings.intro5000PriceEgp);
    const d = Number(days ?? settings.durationDays);
    const x7 = Number(b7 ?? settings.banner7PriceEgp);
    const x14 = Number(b14 ?? settings.banner14PriceEgp);
    const x30 = Number(b30 ?? settings.banner30PriceEgp);
    if ([f, a, b, x7, x14, x30].some((n) => !Number.isFinite(n) || n < 0)) return Alert.alert("قيمة سعر غير صحيحة");
    if (!Number.isInteger(d) || d < 1 || d > 90) return Alert.alert("المدة يجب أن تكون من 1 إلى 90 يومًا");
    saveSettings.mutate(
      { featuredPriceEgp: f, intro3000PriceEgp: a, intro5000PriceEgp: b, durationDays: d, banner7PriceEgp: x7, banner14PriceEgp: x14, banner30PriceEgp: x30 },
      {
        onSuccess: () => { showToast("تم حفظ إعدادات الترويج"); setFeatured(null); setIntro3000(null); setIntro5000(null); setDays(null); setB7(null); setB14(null); setB30(null); },
        onError: (e) => Alert.alert("تعذر الحفظ", logAndGetSafeMessage("promo settings failed", e, "تأكد من الصلاحية وحاول مرة أخرى.")),
      }
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>أسعار الترويج {pendingReview ? `· ${pendingReview} بانتظار مراجعتك` : ""}</Text>
        <Text style={styles.hint}>تُطبَّق الأسعار الجديدة على الطلبات الجديدة فقط. المدة تبدأ من لحظة التفعيل.</Text>
        <Text style={styles.fieldLabel}>الإعلان المميز (ج.م)</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={featured ?? String(settings.featuredPriceEgp)} onChangeText={setFeatured} />
        <Text style={styles.fieldLabel}>الافتتاحي — هدف 3000 (ج.م)</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={intro3000 ?? String(settings.intro3000PriceEgp)} onChangeText={setIntro3000} />
        <Text style={styles.fieldLabel}>الافتتاحي — هدف 5000 (ج.م)</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={intro5000 ?? String(settings.intro5000PriceEgp)} onChangeText={setIntro5000} />
        <Text style={styles.fieldLabel}>مدة الترويج (أيام)</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={days ?? String(settings.durationDays)} onChangeText={setDays} />
        <Text style={styles.cardTitle}>أسعار المساحة الإعلانية (بانر القائمة والبحث)</Text>
        <Text style={styles.fieldLabel}>7 أيام (ج.م)</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={b7 ?? String(settings.banner7PriceEgp)} onChangeText={setB7} />
        <Text style={styles.fieldLabel}>14 يومًا (ج.م)</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={b14 ?? String(settings.banner14PriceEgp)} onChangeText={setB14} />
        <Text style={styles.fieldLabel}>30 يومًا (ج.م)</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={b30 ?? String(settings.banner30PriceEgp)} onChangeText={setB30} />
        <Pressable style={[styles.primaryBtn, saveSettings.isPending && { opacity: 0.6 }]} onPress={handleSaveSettings} disabled={saveSettings.isPending}>
          {saveSettings.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>حفظ الإعدادات</Text>}
        </Pressable>
      </View>

      <View style={styles.filtersRow}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} style={[styles.filterChip, filter === f.key && styles.filterChipOn]} onPress={() => setFilter(f.key)}>
            <Text style={[styles.filterText, filter === f.key && styles.filterTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} />
      ) : isError ? (
        <Pressable style={styles.card} onPress={() => refetch()}>
          <Text style={styles.errorText}>تعذر تحميل طلبات الترويج (تأكد من تطبيق migration 20261023000000). اضغط لإعادة المحاولة.</Text>
        </Pressable>
      ) : visible.length === 0 ? (
        <Text style={styles.empty}>لا توجد طلبات في هذا التصنيف.</Text>
      ) : (
        visible.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.title} numberOfLines={2}>{p.propertyTitle || "—"}</Text>
              <View style={[styles.badge, { backgroundColor: STATUS_COLORS[p.status] }]}>
                <Text style={styles.badgeText}>{PROMO_STATUS_LABELS[p.status]}</Text>
              </View>
            </View>
            <Text style={styles.hint}>
              {PROMO_KIND_LABELS[p.kind]}{p.reachGoal ? ` · هدف ${p.reachGoal.toLocaleString("en-US")}` : ""} · {ageGroupLabel(p.ageMin, p.ageMax)} · {p.durationDays} أيام · {fmtMoney(p.priceEgp)}
            </Text>
            <Text style={styles.hint}>
              أُنشئ: {fmtDate(p.createdAt)}{p.startsAt ? ` · بدأ: ${fmtDate(p.startsAt)}` : ""}{p.endsAt ? ` · ينتهي: ${fmtDate(p.endsAt)}` : ""}
              {p.status === "active" && p.kind === "intro" && p.reachGoal ? ` · الوصول ${p.currentReach}/${p.reachGoal}` : ""}
            </Text>
            <Text style={styles.payer}>{p.payerName || "—"}</Text>
            <View style={styles.contactRow}>
              {p.payerPhone ? (
                <>
                  <Pressable onPress={() => Linking.openURL(`tel:${p.payerPhone}`)}><Text style={styles.link}>📞 {p.payerPhone}</Text></Pressable>
                  <Pressable onPress={() => Linking.openURL(`https://wa.me/${p.payerPhone!.replace(/\D/g, "")}`)}><Text style={styles.link}>واتساب</Text></Pressable>
                </>
              ) : null}
              {p.payerEmail ? <Text style={styles.hint} selectable>{p.payerEmail}</Text> : null}
            </View>

            {(p.paymentSenderName || p.paymentContactPhone) ? (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmTitle}>تأكيد السداد من المعلن{p.paymentSubmittedAt ? ` · ${fmtDate(p.paymentSubmittedAt)}` : ""}</Text>
                <Text style={styles.hint} selectable>طريقة السداد: {paymentMethodLabel(p.paymentMethod) || "—"}</Text>
                <Text style={styles.hint} selectable>اسم الراسل: {p.paymentSenderName || "—"}</Text>
                <View style={styles.contactRow}>
                  <Text style={styles.hint} selectable>رقم التواصل: {p.paymentContactPhone || "—"}</Text>
                  {p.paymentContactPhone ? (
                    <Pressable onPress={() => Linking.openURL(`https://wa.me/${p.paymentContactPhone!.replace(/\D/g, "")}`)}><Text style={styles.link}>واتساب</Text></Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
            {p.paymentRef ? <Text style={styles.hint}>مرجع السداد: {p.paymentRef}</Text> : null}
            {p.adminNote ? <Text style={styles.hint}>ملاحظة: {p.adminNote}</Text> : null}

            {(p.status === "submitted" || p.status === "pending_payment" || p.status === "rejected") && (
              <>
                <TextInput
                  style={styles.input}
                  value={refs[p.id] ?? ""}
                  onChangeText={(v) => setRefs((r) => ({ ...r, [p.id]: v }))}
                  placeholder="مرجع التحويل / ملاحظة السداد (اختياري)"
                  placeholderTextColor={themeColors.textSubtle}
                />
                <TextInput
                  style={styles.input}
                  value={notes[p.id] ?? ""}
                  onChangeText={(v) => setNotes((r) => ({ ...r, [p.id]: v }))}
                  placeholder="ملاحظة للمعلن (تظهر عند الرفض)"
                  placeholderTextColor={themeColors.textSubtle}
                />
              </>
            )}

            <View style={styles.actionsRow}>
              {(p.status === "submitted" || p.status === "pending_payment" || p.status === "rejected") && (
                <Pressable style={[styles.actionBtn, { backgroundColor: "#15803D" }]} onPress={() => setStatus(p, "active")} disabled={update.isPending}>
                  <Text style={styles.actionText}>تأكيد السداد وتفعيل الترويج</Text>
                </Pressable>
              )}
              {(p.status === "submitted" || p.status === "pending_payment") && (
                <Pressable style={[styles.actionBtn, { backgroundColor: "#DC2626" }]} onPress={() => setStatus(p, "rejected")} disabled={update.isPending}>
                  <Text style={styles.actionText}>رفض</Text>
                </Pressable>
              )}
              {p.status === "active" && (
                <Pressable style={[styles.actionBtn, { backgroundColor: "#6B7280" }]} onPress={() => setStatus(p, "cancelled")} disabled={update.isPending}>
                  <Text style={styles.actionText}>إيقاف الترويج</Text>
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
    cardTitle: { fontSize: 14, fontWeight: "900", color: themeColors.text },
    hint: { fontSize: 12, color: themeColors.textSubtle, lineHeight: 19 },
    fieldLabel: { fontSize: 12.5, fontWeight: "800", color: themeColors.textMuted },
    input: { backgroundColor: themeColors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, color: themeColors.text, borderWidth: 1, borderColor: themeColors.border },
    primaryBtn: { backgroundColor: "#6366f1", borderRadius: 999, paddingVertical: 12, alignItems: "center" },
    primaryBtnText: { color: "#fff", fontWeight: "900", fontSize: 13.5 },
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
