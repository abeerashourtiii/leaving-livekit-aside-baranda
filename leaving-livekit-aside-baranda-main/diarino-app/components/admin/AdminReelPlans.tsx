import { useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, Alert, ActivityIndicator } from "react-native";
import { parseAdminInt, parseAdminMoney } from "../../lib/adminValidation";
import { openExternalUrl } from "../../lib/linking";
import {
  REEL_PLAN_STATUS_LABELS, ReelPlanStatus, AdminReelPlanOrder, useAdminReelPlanOrders, useAdminUpdateReelPlanOrder,
  useReelPlanSettings, useUpdateReelPlanSettings,
} from "../../lib/hooks/useReelPlans";
import { paymentMethodLabel } from "../../lib/paymentInfo";
import { logAndGetSafeMessage } from "../../lib/errors";
import { showToast } from "../shared/Toast";
import { useIsAdmin } from "../../lib/hooks/useIsAdmin";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ «باقات الريلز الشهرية» (قسم الصفقات والرسوم، صلاحية deals) — migration 20261121000300_reel_limit_plans.sql.
//   المسار مثل الترويج والمساحة الإعلانية: pending_payment (فاتورة) → submitted (المعلن أكّد السداد: فودافون كاش / اتصالات كاش / إنستاباي + اسم الراسل ثلاثيًا + رقم تواصل)
//   → راجِع التحويل فى محفظتك/حسابك وطابق الاسم والمبلغ ثم «تأكيد السداد وتفعيل الباقة»: يُرفع حد المعلن فورًا لمدة الاشتراك (30 يومًا من اليوم، أو من نهاية باقة
//   سارية لنفس النوع عند التجديد) ثم فترة سماح (30 يومًا) تبقى فيها المساحة الإضافية، وبعدها يعود الحد المجانى ويُمنع النشر لحين التجديد/الحذف (لا يُحذف شيء).
//   «رفض»/«إيقاف» يُسقط المساحة الإضافية فورًا. الأسعار والحدود فى الإعدادات (المشرف الرئيسى فقط).
const STATUS_COLORS: Record<ReelPlanStatus, string> = {
  pending_payment: "#D97706", submitted: "#0EA5E9", active: "#15803D", rejected: "#DC2626", cancelled: "#6B7280", expired: "#6B7280",
};
const FILTERS: { key: ReelPlanStatus | "all"; label: string }[] = [
  { key: "submitted", label: "بانتظار المراجعة" },
  { key: "pending_payment", label: "بانتظار السداد" },
  { key: "active", label: "المفعّلة" },
  { key: "all", label: "الكل" },
];

const fmtMoney = (n: number) => `${n.toLocaleString("en-US")} ج.م`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" }) : "—");

