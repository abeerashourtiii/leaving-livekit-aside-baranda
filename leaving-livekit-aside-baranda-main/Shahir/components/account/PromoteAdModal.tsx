import { useEffect, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, type Href } from "expo-router";
import { Property } from "../../lib/types";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import {
  INTRO_REACH_GOALS, PROMO_STATUS_LABELS, PromoKind, livePromotionsFor, promoPrice,
  useCreatePromotion, useMyPromotions, usePromoSettings,
} from "../../lib/hooks/usePromotions";
import { showToast } from "../shared/Toast";

// ↔ «اجعل الإعلان افتتاحي / مميز» (من ⋮ على كارت الإعلان فى «إعلاناتي»):
//   مميز = يظهر أثناء التصفح وفى صفحة البحث — 300 ج.م. | افتتاحي = أول ما تُفتح الصفحة الرئيسية — 1000 ج.م لهدف 3000 / 2000 ج.م لهدف 5000.
//   والمدة 7 أيام (بدون اختيار فئة عمرية — اتلغى الاستهداف العمرى من هنا). «متابعة الدفع» تُنشئ الطلب وتفتح فاتورة السداد (app/promotion-invoice.tsx)،
//   والتفعيل بعد مراجعة التطبيق للسداد (سياسة البيع والرسوم، بند الترويج المدفوع).
type Props = { visible: boolean; ad: Property | null; onClose: () => void };

