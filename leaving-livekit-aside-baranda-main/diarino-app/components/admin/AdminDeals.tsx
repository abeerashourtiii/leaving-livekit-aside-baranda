import { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, Alert, ActivityIndicator, Linking } from "react-native";
import {
  useAdminDeals, useAdminUpdateDeal, useDealSettings, useUpdateDealSettings,
  AdminDealRow, DealStatus, DEAL_STATUS_LABELS,
} from "../../lib/hooks/useDeals";
import { ACCOUNT_TYPE_LABELS, isAccountType } from "../../lib/accountTypes";
import { logAndGetSafeMessage } from "../../lib/errors";
import { showToast } from "../shared/Toast";
import { paymentMethodLabel } from "../../lib/paymentInfo";
import { AdminPromotions } from "./AdminPromotions";
import { AdminAdSpaceOrders } from "./AdminAdSpaceOrders";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ لوحة «الصفقات والرسوم» (صلاحية قسم deals): كل صفقة بيع/تأجير بلّغ عنها الناشر + حالة الرسم + بيانات التواصل للتحصيل.
// الحالات: reported (مستحق) → invoiced (أُرسلت مطالبة) → submitted (الناشر أكّد السداد عبر إنستاباي، بانتظار مراجعتك)
//         → paid | disputed | waived (ملغاة، مع خيار إعادة فتح الإعلان).
// الرسوم: بيع (fee_egp) وإيجار (fee_rent_egp). راجع التحويل (فودافون كاش / اتصالات كاش / إنستاباي) وطابق «اسم الراسل ورقم التواصل» ثم اضغط «تم السداد».
// الدفع بيتسجّل يدويًا هنا (مرجع التحويل) — بوابة دفع إلكترونية ممكن تتضاف لاحقًا من غير تغيير فى الجدول.
const FILTERS: { key: "open" | DealStatus | "all"; label: string }[] = [
  { key: "open", label: "المستحقة" },
  { key: "submitted", label: "بانتظار مراجعة السداد" },
  { key: "paid", label: "المسددة" },
  { key: "disputed", label: "قيد المراجعة" },
  { key: "waived", label: "الملغاة" },
  { key: "all", label: "الكل" },
];

const STATUS_COLORS: Record<DealStatus, string> = {
  reported: "#D97706", invoiced: "#2563EB", submitted: "#0EA5E9", paid: "#15803D", disputed: "#7C3AED", waived: "#6B7280",
};

const fmtMoney = (n: number) => `${n.toLocaleString("en-US")} ج.م`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" }) : "—");

// ↔ تبويبان: «الصفقات والرسوم» (رسوم تم البيع/تم الإيجار) و«الترويج المدفوع» (اجعل الإعلان افتتاحي/مميز) — نفس صلاحية deals.
export function AdminDeals() {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const [tab, setTab] = useState<"deals" | "promos" | "space">("deals");
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.tabsRow}>
        <Pressable style={[styles.tabBtn, tab === "deals" && styles.tabBtnOn]} onPress={() => setTab("deals")}>
          <Text style={[styles.tabText, tab === "deals" && styles.tabTextOn]}>الصفقات والرسوم</Text>
        </Pressable>
        <Pressable style={[styles.tabBtn, tab === "promos" && styles.tabBtnOn]} onPress={() => setTab("promos")}>
          <Text style={[styles.tabText, tab === "promos" && styles.tabTextOn]}>الترويج المدفوع</Text>
        </Pressable>
        <Pressable style={[styles.tabBtn, tab === "space" && styles.tabBtnOn]} onPress={() => setTab("space")}>
          <Text style={[styles.tabText, tab === "space" && styles.tabTextOn]}>المساحة الإعلانية</Text>
        </Pressable>
      </View>
      {tab === "deals" ? <AdminDealsList /> : tab === "promos" ? <AdminPromotions /> : <AdminAdSpaceOrders />}
    </View>
  );
}