export function AdminReelPlans() {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { data: orders = [], isLoading, isError, error, refetch } = useAdminReelPlanOrders(true);
  const update = useAdminUpdateReelPlanOrder();
  const { settings } = useReelPlanSettings();
  const saveSettings = useUpdateReelPlanSettings();
  const { isSuperAdmin } = useIsAdmin();
  const [open, setOpen] = useState(false);

  const [filter, setFilter] = useState<ReelPlanStatus | "all">("submitted");
  const [free, setFree] = useState<string | null>(null);
  const [e1, setE1] = useState<string | null>(null);
  const [p1, setP1] = useState<string | null>(null);
  const [e2, setE2] = useState<string | null>(null);
  const [p2, setP2] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [grace, setGrace] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const visible = filter === "all" ? orders : orders.filter((o) => o.status === filter);
  const pendingReview = orders.filter((o) => o.status === "submitted").length;

  function setStatus(o: AdminReelPlanOrder, status: "pending_payment" | "submitted" | "active" | "rejected" | "cancelled") {
    update.mutate(
      { id: o.id, status, paymentRef: refs[o.id], adminNote: notes[o.id] },
      {
        onSuccess: () => showToast(status === "active" ? "تم تفعيل الباقة" : "تم تحديث الطلب"),
        onError: (e) => {
          if (e instanceof Error && e.message === "user_unavailable") {
            Alert.alert("تعذر التفعيل", "حساب المعلن محذوف، لا يمكن تفعيل باقة له.");
            return;
          }
          Alert.alert("تعذر التحديث", logAndGetSafeMessage("reel plan update failed", e, "تأكد من صلاحية قسم الصفقات وتطبيق migration 20261121000300 ثم حاول مرة أخرى."));
        },
      }
    );
  }

  function handleSaveSettings() {
    if (!isSuperAdmin) return;
    const raw = (v: string | null, fallback: number) => (v === null ? String(fallback) : v);
    const fl = parseAdminInt(raw(free, settings.freeLimit), 1, 1000);
    const x1 = parseAdminInt(raw(e1, settings.plan1Extra), 1, 5000);
    const x2 = parseAdminInt(raw(e2, settings.plan2Extra), 1, 5000);
    const pr1 = parseAdminMoney(raw(p1, settings.plan1PriceEgp));
    const pr2 = parseAdminMoney(raw(p2, settings.plan2PriceEgp));
    const pd = parseAdminInt(raw(period, settings.periodDays), 1, 365);
    const gd = parseAdminInt(raw(grace, settings.graceDays), 0, 365);
    if (fl === null) return Alert.alert("الحد المجاني يجب أن يكون عددًا صحيحًا من 1 إلى 1000");
    if (x1 === null || x2 === null) return Alert.alert("مساحة الباقة يجب أن تكون عددًا صحيحًا من 1 إلى 5000");
    if (pr1 === null || pr2 === null) return Alert.alert("قيمة سعر غير صحيحة", "اكتب رقمًا (0 أو أكثر) فى سعر كل باقة.");
    if (pd === null) return Alert.alert("مدة الاشتراك يجب أن تكون عددًا صحيحًا من 1 إلى 365 يومًا");
    if (gd === null) return Alert.alert("فترة السماح يجب أن تكون عددًا صحيحًا من 0 إلى 365 يومًا");
    const doSave = () =>
      saveSettings.mutate(
        { freeLimit: fl, plan1Extra: x1, plan1PriceEgp: pr1, plan2Extra: x2, plan2PriceEgp: pr2, periodDays: pd, graceDays: gd },
        {
          onSuccess: () => { showToast("تم حفظ إعدادات الباقات"); setFree(null); setE1(null); setP1(null); setE2(null); setP2(null); setPeriod(null); setGrace(null); },
          onError: (e) => Alert.alert("تعذر الحفظ", logAndGetSafeMessage("reel plan settings failed", e, "تأكد أنك المشرف الرئيسي وأن الـ migration طُبّقت.")),
        }
      );
    const warn: string[] = [];
    if (pr1 === 0 || pr2 === 0) warn.push("سعر باقة = 0 (مجانًا)");
    if (fl < settings.freeLimit) warn.push(`خفض الحد المجاني من ${settings.freeLimit} إلى ${fl} يمنع النشر لمن تجاوزه (لا يحذف إعلاناتهم)`);
    if (warn.length) {
      Alert.alert("تأكيد الحفظ", `${warn.join("\n")}\n\nتذكير: تغيير الأسعار والحدود يستلزم إخطار المعلنين قبلها بـ 30 يومًا حسب سياسة البيع والرسوم. متابعة؟`, [
        { text: "إلغاء", style: "cancel" },
        { text: "نعم، احفظ", style: "destructive", onPress: doSave },
      ]);
      return;
    }
    doSave();
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.card}>
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          <Text style={[styles.cardTitle, { flex: 1 }]}>إعدادات باقات الريلز {pendingReview ? `· ${pendingReview} بانتظار مراجعتك` : ""}</Text>
          <Text style={[styles.hint, { fontSize: 16 }]}>{open ? "▲" : "▼"}</Text>
        </Pressable>
        {open ? (
          <>
            {!isSuperAdmin ? <Text style={styles.hint}>عرض فقط — تغيير الأسعار والحدود من صلاحية المشرف الرئيسي، لأنه يستلزم إخطار المعلنين قبلها بـ 30 يومًا.</Text> : null}
            <Text style={styles.hint}>تُطبَّق الأسعار والمساحة الجديدة على الطلبات الجديدة فقط. الاشتراك يبدأ من لحظة التفعيل ثم تأتى فترة السماح.</Text>
            <Text style={styles.fieldLabel}>الحد المجاني للريلز لكل معلن</Text>
            <TextInput style={styles.input} keyboardType="number-pad" value={free ?? String(settings.freeLimit)} onChangeText={setFree} editable={isSuperAdmin} />
            <Text style={styles.fieldLabel}>الباقة الأولى — مساحة إضافية (ريل)</Text>
            <TextInput style={styles.input} keyboardType="number-pad" value={e1 ?? String(settings.plan1Extra)} onChangeText={setE1} editable={isSuperAdmin} />
            <Text style={styles.fieldLabel}>الباقة الأولى — السعر الشهرى (ج.م)</Text>
            <TextInput style={styles.input} keyboardType="number-pad" value={p1 ?? String(settings.plan1PriceEgp)} onChangeText={setP1} editable={isSuperAdmin} />
            <Text style={styles.fieldLabel}>الباقة الثانية — مساحة إضافية (ريل)</Text>
            <TextInput style={styles.input} keyboardType="number-pad" value={e2 ?? String(settings.plan2Extra)} onChangeText={setE2} editable={isSuperAdmin} />
            <Text style={styles.fieldLabel}>الباقة الثانية — السعر الشهرى (ج.م)</Text>
            <TextInput style={styles.input} keyboardType="number-pad" value={p2 ?? String(settings.plan2PriceEgp)} onChangeText={setP2} editable={isSuperAdmin} />
            <Text style={styles.fieldLabel}>مدة الاشتراك (أيام)</Text>
            <TextInput style={styles.input} keyboardType="number-pad" value={period ?? String(settings.periodDays)} onChangeText={setPeriod} editable={isSuperAdmin} />
            <Text style={styles.fieldLabel}>فترة السماح بعد الانتهاء (أيام)</Text>
            <TextInput style={styles.input} keyboardType="number-pad" value={grace ?? String(settings.graceDays)} onChangeText={setGrace} editable={isSuperAdmin} />
            {isSuperAdmin ? (
              <Pressable style={styles.primaryBtn} onPress={handleSaveSettings} disabled={saveSettings.isPending}>
                {saveSettings.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>حفظ الإعدادات</Text>}
              </Pressable>
            ) : null}
          </>
        ) : null}
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
          <Text style={styles.errorText}>تعذر تحميل طلبات الباقات (تأكد من تطبيق migration 20261121000300). اضغط لإعادة المحاولة.{error instanceof Error && error.message ? `\n(${error.message})` : ""}</Text>
        </Pressable>
      ) : visible.length === 0 ? (
        <Text style={styles.empty}>لا توجد طلبات في هذا التصنيف.</Text>
      ) : (
        visible.map((o) => {
          const cap = settings.freeLimit + o.extraReels;
          return (
            <View key={o.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.title} numberOfLines={2}>{`باقة +${o.extraReels} ريل (إجمالي ${cap}) — ${fmtMoney(o.priceEgp)}`}</Text>
                <View style={[styles.badge, { backgroundColor: STATUS_COLORS[o.status] }]}>
                  <Text style={styles.badgeText}>{REEL_PLAN_STATUS_LABELS[o.status]}</Text>
                </View>
              </View>
              <Text style={styles.hint}>
                أُنشئ: {fmtDate(o.createdAt)}{o.startsAt ? ` · بدأ: ${fmtDate(o.startsAt)}` : ""}{o.endsAt ? ` · ينتهي: ${fmtDate(o.endsAt)}` : ""}{o.graceEndsAt ? ` · السماح حتى: ${fmtDate(o.graceEndsAt)}` : ""}
              </Text>
              <Text style={styles.hint}>ريلز المعلن الحالية: {o.keptReels} (الحد بعد التفعيل {cap}) · مدة الاشتراك {o.periodDays} يومًا</Text>
              <Text style={styles.payer}>{o.payerName || "—"}</Text>
              <View style={styles.contactRow}>
                {o.payerPhone ? (
                  <>
                    <Pressable onPress={() => openExternalUrl(`tel:${o.payerPhone}`)}><Text style={styles.link}>📞 {o.payerPhone}</Text></Pressable>
                    <Pressable onPress={() => openExternalUrl(`https://wa.me/${o.payerPhone!.replace(/\D/g, "")}`)}><Text style={styles.link}>واتساب</Text></Pressable>
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
                      <Pressable onPress={() => openExternalUrl(`https://wa.me/${o.paymentContactPhone!.replace(/\D/g, "")}`)}><Text style={styles.link}>واتساب</Text></Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}
              {o.paymentRef ? <Text style={styles.hint}>مرجع السداد: {o.paymentRef}</Text> : null}
              {o.adminNote ? <Text style={styles.hint}>ملاحظة: {o.adminNote}</Text> : null}

              {(o.status === "submitted" || o.status === "pending_payment" || o.status === "rejected") && (
                <>
                  <TextInput
                    style={styles.input}
                    value={refs[o.id] ?? ""}
                    onChangeText={(v) => setRefs((r) => ({ ...r, [o.id]: v }))}
                    placeholder="مرجع التحويل / ملاحظة السداد"
                    placeholderTextColor={themeColors.textSubtle}
                  />
                  <TextInput
                    style={styles.input}
                    value={notes[o.id] ?? ""}
                    onChangeText={(v) => setNotes((r) => ({ ...r, [o.id]: v }))}
                    placeholder="ملاحظة للمعلن (تظهر عند الرفض)"
                    placeholderTextColor={themeColors.textSubtle}
                  />
                </>
              )}

              <View style={styles.actionsRow}>
                {(o.status === "submitted" || o.status === "pending_payment" || o.status === "rejected") && (
                  <Pressable style={[styles.actionBtn, { backgroundColor: "#15803D" }]} onPress={() => setStatus(o, "active")} disabled={update.isPending}>
                    <Text style={styles.actionText}>تأكيد السداد وتفعيل الباقة</Text>
                  </Pressable>
                )}
                {(o.status === "submitted" || o.status === "pending_payment") && (
                  <Pressable style={[styles.actionBtn, { backgroundColor: "#DC2626" }]} onPress={() => setStatus(o, "rejected")} disabled={update.isPending}>
                    <Text style={styles.actionText}>رفض</Text>
                  </Pressable>
                )}
                {o.status === "active" && (
                  <Pressable style={[styles.actionBtn, { backgroundColor: "#6B7280" }]} onPress={() => setStatus(o, "cancelled")} disabled={update.isPending}>
                    <Text style={styles.actionText}>إيقاف الباقة</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })
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