export function PromoteAdModal({ visible, ad, onClose }: Props) {
  const { t, language } = useLanguage();
  const locale = language === "ar" ? "ar-EG" : "en-US";
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { user } = useCurrentUser();
  const { settings } = usePromoSettings();
  const { data: myPromos } = useMyPromotions(user?.id);
  const create = useCreatePromotion();

  const [kind, setKind] = useState<PromoKind>("featured");
  const [reachGoal, setReachGoal] = useState<number>(3000);

  useEffect(() => {
    if (visible) {
      setKind("featured");
      setReachGoal(3000);
    }
  }, [visible, ad?.id]);

  if (!ad) return null;
  const live = livePromotionsFor(myPromos, ad.id);
  const blocking = live.find((p) => p.kind === kind);
  const price = promoPrice(settings, kind, kind === "intro" ? reachGoal : null);
  const fmt = (n: number) => n.toLocaleString(locale);

  function openInvoice(id: string) {
    onClose();
    setTimeout(() => router.push({ pathname: "/promotion-invoice", params: { id } } as Href), 350);
  }

  function submit() {
    if (!ad || create.isPending) return;
    if (blocking) {
      openInvoice(blocking.id);
      return;
    }
    create.mutate(
      { propertyId: ad.id, kind, reachGoal: kind === "intro" ? reachGoal : null, ageMin: null, ageMax: null },
      {
        onSuccess: (row) => {
          showToast(t("تم إصدار فاتورة الترويج"));
          if (row?.id) openInvoice(row.id);
          else onClose();
        },
        onError: (err) => {
          const code = err instanceof Error ? err.message : "";
          if (code === "already_promoted") showToast(t("لديك طلب ترويج قائم لهذا الإعلان من نفس النوع"));
          else if (code === "ad_not_promotable") showToast(t("الترويج متاح للإعلان المنشور فقط (بعد موافقة الإدارة وقبل تسجيل البيع/الإيجار)"));
          else if (code === "not_owner") showToast(t("هذا الإعلان ليس إعلانك"));
          else showToast(t("تعذر إصدار الفاتورة، حاول مرة أخرى"));
        },
      }
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.card}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{t("ترويج الإعلان")}</Text>
            <Text style={styles.sub}>{`«${t(ad.shortTitle || ad.title)}»`}</Text>

            {live.length > 0 && (
              <View style={styles.liveBox}>
                {live.map((p) => (
                  <Pressable key={p.id} style={styles.liveRow} onPress={() => openInvoice(p.id)}>
                    <Text style={styles.liveText} numberOfLines={2}>
                      {p.kind === "intro" ? t("افتتاحي") : t("مميز")} — {t(PROMO_STATUS_LABELS[p.status])}
                    </Text>
                    <Text style={styles.link}>{t("عرض")}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Text style={styles.label}>{t("نوع الترويج")}</Text>
            <Pressable style={[styles.option, kind === "featured" && styles.optionOn]} onPress={() => setKind("featured")} accessibilityRole="radio" accessibilityState={{ selected: kind === "featured" }}>
              <Text style={[styles.optionTitle, kind === "featured" && styles.optionTitleOn]}>{t("إعلان مميز")}</Text>
              <Text style={styles.optionDesc}>{t("يظهر أثناء التصفح وفي صفحة البحث")}</Text>
              <Text style={styles.optionPrice}>{fmt(settings.featuredPriceEgp)} {t("جنيه")}</Text>
            </Pressable>
            <Pressable style={[styles.option, kind === "intro" && styles.optionOn]} onPress={() => setKind("intro")} accessibilityRole="radio" accessibilityState={{ selected: kind === "intro" }}>
              <Text style={[styles.optionTitle, kind === "intro" && styles.optionTitleOn]}>{t("إعلان افتتاحي")}</Text>
              <Text style={styles.optionDesc}>{t("أول ريل يظهر عند فتح الصفحة الرئيسية")}</Text>
              <Text style={styles.optionPrice}>{t("من")} {fmt(settings.intro3000PriceEgp)} {t("جنيه")}</Text>
            </Pressable>

            {kind === "intro" && (
              <>
                <Text style={styles.label}>{t("الهدف: عدد المشاهدات المستهدفة")}</Text>
                <View style={styles.chipsRow}>
                  {INTRO_REACH_GOALS.map((g) => {
                    const on = reachGoal === g;
                    return (
                      <Pressable key={g} style={[styles.chip, on && styles.chipOn]} onPress={() => setReachGoal(g)}>
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {fmt(g)} {t("شخص")} — {fmt(promoPrice(settings, "intro", g))} {t("جنيه")}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            <View style={styles.summary}>
              <Row styles={styles} k={t("مدة الترويج")} v={`${settings.durationDays} ${t("أيام")}`} />
              <Row styles={styles} k={t("المبلغ المطلوب")} v={`${fmt(price)} ${t("جنيه")}`} strong />
            </View>
            <Text style={styles.small}>
              {t("بعد «متابعة الدفع» تصدر فاتورة بالمبلغ، وتسدّدها عبر فودافون كاش أو اتصالات كاش أو إنستاباي، ثم يراجع التطبيق السداد ويفعّل الترويج. تبدأ المدة من تاريخ التفعيل.")}
            </Text>

            <View style={styles.actionsRow}>
              <Pressable style={styles.cancelBtn} onPress={onClose} disabled={create.isPending}>
                <Text style={styles.cancelBtnText}>{t("إلغاء")}</Text>
              </Pressable>
              <Pressable style={[styles.confirmBtn, create.isPending && styles.confirmBtnDisabled]} onPress={submit} disabled={create.isPending}>
                {create.isPending ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text style={styles.confirmBtnText}>{blocking ? t("عرض فاتورة الطلب الحالي") : t("متابعة الدفع")}</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
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
    wrap: { flex: 1, justifyContent: "center", paddingHorizontal: 18 },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    card: { backgroundColor: themeColors.card, borderRadius: 18, padding: 18, maxHeight: "90%" },
    title: { fontSize: 16, fontWeight: "900", color: themeColors.text, textAlign: "center" },
    sub: { fontSize: 12.5, color: themeColors.textSubtle, textAlign: "center", marginTop: 4, marginBottom: 10 },
    label: { fontSize: 12.5, fontWeight: "900", color: themeColors.text, marginTop: 12, marginBottom: 6 },
    liveBox: { backgroundColor: themeColors.surface, borderRadius: 12, padding: 10, gap: 6, marginBottom: 4 },
    liveRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    liveText: { flex: 1, fontSize: 12, fontWeight: "700", color: themeColors.textMuted },
    option: { borderWidth: 1.5, borderColor: themeColors.border, borderRadius: 14, padding: 12, marginBottom: 8, backgroundColor: themeColors.surface, gap: 3 },
    optionOn: { borderColor: "#22A652", backgroundColor: themeColors.isDark ? "rgba(34,166,82,0.16)" : "#ecfdf3" },
    optionTitle: { fontSize: 14, fontWeight: "900", color: themeColors.text },
    optionTitleOn: { color: "#15803D" },
    optionDesc: { fontSize: 12, color: themeColors.textSubtle },
    optionPrice: { fontSize: 13, fontWeight: "900", color: "#22A652", marginTop: 2 },
    chipsRow: { gap: 8 },
    chip: { borderWidth: 1.5, borderColor: themeColors.border, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: themeColors.surface },
    chipOn: { borderColor: "#22A652", backgroundColor: themeColors.isDark ? "rgba(34,166,82,0.2)" : "#dcfce7" },
    chipText: { fontSize: 12.5, fontWeight: "800", color: themeColors.textMuted },
    chipTextOn: { color: "#15803D" },
    summary: { backgroundColor: themeColors.surface, borderRadius: 12, padding: 12, gap: 8, marginTop: 14 },
    row: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
    rowKey: { fontSize: 12.5, color: themeColors.textSubtle, fontWeight: "700" },
    rowVal: { fontSize: 12.5, color: themeColors.text, fontWeight: "800" },
    rowValStrong: { color: "#22A652", fontSize: 15 },
    small: { fontSize: 11.5, color: themeColors.textSubtle, lineHeight: 18, marginTop: 10, marginBottom: 12 },
    link: { color: "#22A652", fontWeight: "800", textDecorationLine: "underline", fontSize: 12.5 },
    actionsRow: { flexDirection: "row", gap: 10 },
    cancelBtn: { flex: 0.8, borderRadius: 999, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: themeColors.border },
    cancelBtnText: { fontSize: 13, fontWeight: "900", color: themeColors.textMuted },
    confirmBtn: { flex: 1.4, borderRadius: 999, paddingVertical: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#22A652" },
    confirmBtnDisabled: { opacity: 0.5 },
    confirmBtnText: { fontSize: 13, fontWeight: "900", color: "white", textAlign: "center" },
  });
}
