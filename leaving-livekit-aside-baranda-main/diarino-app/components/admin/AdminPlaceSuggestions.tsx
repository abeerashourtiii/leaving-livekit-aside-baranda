import { useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { ConfirmModal } from "../shared/ConfirmModal";
import { showToast } from "../shared/Toast";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ M2: مراجعة أسماء المناطق المقترحة (إخفاء/إظهار/حذف) + إحصاء محاولات البحث بمحافظات غير معروفة (للأدمن فقط؛ لا تُضاف لقائمة أحد).
type RegionRow = {
  id: string; province: string; name: string; hidden: boolean; promoted: boolean;
  supporters: number; suggester_name: string | null; created_at: string;
};
type ProvinceStat = { name: string; users: number; last_at: string };

export function AdminPlaceSuggestions() {
  const qc = useQueryClient();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const [deleteTarget, setDeleteTarget] = useState<RegionRow | null>(null);

  const regions = useQuery({
    queryKey: ["admin", "regionSuggestions"],
    queryFn: async (): Promise<RegionRow[]> => {
      const { data, error } = await supabase.rpc("admin_list_region_suggestions");
      if (error) throw error;
      return (data ?? []) as unknown as RegionRow[];
    },
    staleTime: 15_000,
  });
  const provinces = useQuery({
    queryKey: ["admin", "provinceAttempts"],
    queryFn: async (): Promise<ProvinceStat[]> => {
      const { data, error } = await supabase.rpc("admin_province_attempt_stats");
      if (error) throw error;
      return (data ?? []) as unknown as ProvinceStat[];
    },
    staleTime: 30_000,
  });

  const moderate = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "hide" | "unhide" | "delete" }) => {
      const { error } = await supabase.rpc("admin_moderate_region", { p_id: id, p_action: action });
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin", "regionSuggestions"] }); },
    onError: () => showToast("تعذر تنفيذ العملية، حاول مرة أخرى"),
  });

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>أسماء المناطق المقترحة</Text>
        <Text style={styles.cardSubtitle}>يراها المقترِح فورًا، وتظهر للجميع عند دعم 5 مستخدمين مختلفين (حسابات عمرها 7 أيام فأكثر). أخفِ أو احذف أي اسم مسيء.</Text>
        {regions.isLoading && <ActivityIndicator color="#6366f1" style={{ marginVertical: 12 }} />}
        {regions.isError && <Text style={styles.empty}>تعذر تحميل المقترحات</Text>}
        {!regions.isLoading && !regions.isError && !(regions.data ?? []).length && <Text style={styles.empty}>لا توجد أسماء مقترحة</Text>}
        {(regions.data ?? []).map((r) => (
          <View key={r.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, r.hidden && { textDecorationLine: "line-through", opacity: 0.6 }]} numberOfLines={2}>{r.name}</Text>
              <Text style={styles.sub}>
                {r.province} · {r.promoted ? "ظاهر للجميع" : `يراه المقترِح فقط (${r.supporters}/5)`}{r.hidden ? " · مخفي" : ""}
                {r.suggester_name ? ` · ${r.suggester_name}` : ""}
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              <Pressable
                style={[styles.btn, { backgroundColor: themeColors.surface }]}
                disabled={moderate.isPending}
                onPress={() => moderate.mutate({ id: r.id, action: r.hidden ? "unhide" : "hide" })}
              >
                <Text style={[styles.btnText, { color: themeColors.textMuted }]}>{r.hidden ? "إظهار" : "إخفاء"}</Text>
              </Pressable>
              <Pressable style={[styles.btn, { backgroundColor: "#dc2626" }]} onPress={() => setDeleteTarget(r)}>
                <Text style={[styles.btnText, { color: "white" }]}>حذف</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>محافظات بحث بها المستخدمون وليست فى القائمة</Text>
        <Text style={styles.cardSubtitle}>إحصاء للمعلومة فقط (القائمة مغلقة على 27 محافظة ولا تُضاف إليها أسماء تلقائيًا).</Text>
        {provinces.isLoading && <ActivityIndicator color="#6366f1" style={{ marginVertical: 12 }} />}
        {!provinces.isLoading && !(provinces.data ?? []).length && <Text style={styles.empty}>لا توجد محاولات مسجّلة</Text>}
        {(provinces.data ?? []).map((p) => (
          <View key={`${p.name}-${p.last_at}`} style={styles.row}>
            <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{p.name}</Text>
            <Text style={styles.sub}>{p.users} مستخدم</Text>
          </View>
        ))}
      </View>

      <ConfirmModal
        visible={!!deleteTarget}
        title="حذف اسم المنطقة"
        text={deleteTarget ? `سيُحذف الاسم «${deleteTarget.name}» نهائيًا من الاقتراحات. هل أنت متأكد؟` : ""}
        confirmLabel="حذف"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) moderate.mutate({ id: deleteTarget.id, action: "delete" });
          setDeleteTarget(null);
        }}
      />
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: themeColors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: themeColors.border },
    cardTitle: { fontSize: 13, fontWeight: "900", color: themeColors.text },
    cardSubtitle: { fontSize: 11, color: themeColors.textSubtle, marginTop: 2, marginBottom: 8, lineHeight: 17 },
    empty: { textAlign: "center", color: themeColors.textSubtle, fontSize: 12, paddingVertical: 14 },
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: themeColors.border },
    name: { fontSize: 12.5, fontWeight: "800", color: themeColors.text },
    sub: { fontSize: 11, color: themeColors.textSubtle, marginTop: 2 },
    btn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, alignItems: "center" },
    btnText: { fontSize: 10.5, fontWeight: "800" },
  });
}
