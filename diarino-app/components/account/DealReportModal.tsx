import { useEffect, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, type Href } from "expo-router";
import { Property } from "../../lib/types";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { useProfile } from "../../lib/hooks/useProfile";
import { useDealSettings, useReportDeal, feeForDealType, DealType } from "../../lib/hooks/useDeals";
import { showToast } from "../shared/Toast";

// ↔ «تم البيع» / «تم الإيجار» (حسب غرض الإعلان): الناشر يبلّغ بإتمام الصفقة فيتسجّل الرسم المستحق (سياسة البيع والرسوم) ويُغلق الإعلان
// (يختفى من الريلز والبحث، ويبقى فى «إعلاناتى» وصفحة المعلن بشارة «تم البيع/تم الإيجار»).
// رسوم الخدمة: 1000 ج.م للبيع و500 ج.م للإيجار — على البائع/المؤجّر أو الوسيط وحده، ولا شيء على المشتري/المستأجر.
// بعد التسجيل تظهر فاتورة السداد عبر إنستاباي (app/invoice.tsx).
type Props = { visible: boolean; ad: Property | null; onClose: () => void };

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
}

export function DealReportModal({ visible, ad, onClose }: Props) {
  const { t, language } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { profile } = useProfile();
  const { settings } = useDealSettings();
  const report = useReportDeal();
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState<{ dueAt: string | null } | null>(null);

  // الحالة بتتصفّر كل مرة النافذة تتفتح.
  useEffect(() => {
    if (visible) {
      setConfirmed(false);
      setDone(null);
    }
  }, [visible, ad?.id]);

  if (!ad) return null;
  const dealType: DealType = ad.purpose === "rent" ? "rent" : "sale";
  const isRent = dealType === "rent";
  const isBroker = profile?.accountType === "broker";
  const fee = feeForDealType(settings, dealType).toLocaleString(language === "ar" ? "ar-EG" : "en-US");
  const payerLabel = isBroker ? t("الوسيط (أنت)") : isRent ? t("المؤجّر (أنت)") : t("البائع (أنت)");
  const otherLabel = isRent ? t("المستأجر") : t("المشتري");

  function submit() {
    if (!ad || !confirmed || report.isPending) return;
    report.mutate(
      { propertyId: ad.id, dealType },
      {
        onSuccess: (row) => {
          setDone({ dueAt: row?.due_at ?? null });
          showToast(isRent ? t("تم تسجيل التأجير") : t("تم تسجيل البيع"));
        },
        onError: (err) => {
          const code = err instanceof Error ? err.message : "";
          if (code === "already_reported") showToast(t("تم تسجيل صفقة هذا الإعلان من قبل"));
          else if (code === "type_mismatch") showToast(t("نوع الصفقة لا يطابق غرض الإعلان"));
          else showToast(t("تعذر تسجيل الصفقة، حاول مرة أخرى"));
        },
      }
    );
  }

  function openInvoice() {
    const id = ad?.id;
    onClose();
    if (id) setTimeout(() => router.push({ pathname: "/invoice", params: { propertyId: id } } as Href), 350);
  }

  function openPolicy() {
    onClose();
    setTimeout(() => router.push("/policy/sales" as Href), 350);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={done ? onClose : undefined} />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.card}>
          {done ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.doneEmoji}>✅</Text>
              <Text style={styles.title}>{isRent ? t("تم تسجيل التأجير") : t("تم تسجيل البيع")}</Text>
              <Text style={styles.text}>
                {t("أُغلق إعلانك: لن يظهر في الريلز والبحث، ويبقى في إعلاناتي وصفحتك بشارة")} {isRent ? t("تم الإيجار") : t("تم البيع")}.
              </Text>
              <View style={styles.infoBox}>
                <Row styles={styles} k={t("فاتورة رسوم الخدمة")} v={`${fee} ${t("جنيه")}`} strong />
                {done.dueAt ? <Row styles={styles} k={t("آخر موعد للسداد")} v={formatDate(done.dueAt, language === "ar" ? "ar-EG" : "en-US")} /> : null}
                <Text style={styles.infoText}>{t("يتم السداد عبر إنستاباي، ثم تؤكد السداد من صفحة الفاتورة.")}</Text>
              </View>
              <Pressable style={styles.confirmBtn} onPress={openInvoice}>
                <Text style={styles.confirmBtnText}>{t("عرض الفاتورة والسداد")}</Text>
              </Pressable>
              <Pressable style={[styles.cancelBtn, { marginTop: 8, flex: 0 }]} onPress={onClose}>
                <Text style={styles.cancelBtnText}>{t("لاحقًا")}</Text>
              </Pressable>
            </ScrollView>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.title}>{isRent ? t("تم الإيجار") : t("تم البيع")}</Text>
              <Text style={styles.text}>{`«${t(ad.shortTitle || ad.title)}»`}</Text>

              <View style={styles.infoBox}>
                <Row styles={styles} k={t("رسوم الخدمة")} v={`${fee} ${t("جنيه")}`} strong />
                <Row styles={styles} k={t("من يتحمله")} v={payerLabel} />
                <Row styles={styles} k={otherLabel} v={t("لا يدفع أي رسم")} />
                <Row styles={styles} k={t("مهلة السداد")} v={`${settings.payDays} ${t("أيام")}`} />
              </View>

              <Text style={styles.small}>
                {t("بعد التأكيد يُغلق الإعلان ويختفي من الريلز والبحث (ويبقى في إعلاناتي وصفحتك)، وتُصدر فاتورة رسوم الخدمة لسدادها عبر إنستاباي. لا يجوز تحميل الرسم على المشتري أو المستأجر.")}
              </Text>

              <Pressable style={styles.checkRow} onPress={() => setConfirmed((c) => !c)} accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }}>
                <View style={[styles.checkbox, confirmed && styles.checkboxOn]}>
                  {confirmed && <Text style={styles.checkMark}>✓</Text>}
                </View>
                <Text style={styles.checkLabel}>
                  {t("أؤكد أن الصفقة تمت وأن بياناتي صحيحة، وأقرّ بأن رسوم الخدمة مستحقة عليّ وفق")}{" "}
                  <Text style={styles.link} onPress={openPolicy}>{t("سياسة البيع والرسوم")}</Text>
                </Text>
              </Pressable>

              <View style={styles.actionsRow}>
                <Pressable style={styles.cancelBtn} onPress={onClose} disabled={report.isPending}>
                  <Text style={styles.cancelBtnText}>{t("إلغاء")}</Text>
                </Pressable>
                <Pressable
                  style={[styles.confirmBtn, { flex: 1 }, (!confirmed || report.isPending) && styles.confirmBtnDisabled]}
                  onPress={submit}
                  disabled={!confirmed || report.isPending}
                >
                  {report.isPending ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.confirmBtnText}>{t("تأكيد")}</Text>}
                </Pressable>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Row({ styles, k, v, strong }: { styles: ReturnType<typeof createStyles>; k: string; v: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowKey}>{k}</Text>
      <Text style={[styles.rowVal, strong && styles.rowValStrong]}>{v}</Text>
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    wrap: { flex: 1, justifyContent: "center", paddingHorizontal: 22 },
    card: { backgroundColor: themeColors.card, borderRadius: 18, padding: 20, maxHeight: "86%" },
    doneEmoji: { fontSize: 34, textAlign: "center", marginBottom: 6 },
    title: { fontSize: 16, fontWeight: "900", color: themeColors.text, marginBottom: 6, textAlign: "center" },
    text: { fontSize: 12.5, color: themeColors.textSubtle, lineHeight: 20, textAlign: "center", marginBottom: 12 },
    infoBox: { backgroundColor: themeColors.surface, borderRadius: 12, padding: 12, gap: 8, marginBottom: 10 },
    infoTitle: { fontSize: 12.5, fontWeight: "900", color: themeColors.text },
    infoText: { fontSize: 12.5, color: themeColors.textMuted, lineHeight: 20 },
    row: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
    rowKey: { fontSize: 12.5, color: themeColors.textSubtle, fontWeight: "700" },
    rowVal: { fontSize: 12.5, color: themeColors.text, fontWeight: "800", flexShrink: 1, textAlign: "right" },
    rowValStrong: { color: "#22A652", fontSize: 14 },
    small: { fontSize: 11.5, color: themeColors.textSubtle, lineHeight: 18, marginBottom: 12 },
    checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
    checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: themeColors.textSubtle, alignItems: "center", justifyContent: "center", backgroundColor: themeColors.surface },
    checkboxOn: { backgroundColor: "#22A652", borderColor: "#22A652" },
    checkMark: { color: "white", fontSize: 14, fontWeight: "900", lineHeight: 16 },
    checkLabel: { flex: 1, fontSize: 12.5, fontWeight: "600", color: themeColors.text, lineHeight: 20 },
    link: { color: "#22A652", fontWeight: "800", textDecorationLine: "underline" },
    actionsRow: { flexDirection: "row", gap: 10 },
    cancelBtn: { flex: 0.8, borderRadius: 999, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: themeColors.border },
    cancelBtnText: { fontSize: 13, fontWeight: "900", color: themeColors.textMuted },
    confirmBtn: { borderRadius: 999, paddingVertical: 12, alignItems: "center", backgroundColor: "#22A652" },
    confirmBtnDisabled: { opacity: 0.45 },
    confirmBtnText: { fontSize: 13, fontWeight: "900", color: "white" },
  });
}
