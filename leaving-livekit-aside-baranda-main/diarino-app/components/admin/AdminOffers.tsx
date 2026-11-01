import { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Linking } from "react-native";
import { useAdminOffers, AdminOfferRow, OfferStatus, OFFER_STATUS_LABELS } from "../../lib/hooks/useOffersHub";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ لوحة «العروض المقدمة» (صلاحية قسم offers): كل عرض على ريل/إعلان أو على طلب، مقسّم الكل / عروض الإعلانات / عروض الطلبات.
// الغرض: معرفة عمليات البيع والتأجير الجارية عبر التطبيق (من قدّم عرضًا لمن، بأى سعر، وحالته) لمتابعة الرسوم (قسم «الصفقات والرسوم»).
// بيعرض بيانات العرض فقط (الأطراف، السعر، الحالة، نص العرض الأول، عدد الرسائل) — مش محتوى باقى المحادثة الخاصة (سياسة الخصوصية).
const STATUS_COLORS: Record<OfferStatus, string> = { new: "#D97706", accepted: "#15803D", declined: "#6B7280" };
type Filter = "all" | "reel" | "request";
type StatusFilter = "any" | OfferStatus;

const fmtMoney = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("en-US")} ج.م`);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });

export function AdminOffers() {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { data: offers = [], isLoading, isError, refetch } = useAdminOffers();
  const [filter, setFilter] = useState<Filter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("any");

  const counts = useMemo(() => ({
    all: offers.length,
    reel: offers.filter((o) => o.kind === "reel").length,
    request: offers.filter((o) => o.kind === "request").length,
  }), [offers]);
  const accepted = offers.filter((o) => o.status === "accepted").length;

  const visible = useMemo(
    () => offers.filter((o) => (filter === "all" || o.kind === filter) && (statusFilter === "any" || o.status === statusFilter)),
    [offers, filter, statusFilter]
  );

  const kindTabs: { key: Filter; label: string }[] = [
    { key: "all", label: `الكل (${counts.all})` },
    { key: "reel", label: `عروض الإعلانات (${counts.reel})` },
    { key: "request", label: `عروض الطلبات (${counts.request})` },
  ];
  const statusTabs: { key: StatusFilter; label: string }[] = [
    { key: "any", label: "كل الحالات" },
    { key: "new", label: "بانتظار الرد" },
    { key: "accepted", label: "مقبولة" },
    { key: "declined", label: "معتذر عنها" },
  ];

  function contact(label: string, name: string | null, phone: string | null, email: string | null) {
    return (
      <View style={styles.party}>
        <Text style={styles.partyLabel}>{label}</Text>
        <Text style={styles.partyName}>{name || "—"}</Text>
        {phone ? (
          <View style={styles.contactRow}>
            <Pressable onPress={() => Linking.openURL(`tel:${phone}`)}><Text style={styles.link}>📞 {phone}</Text></Pressable>
            <Pressable onPress={() => Linking.openURL(`https://wa.me/${phone.replace(/\D/g, "")}`)}><Text style={styles.link}>واتساب</Text></Pressable>
          </View>
        ) : null}
        {email ? <Text style={styles.hint} selectable>{email}</Text> : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.totalsRow}>
        <View style={[styles.totalCard, { borderColor: "#2563EB" }]}>
          <Text style={styles.totalNum}>{counts.all}</Text>
          <Text style={styles.totalLabel}>عرض مُقدَّم</Text>
        </View>
        <View style={[styles.totalCard, { borderColor: "#15803D" }]}>
          <Text style={styles.totalNum}>{accepted}</Text>
          <Text style={styles.totalLabel}>عرض مقبول (مرشّح لصفقة)</Text>
        </View>
      </View>
      <Text style={styles.hint}>
        العروض المقبولة هي الأقرب لإتمام صفقة عبر التطبيق: راجع «الصفقات والرسوم» وتأكد أن الناشر بلّغ عنها خلال المهلة (فترة الحماية 90 يومًا من أول تواصل).
        هذه الصفحة تعرض بيانات العرض فقط وليس محتوى المحادثة الخاصة.
      </Text>

      <View style={styles.filters}>
        {kindTabs.map((f) => (
          <Pressable key={f.key} style={[styles.chip, filter === f.key && styles.chipOn]} onPress={() => setFilter(f.key)}>
            <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.filters}>
        {statusTabs.map((f) => (
          <Pressable key={f.key} style={[styles.chipSm, statusFilter === f.key && styles.chipOn]} onPress={() => setStatusFilter(f.key)}>
            <Text style={[styles.chipText, statusFilter === f.key && styles.chipTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading && <ActivityIndicator color="#6366f1" />}
      {isError && (
        <View style={styles.card}>
          <Text style={styles.hint}>تعذر تحميل العروض. تأكد من تطبيق ملف قاعدة البيانات 20261017000000_offers_conversations.sql ومن امتلاكك صلاحية قسم «العروض المقدمة».</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => refetch()}><Text style={styles.secondaryBtnText}>إعادة المحاولة</Text></Pressable>
        </View>
      )}
      {!isLoading && !isError && visible.length === 0 && <Text style={styles.hint}>لا توجد عروض في هذا التصنيف.</Text>}

      {visible.map((o: AdminOfferRow) => (
        <View key={`${o.kind}-${o.id}`} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={[styles.kindBadge, { backgroundColor: o.kind === "request" ? "#2563EB" : "#22A652" }]}>
              <Text style={styles.badgeText}>{o.kind === "request" ? "عرض على طلب" : "عرض على ريل"}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: STATUS_COLORS[o.status] }]}>
              <Text style={styles.badgeText}>{OFFER_STATUS_LABELS[o.status]}</Text>
            </View>
          </View>
          <Text style={styles.title} numberOfLines={2}>{o.targetTitle || "—"}</Text>
          <Text style={styles.price}>
            السعر المقترح: {fmtMoney(o.offerPrice)}{o.askingPrice != null ? `  ·  المطلوب: ${fmtMoney(o.askingPrice)}` : ""}
          </Text>
          <Text style={styles.hint}>قُدِّم: {fmtDate(o.createdAt)} · آخر نشاط: {fmtDate(o.updatedAt)} · رسائل المحادثة: {o.messagesCount}</Text>
          <Text style={styles.message} numberOfLines={4}>{o.message}</Text>
          <View style={styles.partiesRow}>
            {contact("مقدّم العرض", o.offererName, o.offererPhone, o.offererEmail)}
            {contact(o.kind === "request" ? "صاحب الطلب" : "صاحب الإعلان", o.otherName, o.otherPhone, o.otherEmail)}
          </View>
        </View>
      ))}
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    totalsRow: { flexDirection: "row", gap: 10 },
    totalCard: { flex: 1, backgroundColor: themeColors.card, borderRadius: 14, borderWidth: 1.5, padding: 12, gap: 2 },
    totalNum: { fontSize: 18, fontWeight: "900", color: themeColors.text },
    totalLabel: { fontSize: 11.5, color: themeColors.textSubtle, fontWeight: "700" },
    card: { backgroundColor: themeColors.card, borderRadius: 16, padding: 14, gap: 8, borderWidth: 1, borderColor: themeColors.border },
    hint: { fontSize: 11.5, color: themeColors.textSubtle, lineHeight: 18 },
    filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: themeColors.border, backgroundColor: themeColors.card },
    chipSm: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: themeColors.border, backgroundColor: themeColors.card },
    chipOn: { backgroundColor: "#6366f1", borderColor: "#6366f1" },
    chipText: { fontSize: 12, fontWeight: "800", color: themeColors.textMuted },
    chipTextOn: { color: "#fff" },
    secondaryBtn: { backgroundColor: themeColors.isDark ? "rgba(99,102,241,0.18)" : "#eef2ff", borderRadius: 12, paddingVertical: 11, alignItems: "center" },
    secondaryBtnText: { color: "#6366f1", fontSize: 12.5, fontWeight: "800" },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
    kindBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
    badgeText: { color: "#fff", fontSize: 10.5, fontWeight: "900" },
    title: { fontSize: 13.5, fontWeight: "900", color: themeColors.text },
    price: { fontSize: 12.5, fontWeight: "800", color: "#15803D" },
    message: { fontSize: 12.5, lineHeight: 20, color: themeColors.text, backgroundColor: themeColors.surface, borderRadius: 10, padding: 10 },
    partiesRow: { flexDirection: "row", gap: 10 },
    party: { flex: 1, gap: 2, backgroundColor: themeColors.surface, borderRadius: 10, padding: 10 },
    partyLabel: { fontSize: 10.5, fontWeight: "900", color: themeColors.textSubtle },
    partyName: { fontSize: 12.5, fontWeight: "800", color: themeColors.text },
    contactRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    link: { color: "#6366f1", fontSize: 12, fontWeight: "800" },
  });
}
