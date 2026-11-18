import { useState } from "react";
import { KeyboardAvoid } from "../../components/shared/KeyboardAvoid";
import { View, Text, TextInput, Pressable, StyleSheet, Modal, ActivityIndicator } from "react-native";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { showToast } from "../shared/Toast";
import { OWNER_WINDOW_MS } from "../../lib/adWindow";
import { useDebouncedValue } from "../../lib/hooks/useDebouncedValue";
import { ilikeContains, pgrstQuote } from "../../lib/postgrestFilter";

// ↔ «إدارة الطلبات» (صلاحية قسم requests): كل الطلبات + حذف الطلبات القديمة/غير الفعّالة. صاحب الطلب يحذف طلبه خلال 24 ساعة من
// عرضه فقط؛ بعدها الحذف من حق المشرفين (admin_delete_request — بيبعت لصاحب الطلب إشعارًا بالسبب). migration 20261021000000.
type Row = {
  id: string; requester_name: string | null; purpose: string; type: string; province: string; location: string;
  price_max: number | null; offers_count: number; created_at: string; description: string | null;
};
type Filter = "all" | "recent" | "old" | "veryOld";
const DAY = 24 * 60 * 60 * 1000;
// ↔ L6: ترقيم بالمؤشر (created_at, id) + بحث وفلترة على الخادم بدل تحميل 2000 صف دفعة واحدة وتصفيتها على العميل.
const PAGE_SIZE = 40;
const LIST_COLUMNS = "id, requester_name, purpose, type, province, location, price_max, offers_count, created_at, description";
const SEARCH_COLUMNS = ["requester_name", "type", "province", "location", "description"];
type Cursor = { createdAt: string; id: string } | null;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
function age(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  return d <= 0 ? "اليوم" : `${d} يوم`;
}

