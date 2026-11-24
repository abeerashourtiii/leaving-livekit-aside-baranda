import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { supabase } from "../../lib/supabase";
import { showToast } from "../shared/Toast";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ تنظيف ملفات Cloudinary اليتيمة (المشرف الرئيسى فقط). كل العمليات تُنفَّذ على الخادم عبر Edge Function `cloudinary-cleanup`
//   (الـ API Secret هناك فقط) — هذه الشاشة تستدعيها بجلسة المشرف:
//   • الطابور: ملفات حُذفت/استُبدلت وتنتظر الحذف الفعلى (تُعالج تلقائيًا إن فُعِّلت الجدولة، أو من زر «تشغيل التنظيف الآن»).
//   • فحص اليتامى (معاينة): ملفات رُفعت ولم يعد لها أى سجل نشط بعد مهلة أمان ≥ 24 ساعة — لا يُحذف شيء قبل أن تؤكد.
type Stats = { pending: number; failing: number; gaveUp: number; done: number; deleted: number; skippedInUse: number };
type Candidate = { resource_type: string; public_id: string; bytes?: number };
type ScanResult = { count: number; totalBytes: number; sample: Candidate[] };

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("cloudinary-cleanup", { body });
  if (error) throw error;
  if (data && typeof data === "object" && "error" in (data as object)) throw new Error(String((data as { error: unknown }).error));
  return data as T;
}

export function AdminMediaCleanup() {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const [stats, setStats] = useState<Stats | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setStats(await call<Stats>({ mode: "stats" }));
    } catch {
      setStats(null);
    }
  }, []);
  useEffect(() => { void loadStats(); }, [loadStats]);

  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      Alert.alert("تعذر تنفيذ العملية", `${String((e as Error)?.message ?? e)}\n\nتأكد من نشر الدالة cloudinary-cleanup وتطبيق migration 20261121000200 وضبط أسرار Cloudinary، وأنك المشرف الرئيسي.`);
    } finally {
      setBusy(null);
      void loadStats();
    }
  };

  const processNow = () => run("process", async () => {
    const r = await call<{ claimed: number; deleted: number; notFound: number; skippedInUse: number; retry: number; gaveUp: number }>({ mode: "process", limit: 50 });
    setLastRun(`عولج ${r.claimed}: حُذف ${r.deleted + r.notFound}، متروك لأنه مستخدم ${r.skippedInUse}، سيُعاد ${r.retry}`);
    showToast("تم تشغيل التنظيف");
  });

  const scanPreview = () => run("scan", async () => {
    const r = await call<ScanResult>({ mode: "scan", source: "ledger", dryRun: true });
    setScan(r);
  });

  const queueOrphans = () => {
    if (!scan?.count) return;
    Alert.alert(
      "إضافة الملفات اليتيمة لقائمة الحذف؟",
      `${scan.count} ملفًا (${mb(scan.totalBytes)}) لم يعد لها أي سجل نشط. ستُحذف نهائيًا من Cloudinary عند تشغيل التنظيف، مع إعادة التحقق من عدم استخدامها وقت الحذف.`,
      [
        { text: "إلغاء", style: "cancel" },
        {
          text: "إضافة للحذف", style: "destructive",
          onPress: () => run("queue", async () => {
            const r = await call<{ queued: number }>({ mode: "scan", source: "ledger", dryRun: false });
            showToast(`أُضيف ${r.queued} ملفًا للطابور`);
            setScan(null);
          }),
        },
      ],
    );
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.card}>
        <Text style={styles.title}>طابور الحذف من Cloudinary</Text>
        <Text style={styles.hint}>الملفات التى حُذف أو استُبدل ما يرتبط بها تُحذف فعليًا من Cloudinary فور حذفها (أو من الجدولة) بعد التأكد أنها غير مستخدمة.</Text>
        {stats ? (
          <View style={styles.statsRow}>
            <Stat styles={styles} label="بالانتظار" value={stats.pending} />
            <Stat styles={styles} label="تعثّرت" value={stats.failing} warn={stats.failing > 0} />
            <Stat styles={styles} label="تم حذفها" value={stats.deleted} />
            <Stat styles={styles} label="تُركت (مستخدمة)" value={stats.skippedInUse} />
          </View>
        ) : (
          <Text style={styles.hint}>تعذر تحميل الإحصاءات (انشر الدالة وطبّق الـ migration).</Text>
        )}
        {stats && stats.gaveUp > 0 ? <Text style={[styles.hint, { color: "#B91C1C" }]}>{stats.gaveUp} ملفًا استنفد المحاولات — راجع last_error فى الجدول cloudinary_cleanup_queue.</Text> : null}
        {lastRun ? <Text style={styles.hint}>{lastRun}</Text> : null}
        <Pressable style={[styles.btn, busy ? styles.btnDisabled : null]} onPress={processNow} disabled={!!busy}>
          {busy === "process" ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>تشغيل التنظيف الآن</Text>}
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>فحص الملفات اليتيمة</Text>
        <Text style={styles.hint}>يقارن الملفات المرفوعة (سجل الرفع) بالسجلات النشطة (إعلانات، أفاتار، موسيقى، بانرات، شات...) ويعرض ما لم يعد مرتبطًا بشيء بعد 24 ساعة على الأقل. معاينة فقط — لا يُحذف شيء قبل تأكيدك.</Text>
        <Pressable style={[styles.btnAlt, busy ? styles.btnDisabled : null]} onPress={scanPreview} disabled={!!busy}>
          {busy === "scan" ? <ActivityIndicator color={themeColors.text} /> : <Text style={styles.btnAltText}>فحص ومعاينة</Text>}
        </Pressable>
        {scan ? (
          <View style={{ gap: 6, marginTop: 6 }}>
            <Text style={styles.result}>{scan.count === 0 ? "لا توجد ملفات يتيمة 🎉" : `${scan.count} ملفًا يتيمًا — ${mb(scan.totalBytes)}`}</Text>
            {scan.sample.slice(0, 12).map((c) => (
              <Text key={`${c.resource_type}/${c.public_id}`} style={styles.item} numberOfLines={1}>{c.resource_type} · {c.public_id}</Text>
            ))}
            {scan.count > 0 ? (
              <Pressable style={[styles.btn, { backgroundColor: "#B91C1C" }, busy ? styles.btnDisabled : null]} onPress={queueOrphans} disabled={!!busy}>
                <Text style={styles.btnText}>إضافة اليتامى لقائمة الحذف</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Stat({ styles, label, value, warn }: { styles: ReturnType<typeof createStyles>; label: string; value: number; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, warn ? { color: "#B91C1C" } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 16, padding: 16, gap: 10 },
    title: { fontSize: 15, fontWeight: "900", color: c.text },
    hint: { fontSize: 12, color: c.textSubtle, lineHeight: 19 },
    statsRow: { flexDirection: "row", gap: 8 },
    stat: { flex: 1, backgroundColor: c.background, borderRadius: 12, paddingVertical: 10, alignItems: "center" },
    statValue: { fontSize: 18, fontWeight: "900", color: c.text },
    statLabel: { fontSize: 10.5, color: c.textSubtle, marginTop: 2, textAlign: "center" },
    btn: { backgroundColor: "#22A652", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
    btnText: { color: "white", fontWeight: "900", fontSize: 13.5 },
    btnAlt: { borderRadius: 12, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: c.border },
    btnAltText: { color: c.text, fontWeight: "800", fontSize: 13.5 },
    btnDisabled: { opacity: 0.6 },
    result: { fontSize: 13, fontWeight: "800", color: c.text },
    item: { fontSize: 11, color: c.textSubtle },
  });
}