function AdminDealsList() {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { data: deals = [], isLoading, isError, error, refetch } = useAdminDeals();
  const update = useAdminUpdateDeal();
  const { settings } = useDealSettings();
  const saveSettings = useUpdateDealSettings();

  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("open");
  const [fee, setFee] = useState<string | null>(null);
  const [feeRent, setFeeRent] = useState<string | null>(null);
  const [payDays, setPayDays] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const totals = useMemo(() => {
    const due = deals.filter((d) => d.status === "reported" || d.status === "invoiced" || d.status === "submitted" || d.status === "disputed");
    const paid = deals.filter((d) => d.status === "paid");
    const sum = (rows: AdminDealRow[]) => rows.reduce((a, d) => a + d.feeEgp, 0);
    return { dueCount: due.length, dueSum: sum(due), paidCount: paid.length, paidSum: sum(paid) };
  }, [deals]);

  const visible = useMemo(() => {
    if (filter === "all") return deals;
    if (filter === "open") return deals.filter((d) => d.status === "reported" || d.status === "invoiced");
    return deals.filter((d) => d.status === filter);
  }, [deals, filter]);

  function setStatus(d: AdminDealRow, status: DealStatus, reopen = false) {
    update.mutate(
      { id: d.id, status, paymentRef: refs[d.id], adminNote: notes[d.id], reopen },
      {
        onSuccess: () => showToast("تم تحديث الصفقة"),
        onError: (e) => Alert.alert("تعذر التحديث", logAndGetSafeMessage("deal update failed", e, "تأكد من صلاحية قسم الصفقات وحاول مرة أخرى.")),
      }
    );
  }

  function confirmWaive(d: AdminDealRow) {
    Alert.alert("إلغاء الصفقة؟", `${d.propertyTitle}\nستُلغى الصفقة ولن يُحتسب رسمها. هل تريد إعادة فتح الإعلان وإظهاره للمستخدمين؟`, [
      { text: "تراجع", style: "cancel" },
      { text: "إلغاء فقط", onPress: () => setStatus(d, "waived", false) },
      { text: "إلغاء وإعادة فتح الإعلان", onPress: () => setStatus(d, "waived", true) },
    ]);
  }

  function handleSaveSettings() {
    const feeNum = Number(fee ?? settings.feeEgp);
    const feeRentNum = Number(feeRent ?? settings.feeRentEgp);
    const daysNum = Number(payDays ?? settings.payDays);
    if (!Number.isFinite(feeNum) || feeNum < 0) return Alert.alert("قيمة رسم البيع غير صحيحة");
    if (!Number.isFinite(feeRentNum) || feeRentNum < 0) return Alert.alert("قيمة رسم الإيجار غير صحيحة");
    if (!Number.isInteger(daysNum) || daysNum < 0) return Alert.alert("مهلة السداد غير صحيحة");
    saveSettings.mutate(
      { ...settings, feeEgp: feeNum, feeRentEgp: feeRentNum, payDays: daysNum, paymentInstructions: instructions ?? settings.paymentInstructions },
      {
        onSuccess: () => { showToast("تم حفظ الإعدادات"); setFee(null); setFeeRent(null); setPayDays(null); setInstructions(null); },
        onError: (e) => Alert.alert("تعذر الحفظ", logAndGetSafeMessage("deal settings failed", e, "حاول مرة أخرى.")),
      }
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.totalsRow}>
        <View style={[styles.totalCard, { borderColor: "#D97706" }]}>
          <Text style={styles.totalNum}>{fmtMoney(totals.dueSum)}</Text>
          <Text style={styles.totalLabel}>مستحق ({totals.dueCount} صفقة)</Text>
        </View>
        <View style={[styles.totalCard, { borderColor: "#15803D" }]}>
          <Text style={styles.totalNum}>{fmtMoney(totals.paidSum)}</Text>
          <Text style={styles.totalLabel}>محصَّل ({totals.paidCount} صفقة)</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>إعدادات الرسوم</Text>
        <Text style={styles.hint}>القيمة الحالية تُطبَّق على الصفقات الجديدة فقط، وتظهر للناشرين قبل النشر وعند تسجيل الصفقة. أخطر الناشرين قبل تغييرها بـ 30 يومًا (سياسة البيع والرسوم).</Text>
        <Text style={styles.fieldLabel}>رسوم الخدمة — البيع (ج.م)</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={fee ?? String(settings.feeEgp)} onChangeText={setFee} />
        <Text style={styles.fieldLabel}>رسوم الخدمة — الإيجار (ج.م)</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={feeRent ?? String(settings.feeRentEgp)} onChangeText={setFeeRent} />
        <Text style={styles.fieldLabel}>مهلة السداد (أيام)</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={payDays ?? String(settings.payDays)} onChangeText={setPayDays} />
        <Text style={styles.fieldLabel}>ملاحظة إضافية تظهر فى صفحة الفاتورة (بيانات حساب إنستاباي نفسها فى lib/paymentInfo.ts)</Text>
        <TextInput
          style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
          multiline
          value={instructions ?? settings.paymentInstructions ?? ""}
          onChangeText={setInstructions}
          placeholder="مثال: حوّل المبلغ على InstaPay إلى ... ثم أرسل إيصال التحويل عبر الدعم."
          placeholderTextColor={themeColors.textSubtle}
        />
        <Pressable style={[styles.primaryBtn, saveSettings.isPending && { opacity: 0.6 }]} onPress={handleSaveSettings} disabled={saveSettings.isPending}>
          {saveSettings.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>حفظ الإعدادات</Text>}
        </Pressable>
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} style={[styles.chip, filter === f.key && styles.chipOn]} onPress={() => setFilter(f.key)}>
            <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading && <ActivityIndicator color="#6366f1" />}
      {isError && (
        <View style={styles.card}>
          <Text style={styles.hint}>تعذر تحميل الصفقات. تأكد من تطبيق آخر migrations (20261027000000_fix_admin_finance_lists.sql) ومن امتلاكك صلاحية قسم «الصفقات والرسوم».{error instanceof Error && error.message ? `\n(${error.message})` : ""}</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => refetch()}><Text style={styles.secondaryBtnText}>إعادة المحاولة</Text></Pressable>
        </View>
      )}
      {!isLoading && !isError && visible.length === 0 && <Text style={styles.hint}>لا توجد صفقات في هذا التصنيف.</Text>}

      {visible.map((d) => {
        const overdue = (d.status === "reported" || d.status === "invoiced") && d.dueAt != null && new Date(d.dueAt).getTime() < Date.now();
        return (
          <View key={d.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.dealTitle} numberOfLines={2}>{d.propertyTitle || "—"}</Text>
              <View style={[styles.badge, { backgroundColor: STATUS_COLORS[d.status] }]}>
                <Text style={styles.badgeText}>{DEAL_STATUS_LABELS[d.status]}</Text>
              </View>
            </View>
            <Text style={styles.hint}>
              {d.dealType === "rent" ? "تأجير" : "بيع"} · {d.propertyProvince ?? "—"} · الرسم {fmtMoney(d.feeEgp)}
            </Text>
            <Text style={styles.hint}>
              أُبلغ: {fmtDate(d.reportedAt)} · الاستحقاق: {fmtDate(d.dueAt)}{overdue ? " ⚠ متأخر" : ""}{d.paidAt ? ` · سُدِّد: ${fmtDate(d.paidAt)}` : ""}
            </Text>
            <Text style={styles.payer}>
              {d.payerName || "—"} {d.payerAccountType && isAccountType(d.payerAccountType) ? `· ${ACCOUNT_TYPE_LABELS[d.payerAccountType]}` : ""}
            </Text>
            <View style={styles.contactRow}>
              {d.payerPhone ? (
                <>
                  <Pressable onPress={() => Linking.openURL(`tel:${d.payerPhone}`)}><Text style={styles.link}>📞 {d.payerPhone}</Text></Pressable>
                  <Pressable onPress={() => Linking.openURL(`https://wa.me/${d.payerPhone!.replace(/\D/g, "")}`)}><Text style={styles.link}>واتساب</Text></Pressable>
                </>
              ) : null}
              {d.payerEmail ? <Text style={styles.hint} selectable>{d.payerEmail}</Text> : null}
            </View>
            {(d.paymentSenderName || d.paymentSenderEmail || d.paymentContactPhone) ? (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmTitle}>تأكيد السداد من الناشر{d.paymentSubmittedAt ? ` · ${fmtDate(d.paymentSubmittedAt)}` : ""}</Text>
                <Text style={styles.hint} selectable>طريقة السداد: {paymentMethodLabel(d.paymentMethod) || "إنستاباي"}</Text>
                <Text style={styles.hint} selectable>اسم الراسل: {d.paymentSenderName || "—"}</Text>
                {d.paymentSenderEmail ? <Text style={styles.hint} selectable>إيميل إنستاباي (نسخة قديمة): {d.paymentSenderEmail}</Text> : null}
                <View style={styles.contactRow}>
                  <Text style={styles.hint} selectable>رقم التواصل: {d.paymentContactPhone || "—"}</Text>
                  {d.paymentContactPhone ? (
                    <Pressable onPress={() => Linking.openURL(`https://wa.me/${d.paymentContactPhone!.replace(/\D/g, "")}`)}><Text style={styles.link}>واتساب</Text></Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
            {d.paymentRef ? <Text style={styles.hint}>مرجع السداد: {d.paymentRef}</Text> : null}
            {d.adminNote ? <Text style={styles.hint}>ملاحظة: {d.adminNote}</Text> : null}
            {d.note ? <Text style={styles.hint}>ملاحظة الناشر: {d.note}</Text> : null}

            {d.status !== "waived" && (
              <>
                <TextInput
                  style={styles.input}
                  value={refs[d.id] ?? ""}
                  onChangeText={(v) => setRefs((r) => ({ ...r, [d.id]: v }))}
                  placeholder="مرجع السداد / رقم التحويل (عند تسجيل السداد)"
                  placeholderTextColor={themeColors.textSubtle}
                />
                <TextInput
                  style={styles.input}
                  value={notes[d.id] ?? ""}
                  onChangeText={(v) => setNotes((r) => ({ ...r, [d.id]: v }))}
                  placeholder="ملاحظة إدارية"
                  placeholderTextColor={themeColors.textSubtle}
                />
                <View style={styles.actions}>
                  {d.status !== "paid" && (
                    <Pressable style={[styles.actionBtn, { backgroundColor: "#15803D" }]} onPress={() => setStatus(d, "paid")} disabled={update.isPending}>
                      <Text style={styles.actionText}>تم السداد</Text>
                    </Pressable>
                  )}
                  {d.status === "submitted" && (
                    <Pressable style={[styles.actionBtn, { backgroundColor: "#2563EB" }]} onPress={() => setStatus(d, "invoiced")} disabled={update.isPending}>
                      <Text style={styles.actionText}>لم يصل التحويل — إعادة للمستحق</Text>
                    </Pressable>
                  )}
                  {d.status === "reported" && (
                    <Pressable style={[styles.actionBtn, { backgroundColor: "#2563EB" }]} onPress={() => setStatus(d, "invoiced")} disabled={update.isPending}>
                      <Text style={styles.actionText}>أُرسلت مطالبة</Text>
                    </Pressable>
                  )}
                  {d.status !== "disputed" && d.status !== "paid" && (
                    <Pressable style={[styles.actionBtn, { backgroundColor: "#7C3AED" }]} onPress={() => setStatus(d, "disputed")} disabled={update.isPending}>
                      <Text style={styles.actionText}>قيد المراجعة</Text>
                    </Pressable>
                  )}
                  <Pressable style={[styles.actionBtn, { backgroundColor: "#6B7280" }]} onPress={() => confirmWaive(d)} disabled={update.isPending}>
                    <Text style={styles.actionText}>إلغاء الصفقة</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    totalsRow: { flexDirection: "row", gap: 10 },
    totalCard: { flex: 1, backgroundColor: themeColors.card, borderRadius: 14, borderWidth: 1.5, padding: 12, gap: 2 },
    totalNum: { fontSize: 16, fontWeight: "900", color: themeColors.text },
    totalLabel: { fontSize: 11.5, color: themeColors.textSubtle, fontWeight: "700" },
    card: { backgroundColor: themeColors.card, borderRadius: 16, padding: 14, gap: 8, borderWidth: 1, borderColor: themeColors.border },
    cardTitle: { fontSize: 14, fontWeight: "900", color: themeColors.text },
    hint: { fontSize: 11.5, color: themeColors.textSubtle, lineHeight: 18 },
    fieldLabel: { fontSize: 12, fontWeight: "800", color: themeColors.textMuted },
    input: { backgroundColor: themeColors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: themeColors.text, borderWidth: 1, borderColor: themeColors.border },
    primaryBtn: { backgroundColor: "#6366f1", borderRadius: 999, paddingVertical: 12, alignItems: "center" },
    primaryBtnText: { color: "#fff", fontSize: 13, fontWeight: "900" },
    secondaryBtn: { backgroundColor: themeColors.isDark ? "rgba(99,102,241,0.18)" : "#eef2ff", borderRadius: 12, paddingVertical: 11, alignItems: "center" },
    secondaryBtnText: { color: "#6366f1", fontSize: 12.5, fontWeight: "800" },
    filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: themeColors.border, backgroundColor: themeColors.card },
    chipOn: { backgroundColor: "#6366f1", borderColor: "#6366f1" },
    chipText: { fontSize: 12, fontWeight: "800", color: themeColors.textMuted },
    chipTextOn: { color: "#fff" },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
    dealTitle: { flex: 1, fontSize: 13.5, fontWeight: "900", color: themeColors.text },
    badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
    badgeText: { color: "#fff", fontSize: 10.5, fontWeight: "900" },
    payer: { fontSize: 12.5, fontWeight: "800", color: themeColors.text },
    tabsRow: { flexDirection: "row", gap: 8 },
    tabBtn: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: "center", backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.border },
    tabBtnOn: { backgroundColor: "#6366f1", borderColor: "#6366f1" },
    tabText: { fontSize: 13, fontWeight: "800", color: themeColors.textMuted },
    tabTextOn: { color: "#fff" },
    confirmBox: { backgroundColor: themeColors.isDark ? "rgba(14,165,233,0.14)" : "#f0f9ff", borderRadius: 12, padding: 10, gap: 4, borderWidth: 1, borderColor: "#0EA5E9" },
    confirmTitle: { fontSize: 12.5, fontWeight: "900", color: "#0369A1" },
    contactRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 },
    link: { color: "#6366f1", fontSize: 12.5, fontWeight: "800" },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    actionBtn: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    actionText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  });
}