export function AdminRequests() {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("old");
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 350);

  const q = useInfiniteQuery({
    queryKey: ["admin", "requests", filter, debouncedSearch.trim()],
    initialPageParam: null as Cursor,
    queryFn: async ({ pageParam }): Promise<Row[]> => {
      let query = supabase.from("requests").select(LIST_COLUMNS);
      const nowMs = Date.now();
      if (filter === "recent") query = query.gte("created_at", new Date(nowMs - OWNER_WINDOW_MS).toISOString());
      if (filter === "old") query = query.lt("created_at", new Date(nowMs - OWNER_WINDOW_MS).toISOString());
      if (filter === "veryOld") query = query.lt("created_at", new Date(nowMs - 30 * DAY).toISOString());
      const term = ilikeContains(debouncedSearch);
      if (term) query = query.or(SEARCH_COLUMNS.map((c) => `${c}.ilike.${term}`).join(","));
      if (pageParam) {
        const ts = pgrstQuote(pageParam.createdAt);
        query = query.or(`created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${pgrstQuote(pageParam.id)})`);
      }
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
    getNextPageParam: (last): Cursor =>
      last.length < PAGE_SIZE ? null : { createdAt: last[last.length - 1].created_at, id: last[last.length - 1].id },
    staleTime: 10_000,
  });

  // أعداد الشرائح (head فقط، بلا صفوف).
  const counts = useQuery({
    queryKey: ["admin", "requests", "counts"],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - OWNER_WINDOW_MS).toISOString();
      const [all, old] = await Promise.all([
        supabase.from("requests").select("id", { count: "exact", head: true }),
        supabase.from("requests").select("id", { count: "exact", head: true }).lt("created_at", cutoff),
      ]);
      return { all: all.count ?? 0, old: old.count ?? 0 };
    },
    staleTime: 30_000,
  });

  const filtered = (q.data?.pages ?? []).flat();
  const oldCount = counts.data?.old ?? 0;
  const allCount = counts.data?.all ?? 0;

  async function confirmDelete() {
    if (!target || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_delete_request", { p_request_id: target.id, p_reason: reason.trim() || undefined });
    setBusy(false);
    if (error) {
      showToast(`تعذر الحذف: ${error.message}`);
      return;
    }
    showToast("🗑️ تم حذف الطلب وأُشعر صاحبه");
    setTarget(null);
    setReason("");
    void qc.invalidateQueries({ queryKey: ["admin", "requests"] }); // يشمل القوائم والأعداد
    void qc.invalidateQueries({ queryKey: ["requests"] });
  }

  const chips: { key: Filter; label: string }[] = [
    { key: "old", label: `أقدم من 24 ساعة (${oldCount})` },
    { key: "veryOld", label: "أقدم من 30 يومًا" },
    { key: "recent", label: "آخر 24 ساعة" },
    { key: "all", label: `الكل (${allCount})` },
  ];

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.hint}>
        صاحب الطلب يحذف طلبه خلال 24 ساعة من عرضه فقط. هنا تحذف الطلبات القديمة أو غير الفعّالة، ويصل صاحب الطلب إشعار بالسبب.
      </Text>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="🔍 ابحث بالنوع أو المحافظة أو المنطقة أو اسم صاحب الطلب…"
        placeholderTextColor={themeColors.textSubtle}
      />
      <View style={styles.chips}>
        {chips.map((c) => (
          <Pressable key={c.key} style={[styles.chip, filter === c.key && styles.chipOn]} onPress={() => setFilter(c.key)}>
            <Text style={[styles.chipText, filter === c.key && styles.chipTextOn]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>

      {q.isLoading && <ActivityIndicator color="#6366f1" />}
      {q.isError && (
        <View style={styles.card}>
          <Text style={styles.hint}>تعذر تحميل الطلبات. تأكد من تطبيق ملف قاعدة البيانات 20261021000000_edit_delete_windows.sql ومن صلاحية قسم «إدارة الطلبات».</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => q.refetch()}><Text style={styles.secondaryBtnText}>إعادة المحاولة</Text></Pressable>
        </View>
      )}
      {!q.isLoading && !q.isError && filtered.length === 0 && <Text style={styles.hint}>لا توجد طلبات مطابقة.</Text>}

      {filtered.map((r) => (
        <View key={r.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.title}>{r.type} {r.purpose === "sale" ? "للبيع" : "للإيجار"}</Text>
            <Text style={styles.price}>{r.price_max ? `حتى ${Number(r.price_max).toLocaleString("en-US")} ج.م` : "—"}</Text>
          </View>
          <Text style={styles.hint}>📍 {r.province} · {r.location}</Text>
          <Text style={styles.hint}>👤 {r.requester_name || "—"} · {fmtDate(r.created_at)} ({age(r.created_at)}) · عروض: {r.offers_count}</Text>
          {!!r.description && <Text style={styles.desc} numberOfLines={3}>{r.description}</Text>}
          <Pressable style={styles.delBtn} onPress={() => { setReason(""); setTarget(r); }}>
            <Text style={styles.delText}>🗑️ حذف</Text>
          </Pressable>
        </View>
      ))}

      {q.hasNextPage && (
        <Pressable style={styles.secondaryBtn} onPress={() => { void q.fetchNextPage(); }} disabled={q.isFetchingNextPage}>
          <Text style={styles.secondaryBtnText}>{q.isFetchingNextPage ? "..." : "تحميل المزيد"}</Text>
        </Pressable>
      )}

      <Modal visible={!!target} transparent animationType="fade" onRequestClose={() => setTarget(null)}><KeyboardAvoid style={{ flex: 1 }} mode="center">
        <Pressable style={styles.backdrop} onPress={() => !busy && setTarget(null)} />
        {target && (
          <View style={styles.reasonCard}>
            <Text style={styles.reasonTitle}>حذف الطلب نهائيًا</Text>
            <Text style={styles.hint} numberOfLines={2}>{target.type} · {target.province} · {target.location}</Text>
            <TextInput
              style={styles.reasonInput}
              value={reason}
              onChangeText={setReason}
              placeholder="السبب — يصل لصاحب الطلب في إشعار"
              placeholderTextColor={themeColors.textSubtle}
              multiline
              maxLength={300}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable style={styles.cancel} onPress={() => setTarget(null)} disabled={busy}><Text style={styles.cancelText}>تراجع</Text></Pressable>
              <Pressable style={[styles.confirm, busy && { opacity: 0.6 }]} onPress={() => { void confirmDelete(); }} disabled={busy}>
                <Text style={styles.confirmText}>{busy ? "..." : "حذف"}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoid></Modal>
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    hint: { fontSize: 11.5, color: themeColors.textSubtle, lineHeight: 18 },
    search: { backgroundColor: themeColors.card, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, fontSize: 13, color: themeColors.text, borderWidth: 1, borderColor: themeColors.border },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: themeColors.border, backgroundColor: themeColors.card },
    chipOn: { backgroundColor: "#6366f1", borderColor: "#6366f1" },
    chipText: { fontSize: 12, fontWeight: "800", color: themeColors.textMuted },
    chipTextOn: { color: "#fff" },
    card: { backgroundColor: themeColors.card, borderRadius: 16, padding: 14, gap: 6, borderWidth: 1, borderColor: themeColors.border },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
    title: { fontSize: 13.5, fontWeight: "900", color: themeColors.text, flex: 1 },
    price: { fontSize: 12.5, fontWeight: "800", color: "#15803D" },
    desc: { fontSize: 12.5, lineHeight: 20, color: themeColors.text, backgroundColor: themeColors.surface, borderRadius: 10, padding: 10 },
    delBtn: { alignSelf: "flex-start", backgroundColor: "#fee2e2", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, marginTop: 4 },
    delText: { color: "#991b1b", fontSize: 12, fontWeight: "900" },
    secondaryBtn: { backgroundColor: themeColors.isDark ? "rgba(99,102,241,0.18)" : "#eef2ff", borderRadius: 12, paddingVertical: 11, alignItems: "center" },
    secondaryBtnText: { color: "#6366f1", fontSize: 12.5, fontWeight: "800" },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    reasonCard: { position: "absolute", left: 20, right: 20, top: "28%", backgroundColor: themeColors.card, borderRadius: 18, padding: 16, gap: 10 },
    reasonTitle: { fontSize: 15, fontWeight: "900", color: themeColors.text },
    reasonInput: { minHeight: 80, textAlignVertical: "top", backgroundColor: themeColors.surface, borderRadius: 12, padding: 12, fontSize: 13, color: themeColors.text, borderWidth: 1, borderColor: themeColors.border },
    cancel: { flex: 1, borderRadius: 999, paddingVertical: 11, alignItems: "center", borderWidth: 1, borderColor: themeColors.border },
    cancelText: { fontSize: 13, fontWeight: "900", color: themeColors.textMuted },
    confirm: { flex: 1, borderRadius: 999, paddingVertical: 11, alignItems: "center", backgroundColor: "#dc2626" },
    confirmText: { fontSize: 13, fontWeight: "900", color: "white" },
  });
}
