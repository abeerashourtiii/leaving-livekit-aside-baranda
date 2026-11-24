import { useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, Alert, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { openExternalUrl } from "../../lib/linking";
import { useIsAdmin } from "../../lib/hooks/useIsAdmin";
import {
  AdminCompany, AdminCompanyOrder, CompanySettings, useAdminCompanies, useAdminCompanyOrders, useAdminDeleteCompany,
  useAdminSetCompanyStatus, useAdminUpdateCompanyOrder, useCompanySettings, useUpdateCompanySettings,
} from "../../lib/hooks/useCompanies";
import {
  COMPANY_PLAN_STATUS_LABELS, COMPANY_STATUS_LABELS, CompanyPlanStatus, CompanyStatus, companyCategoryLabel, companyPlanLabel,
  companyWhatsappNumber,
} from "../../lib/companies";
import { paymentMethodLabel } from "../../lib/paymentInfo";
import { cldOptimized } from "../../lib/cloudinary";
import { logAndGetSafeMessage } from "../../lib/errors";
import { showToast } from "../shared/Toast";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ إدارة قسم «الخدمات» (دليل الشركات) — صلاحية «الصفقات والرسوم» (deals):
//   ١) الشركات: مراجعة الشركات الجديدة (موافقة ← تبدأ الفترة المجانية 60 يومًا من لحظة الموافقة / رفض بسبب يصل لصاحبها)، إخفاء، حذف.
//   ٢) الاشتراكات: تأكيد سداد باقات الهاتف/الصور/الاثنين (100/100/200 ج.م) وتفعيلها 30 يومًا (تبدأ بعد نهاية المدة الحالية/المجانية).
//   ٣) الأسعار والمدد (للمشرف الرئيسى فقط).
type Tab = "companies" | "orders" | "settings";
const STATUS_COLORS: Record<CompanyStatus, string> = { pending: "#D97706", approved: "#15803D", rejected: "#DC2626", hidden: "#6B7280" };
const ORDER_COLORS: Record<CompanyPlanStatus, string> = {
  pending_payment: "#D97706", submitted: "#0EA5E9", active: "#15803D", rejected: "#DC2626", cancelled: "#6B7280", expired: "#6B7280",
};
const fmtMoney = (n: number) => `${n.toLocaleString("en-US")} ج.م`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" }) : "—");

export function AdminCompanies() {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { isSuperAdmin } = useIsAdmin();
  const [tab, setTab] = useState<Tab>("companies");
  const tabs: { key: Tab; label: string }[] = [
    { key: "companies", label: "الشركات" },
    { key: "orders", label: "اشتراكات الشركات" },
    ...(isSuperAdmin ? [{ key: "settings" as Tab, label: "الأسعار والمدد" }] : []),
  ];
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.filtersRow}>
        {tabs.map((tb) => (
          <Pressable key={tb.key} style={[styles.filterChip, tab === tb.key && styles.filterChipOn]} onPress={() => setTab(tb.key)}>
            <Text style={[styles.filterText, tab === tb.key && styles.filterTextOn]}>{tb.label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === "companies" && <CompaniesTab styles={styles} themeColors={themeColors} />}
      {tab === "orders" && <OrdersTab styles={styles} themeColors={themeColors} />}
      {tab === "settings" && isSuperAdmin && <SettingsTab styles={styles} themeColors={themeColors} />}
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function CompaniesTab({ styles, themeColors }: { styles: Styles; themeColors: ThemeColors }) {
  const { data: companies = [], isLoading, isError, error, refetch } = useAdminCompanies(true);
  const setStatus = useAdminSetCompanyStatus();
  const del = useAdminDeleteCompany();
  const [filter, setFilter] = useState<CompanyStatus | "all">("pending");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);

  const filters: { key: CompanyStatus | "all"; label: string }[] = [
    { key: "pending", label: "قيد المراجعة" }, { key: "approved", label: "المعتمدة" }, { key: "rejected", label: "المرفوضة" },
    { key: "hidden", label: "المخفية" }, { key: "all", label: "الكل" },
  ];
  const visible = filter === "all" ? companies : companies.filter((c) => c.status === filter);

  function act(c: AdminCompany, status: CompanyStatus) {
    if (status === "rejected" && !(reasons[c.id] ?? "").trim()) {
      Alert.alert("سبب الرفض", "اكتب سبب الرفض ليصل لصاحب الشركة.");
      return;
    }
    setStatus.mutate(
      { id: c.id, status, reason: reasons[c.id], note: notes[c.id] },
      {
        onSuccess: () => showToast(status === "approved" ? "تمت الموافقة — بدأت الفترة المجانية" : "تم تحديث حالة الشركة"),
        onError: (e) => Alert.alert("تعذر التحديث", logAndGetSafeMessage("company status failed", e, "تأكد من صلاحية قسم الصفقات وحاول مرة أخرى.")),
      }
    );
  }

  function remove(c: AdminCompany) {
    Alert.alert("حذف الشركة", `سيتم حذف «${c.name}» وصورها نهائيًا. متأكد؟`, [
      { text: "إلغاء", style: "cancel" },
      {
        text: "حذف", style: "destructive",
        onPress: () => del.mutate(c.id, {
          onSuccess: () => showToast("تم حذف الشركة"),
          onError: (e) => Alert.alert("تعذر الحذف", logAndGetSafeMessage("company delete failed", e, "حاول مرة أخرى.")),
        }),
      },
    ]);
  }

  if (isLoading) return <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} />;
  if (isError) {
    return (
      <Pressable style={styles.card} onPress={() => refetch()}>
        <Text style={styles.errorText}>تعذر تحميل الشركات (تأكد من تطبيق migration 20261123000000). اضغط لإعادة المحاولة.{error instanceof Error && error.message ? `\n${error.message}` : ""}</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.filtersRow}>
        {filters.map((f) => (
          <Pressable key={f.key} style={[styles.filterChip, filter === f.key && styles.filterChipOn]} onPress={() => setFilter(f.key)}>
            <Text style={[styles.filterText, filter === f.key && styles.filterTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      {visible.length === 0 ? (
        <Text style={styles.empty}>لا توجد شركات في هذا التصنيف.</Text>
      ) : (
        visible.map((c) => {
          const expanded = open === c.id;
          return (
            <View key={c.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Image source={{ uri: cldOptimized(c.logoUrl, "w_160,q_auto,f_auto") }} style={styles.logo} contentFit="cover" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.title} numberOfLines={2}>{c.name}</Text>
                  <Text style={styles.hint} numberOfLines={2}>{companyCategoryLabel(c.category)} · {c.province} - {c.region}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: STATUS_COLORS[c.status] }]}><Text style={styles.badgeText}>{COMPANY_STATUS_LABELS[c.status]}</Text></View>
              </View>

              <Text style={styles.hint}>أُنشئت: {fmtDate(c.createdAt)}{c.approvedAt ? ` · اعتُمدت: ${fmtDate(c.approvedAt)}` : ""}</Text>
              {c.status === "approved" && (
                <Text style={styles.hint}>
                  الفترة المجانية حتى {fmtDate(c.freeUntil)} · الهاتف حتى {fmtDate(c.phoneUntil)} · الصور حتى {fmtDate(c.photosUntil)}
                </Text>
              )}
              {c.rejectReason ? <Text style={styles.hint}>سبب الرفض: {c.rejectReason}</Text> : null}

              <Pressable onPress={() => setOpen(expanded ? null : c.id)}>
                <Text style={styles.link}>{expanded ? "إخفاء التفاصيل ▴" : "عرض التفاصيل الكاملة ▾"}</Text>
              </Pressable>

              {expanded && (
                <View style={styles.confirmBox}>
                  <Text style={styles.hint} selectable>الوصف: {c.description}</Text>
                  <Text style={styles.hint} selectable>
                    العنوان: {c.province} - {c.region}
                    {c.buildingNo ? ` · مبنى ${c.buildingNo}` : ""}{c.floorNo ? ` · دور ${c.floorNo}` : ""}{c.unitNo ? ` · وحدة ${c.unitNo}` : ""}
                  </Text>
                  <Text style={styles.hint} selectable>المسؤول: {c.managerName}</Text>
                  <View style={styles.contactRow}>
                    <Pressable onPress={() => openExternalUrl(`tel:${c.phone.replace(/[^\d+]/g, "")}`)}><Text style={styles.link}>📞 {c.phone}</Text></Pressable>
                    <Pressable onPress={() => openExternalUrl(`https://wa.me/${companyWhatsappNumber(c.phone)}`)}><Text style={styles.link}>واتساب</Text></Pressable>
                  </View>
                  {c.phone2 ? <Text style={styles.hint} selectable>هاتف آخر: {c.phone2}</Text> : null}
                  {c.taxCardNo ? <Text style={styles.hint} selectable>البطاقة الضريبية: {c.taxCardNo}</Text> : null}
                  {c.commercialRegisterNo ? <Text style={styles.hint} selectable>السجل التجاري: {c.commercialRegisterNo}</Text> : null}
                  <Text style={styles.hint} selectable>
                    صاحب الحساب: {c.ownerName || "—"} · {c.ownerPhone || "—"} · {c.ownerEmail || "—"}
                  </Text>
                  {c.images.length > 0 && (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {c.images.map((i) => (
                        <Image key={i.id || i.url} source={{ uri: cldOptimized(i.url, "w_240,q_auto,f_auto") }} style={styles.thumb} contentFit="cover" />
                      ))}
                    </View>
                  )}
                </View>
              )}

              <TextInput style={styles.input} value={reasons[c.id] ?? ""} onChangeText={(v) => setReasons((r) => ({ ...r, [c.id]: v }))} placeholder="سبب الرفض (يصل لصاحب الشركة)" placeholderTextColor={themeColors.textSubtle} />
              <TextInput style={styles.input} value={notes[c.id] ?? ""} onChangeText={(v) => setNotes((r) => ({ ...r, [c.id]: v }))} placeholder="ملاحظة داخلية (اختياري)" placeholderTextColor={themeColors.textSubtle} />
              {c.adminNote ? <Text style={styles.hint}>ملاحظة سابقة: {c.adminNote}</Text> : null}

              <View style={styles.actionsRow}>
                {c.status !== "approved" && (
                  <Pressable style={[styles.actionBtn, { backgroundColor: "#15803D" }]} onPress={() => act(c, "approved")} disabled={setStatus.isPending}>
                    <Text style={styles.actionText}>{c.status === "hidden" ? "إظهار" : "موافقة ونشر"}</Text>
                  </Pressable>
                )}
                {c.status !== "rejected" && (
                  <Pressable style={[styles.actionBtn, { backgroundColor: "#DC2626" }]} onPress={() => act(c, "rejected")} disabled={setStatus.isPending}>
                    <Text style={styles.actionText}>رفض</Text>
                  </Pressable>
                )}
                {c.status === "approved" && (
                  <Pressable style={[styles.actionBtn, { backgroundColor: "#6B7280" }]} onPress={() => act(c, "hidden")} disabled={setStatus.isPending}>
                    <Text style={styles.actionText}>إخفاء</Text>
                  </Pressable>
                )}
                <Pressable style={[styles.actionBtn, { backgroundColor: "#111827" }]} onPress={() => remove(c)} disabled={del.isPending}>
                  <Text style={styles.actionText}>حذف</Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

function OrdersTab({ styles, themeColors }: { styles: Styles; themeColors: ThemeColors }) {
  const { data: orders = [], isLoading, isError, error, refetch } = useAdminCompanyOrders(true);
  const update = useAdminUpdateCompanyOrder();
  const [filter, setFilter] = useState<CompanyPlanStatus | "all">("submitted");
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const filters: { key: CompanyPlanStatus | "all"; label: string }[] = [
    { key: "submitted", label: "بانتظار المراجعة" }, { key: "pending_payment", label: "بانتظار السداد" }, { key: "active", label: "المفعّلة" }, { key: "all", label: "الكل" },
  ];
  const visible = filter === "all" ? orders : orders.filter((o) => o.status === filter);

  function setStatus(o: AdminCompanyOrder, status: "pending_payment" | "submitted" | "active" | "rejected" | "cancelled") {
    update.mutate(
      { id: o.id, status, paymentRef: refs[o.id], adminNote: notes[o.id] },
      {
        onSuccess: () => showToast(status === "active" ? "تم تفعيل الاشتراك" : "تم تحديث الطلب"),
        onError: (e) => {
          const code = e instanceof Error ? e.message : "";
          if (code === "company_not_approved" || code === "company_unavailable") Alert.alert("تعذر التفعيل", "الشركة غير معتمدة أو محذوفة.");
          else Alert.alert("تعذر التحديث", logAndGetSafeMessage("company order update failed", e, "تأكد من صلاحية قسم الصفقات وحاول مرة أخرى."));
        },
      }
    );
  }

  if (isLoading) return <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} />;
  if (isError) {
    return (
      <Pressable style={styles.card} onPress={() => refetch()}>
        <Text style={styles.errorText}>تعذر تحميل اشتراكات الشركات. اضغط لإعادة المحاولة.{error instanceof Error && error.message ? `\n${error.message}` : ""}</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.filtersRow}>
        {filters.map((f) => (
          <Pressable key={f.key} style={[styles.filterChip, filter === f.key && styles.filterChipOn]} onPress={() => setFilter(f.key)}>
            <Text style={[styles.filterText, filter === f.key && styles.filterTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      {visible.length === 0 ? (
        <Text style={styles.empty}>لا توجد طلبات اشتراك في هذا التصنيف.</Text>
      ) : (
        visible.map((o) => (
          <View key={o.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.title} numberOfLines={2}>{o.companyName || "—"}</Text>
              <View style={[styles.badge, { backgroundColor: ORDER_COLORS[o.status] }]}><Text style={styles.badgeText}>{COMPANY_PLAN_STATUS_LABELS[o.status]}</Text></View>
            </View>
            <Text style={styles.hint}>
              {companyPlanLabel(o.plan)} · {o.periodDays} يومًا · {fmtMoney(o.priceEgp)} · أُنشئ: {fmtDate(o.createdAt)}
              {o.startsAt ? ` · بدأ: ${fmtDate(o.startsAt)}` : ""}{o.endsAt ? ` · ينتهي: ${fmtDate(o.endsAt)}` : ""}
            </Text>
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
                <Text style={styles.confirmTitle}>تأكيد السداد من صاحب الشركة{o.paymentSubmittedAt ? ` · ${fmtDate(o.paymentSubmittedAt)}` : ""}</Text>
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
                <TextInput style={styles.input} value={refs[o.id] ?? ""} onChangeText={(v) => setRefs((r) => ({ ...r, [o.id]: v }))} placeholder="مرجع التحويل / ملاحظة السداد" placeholderTextColor={themeColors.textSubtle} />
                <TextInput style={styles.input} value={notes[o.id] ?? ""} onChangeText={(v) => setNotes((r) => ({ ...r, [o.id]: v }))} placeholder="ملاحظة لصاحب الشركة (تظهر عند الرفض)" placeholderTextColor={themeColors.textSubtle} />
              </>
            )}
            <View style={styles.actionsRow}>
              {(o.status === "submitted" || o.status === "pending_payment" || o.status === "rejected") && (
                <Pressable style={[styles.actionBtn, { backgroundColor: "#15803D" }]} onPress={() => setStatus(o, "active")} disabled={update.isPending}>
                  <Text style={styles.actionText}>تأكيد السداد وتفعيل الاشتراك</Text>
                </Pressable>
              )}
              {(o.status === "submitted" || o.status === "pending_payment") && (
                <Pressable style={[styles.actionBtn, { backgroundColor: "#DC2626" }]} onPress={() => setStatus(o, "rejected")} disabled={update.isPending}>
                  <Text style={styles.actionText}>رفض</Text>
                </Pressable>
              )}
              {o.status === "active" && (
                <Pressable style={[styles.actionBtn, { backgroundColor: "#6B7280" }]} onPress={() => setStatus(o, "cancelled")} disabled={update.isPending}>
                  <Text style={styles.actionText}>إيقاف الاشتراك</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function SettingsTab({ styles, themeColors }: { styles: Styles; themeColors: ThemeColors }) {
  const { settings, isLoading } = useCompanySettings();
  const update = useUpdateCompanySettings();
  const [draft, setDraft] = useState<Record<keyof CompanySettings, string> | null>(null);

  const fields: { key: keyof CompanySettings; label: string }[] = [
    { key: "freeDays", label: "الفترة المجانية (أيام من الموافقة)" },
    { key: "periodDays", label: "مدة الاشتراك (أيام)" },
    { key: "phonePriceEgp", label: "سعر إظهار الهاتف (ج.م)" },
    { key: "photosPriceEgp", label: "سعر معرض الصور (ج.م)" },
    { key: "bothPriceEgp", label: "سعر الاثنين معًا (ج.م)" },
    { key: "maxPhotos", label: "أقصى عدد صور" },
  ];

  if (isLoading) return <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} />;
  const values = draft ?? (Object.fromEntries(fields.map((f) => [f.key, String(settings[f.key])])) as Record<keyof CompanySettings, string>);

  function save() {
    const next: CompanySettings = {
      freeDays: Math.round(Number(values.freeDays)), periodDays: Math.round(Number(values.periodDays)), phonePriceEgp: Number(values.phonePriceEgp),
      photosPriceEgp: Number(values.photosPriceEgp), bothPriceEgp: Number(values.bothPriceEgp), maxPhotos: Math.round(Number(values.maxPhotos)),
    };
    if (Object.values(next).some((n) => !Number.isFinite(n) || n < 0) || next.periodDays < 1 || next.maxPhotos < 1) {
      Alert.alert("قيم غير صحيحة", "راجع الأرقام المدخلة.");
      return;
    }
    update.mutate(next, {
      onSuccess: () => { setDraft(null); showToast("تم حفظ الإعدادات (تسري على الطلبات الجديدة)"); },
      onError: (e) => Alert.alert("تعذر الحفظ", logAndGetSafeMessage("company settings failed", e, "للمشرف الرئيسى فقط.")),
    });
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>أسعار ومدد قسم الخدمات</Text>
      <Text style={styles.hint}>القيم الافتراضية: 60 يومًا مجانًا، اشتراك 30 يومًا، الهاتف 100 والصور 100 والاثنان 200 ج.م، حتى 6 صور. التعديل يسري على الطلبات الجديدة فقط.</Text>
      {fields.map((f) => (
        <View key={f.key} style={{ gap: 4 }}>
          <Text style={styles.hint}>{f.label}</Text>
          <TextInput
            style={styles.input}
            value={values[f.key]}
            onChangeText={(v) => setDraft({ ...values, [f.key]: v })}
            keyboardType="numeric"
            placeholderTextColor={themeColors.textSubtle}
          />
        </View>
      ))}
      <Pressable style={[styles.actionBtn, { backgroundColor: "#15803D", alignSelf: "flex-start" }]} onPress={save} disabled={update.isPending}>
        <Text style={styles.actionText}>حفظ</Text>
      </Pressable>
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
    badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, maxWidth: "40%" },
    badgeText: { color: "#fff", fontSize: 11, fontWeight: "800", textAlign: "center" },
    logo: { width: 52, height: 52, borderRadius: 12, backgroundColor: themeColors.surface },
    thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: themeColors.surface },
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
