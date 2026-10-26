import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import Svg, { Path, Rect } from "react-native-svg";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import {
  PAYMENT_INFO, PAYMENT_METHODS, WALLET_NUMBERS, PaymentMethodKey, isPaymentMethodKey, paymentMethodLabel,
  isValidTripleName, isValidContactPhone,
} from "../../lib/paymentInfo";
import { showToast } from "../shared/Toast";

// ↔ قسم السداد المشترك لكل الفواتير (رسوم «تم البيع / تم الإيجار» + الترويج المدفوع):
//   1) اختيار طريقة السداد: فودافون كاش / اتصالات كاش / إنستاباي — وتظهر بيانات الطريقة المختارة (مع زر نسخ).
//   2) علامة «تم السداد» ثم: اسم الراسل ثلاثيًا + رقم للتواصل (من غير إيميل إنستاباي).
//   3) الإرسال → «بانتظار مراجعة التطبيق». شاشة عادية (مش Modal) فتشتغل على أندرويد وآيفون والويب وAPK.
export type PaymentSubmitValues = { method: PaymentMethodKey; senderName: string; contactPhone: string };

type Props = {
  submitting: boolean;
  onSubmit: (values: PaymentSubmitValues) => void;
  // بيانات سبق إرسالها (فتظهر كملخّص مع إمكانية التعديل وإعادة الإرسال).
  submitted?: { method: string | null; senderName: string | null; contactPhone: string | null } | null;
  initialPhone?: string | null;
  // رسالة تظهر فوق زر الإرسال (مثل «بعد الإرسال يراجع التطبيق...»).
  footnote?: string;
};

export function PaymentSection({ submitting, onSubmit, submitted, initialPhone, footnote }: Props) {
  const { t } = useLanguage();
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);

  const [method, setMethod] = useState<PaymentMethodKey | null>(isPaymentMethodKey(submitted?.method) ? submitted!.method as PaymentMethodKey : null);
  const [paidChecked, setPaidChecked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [senderName, setSenderName] = useState(submitted?.senderName ?? "");
  const [contactPhone, setContactPhone] = useState(submitted?.contactPhone ?? initialPhone ?? "");
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // تعبئة تلقائية لرقم التواصل بعد وصول بيانات الحساب (لو الحقل لسه فاضى).
  useEffect(() => {
    if (initialPhone) setContactPhone((v) => v || initialPhone);
  }, [initialPhone]);

  const hasSubmitted = !!submitted && (!!submitted.senderName || !!submitted.contactPhone);
  const showForm = !hasSubmitted || editing;

  const nameErr = !isValidTripleName(senderName);
  const phoneErr = !isValidContactPhone(contactPhone);

  async function copy(key: string, value: string) {
    try {
      await Clipboard.setStringAsync(value);
      setCopiedKey(key);
      showToast(t("تم النسخ"));
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch {
      showToast(t("تعذر النسخ"));
    }
  }

  function submit() {
    if (submitting) return;
    setTriedSubmit(true);
    if (!method || !paidChecked || nameErr || phoneErr) return;
    onSubmit({ method, senderName: senderName.trim().replace(/\s+/g, " "), contactPhone: contactPhone.trim() });
    setTriedSubmit(false);
    setEditing(false);
    setPaidChecked(false);
  }

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t("اختر طريقة السداد")}</Text>
        <View style={styles.methodsRow}>
          {PAYMENT_METHODS.map((m) => {
            const on = method === m.key;
            return (
              <Pressable
                key={m.key}
                style={[styles.methodBtn, on && styles.methodBtnOn]}
                onPress={() => setMethod(m.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.methodText, on && styles.methodTextOn]}>{t(m.label)}</Text>
              </Pressable>
            );
          })}
        </View>
        {triedSubmit && !method && <Text style={styles.errorText}>{t("اختر طريقة السداد أولًا")}</Text>}

        {(method === "vodafone_cash" || method === "etisalat_cash") && (
          <View style={styles.detailsBox}>
            <Text style={styles.small}>
              {method === "vodafone_cash" ? t("حوّل المبلغ على رقم فودافون كاش:") : t("حوّل المبلغ على رقم اتصالات كاش:")}
            </Text>
            <View style={styles.numberRow}>
              <Text style={styles.number} selectable>{WALLET_NUMBERS[method]}</Text>
              <CopyBtn styles={styles} color={themeColors.text} done={copiedKey === method} onPress={() => copy(method, WALLET_NUMBERS[method])} label={t("نسخ الرقم")} />
            </View>
          </View>
        )}

        {method === "instapay" && (
          <View style={styles.detailsBox}>
            <KV styles={styles} k={t("البنك المرسل إليه")} v={t(PAYMENT_INFO.bankName)} />
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>{t("رقم الحساب")}</Text>
              <View style={styles.numberRow}>
                <Text style={styles.number} selectable>{PAYMENT_INFO.accountNumber}</Text>
                <CopyBtn styles={styles} color={themeColors.text} done={copiedKey === "acct"} onPress={() => copy("acct", PAYMENT_INFO.accountNumber)} label={t("نسخ رقم الحساب")} />
              </View>
            </View>
            <KV styles={styles} k={t("اسم المرسل إليه")} v={PAYMENT_INFO.accountName} />
            <Text style={styles.small}>{t("للتأكد من المرسل إليه: عند إدخال رقم الحساب في إنستاباي سيظهر لك الاسم التالي (مُقنَّع) كما في الصورة:")}</Text>
            <Text style={styles.maskedName}>{PAYMENT_INFO.maskedRecipientName}</Text>
            <View style={styles.imageBox}>
              <Image
                source={require("../../assets/instapay-recipient.jpg")}
                style={styles.recipientImage}
                contentFit="contain"
                accessibilityLabel={t("صورة المرسل إليه في إنستاباي")}
              />
            </View>
          </View>
        )}
        <Text style={styles.warn}>{t("لا تحوّل المبلغ إلا إلى الأرقام والحسابات المعروضة هنا. إذا طلب منك أحد الدفع لحساب آخر باسم التطبيق فأبلغ الدعم فورًا.")}</Text>
      </View>

      {hasSubmitted && !editing && (
        <View style={[styles.card, styles.pendingCard]}>
          <Text style={styles.pendingTitle}>⏳ {t("تم إرسال تأكيد السداد — بانتظار مراجعة التطبيق")}</Text>
          <KV styles={styles} k={t("طريقة السداد")} v={t(paymentMethodLabel(submitted?.method)) || "—"} />
          <KV styles={styles} k={t("اسم الراسل")} v={submitted?.senderName || "—"} />
          <KV styles={styles} k={t("رقم التواصل")} v={submitted?.contactPhone || "—"} ltr />
          <Pressable style={styles.linkBtn} onPress={() => { setEditing(true); setPaidChecked(true); }}>
            <Text style={styles.link}>{t("تعديل البيانات وإعادة الإرسال")}</Text>
          </Pressable>
        </View>
      )}

      {showForm && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("تأكيد السداد")}</Text>
          <Pressable
            style={styles.checkRow}
            onPress={() => setPaidChecked((c) => !c)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: paidChecked }}
          >
            <View style={[styles.checkbox, paidChecked && styles.checkboxOn, triedSubmit && !paidChecked && styles.checkboxError]}>
              {paidChecked && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>{t("تم السداد")}</Text>
          </Pressable>

          {paidChecked && (
            <View style={{ gap: 10 }}>
              <Text style={styles.small}>{t("اكتب بيانات التحويل ليتأكد التطبيق من السداد:")}</Text>
              <Text style={styles.fieldLabel}>{t("اسم الراسل (ثلاثي)")}</Text>
              <TextInput
                style={[styles.input, triedSubmit && nameErr && styles.inputError]}
                value={senderName}
                onChangeText={setSenderName}
                maxLength={120}
                placeholder={t("الاسم الأول والأوسط والأخير")}
                placeholderTextColor={themeColors.textSubtle}
                autoCapitalize="words"
              />
              <Text style={styles.fieldLabel}>{t("رقم للتواصل")}</Text>
              <TextInput
                style={[styles.input, styles.inputLtr, triedSubmit && phoneErr && styles.inputError]}
                value={contactPhone}
                onChangeText={setContactPhone}
                maxLength={30}
                placeholder="+20 10 0000 0000"
                placeholderTextColor={themeColors.textSubtle}
                keyboardType="phone-pad"
              />
              {triedSubmit && (nameErr || phoneErr) && (
                <Text style={styles.errorText}>{t("اكتب الاسم ثلاثيًا ورقم تواصل صحيحًا للمتابعة")}</Text>
              )}
            </View>
          )}
          {triedSubmit && !paidChecked && <Text style={styles.errorText}>{t("ضع علامة «تم السداد» بعد إتمام التحويل")}</Text>}

          <Pressable
            style={[styles.submitBtn, (!method || !paidChecked || submitting) && styles.submitBtnDisabled]}
            onPress={submit}
            disabled={submitting}
          >
            {submitting ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.submitText}>{t("إرسال تأكيد السداد")}</Text>}
          </Pressable>
          {!!footnote && <Text style={styles.small}>{footnote}</Text>}
        </View>
      )}
    </>
  );
}

function KV({ styles, k, v, ltr }: { styles: ReturnType<typeof createStyles>; k: string; v: string; ltr?: boolean }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvKey}>{k}</Text>
      <Text style={[styles.kvVal, ltr && styles.ltrText]} selectable>{v}</Text>
    </View>
  );
}

function CopyBtn({ styles, color, done, onPress, label }: { styles: ReturnType<typeof createStyles>; color: string; done: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable style={[styles.copyBtn, done && styles.copyBtnDone]} onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
      {done ? (
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.4}>
          <Path d="M20 6L9 17l-5-5" />
        </Svg>
      ) : (
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
          <Rect x={9} y={9} width={11} height={11} rx={2} />
          <Path d="M5 15V6a2 2 0 012-2h9" />
        </Svg>
      )}
    </Pressable>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: themeColors.card, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: themeColors.border },
    pendingCard: { borderColor: "#D97706" },
    sectionTitle: { fontSize: 14.5, fontWeight: "900", color: themeColors.text },
    methodsRow: { flexDirection: "row", gap: 8 },
    methodBtn: { flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: themeColors.border, paddingVertical: 11, alignItems: "center", backgroundColor: themeColors.surface },
    methodBtnOn: { borderColor: "#22A652", backgroundColor: themeColors.isDark ? "rgba(34,166,82,0.18)" : "#ecfdf3" },
    methodText: { fontSize: 12.5, fontWeight: "800", color: themeColors.textMuted, textAlign: "center" },
    methodTextOn: { color: "#15803D" },
    detailsBox: { backgroundColor: themeColors.surface, borderRadius: 12, padding: 12, gap: 10 },
    kvRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
    kvKey: { fontSize: 12.5, color: themeColors.textSubtle, fontWeight: "700" },
    kvVal: { fontSize: 12.5, color: themeColors.text, fontWeight: "800", flexShrink: 1, textAlign: "right" },
    ltrText: { writingDirection: "ltr", textAlign: "left" },
    numberRow: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
    number: { fontSize: 15, fontWeight: "900", color: themeColors.text, letterSpacing: 0.5, writingDirection: "ltr" },
    copyBtn: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: themeColors.card, borderWidth: 1, borderColor: themeColors.border },
    copyBtnDone: { backgroundColor: "#22A652", borderColor: "#22A652" },
    small: { fontSize: 11.5, color: themeColors.textSubtle, lineHeight: 18 },
    warn: { fontSize: 11.5, color: "#B45309", lineHeight: 18, fontWeight: "700" },
    maskedName: { fontSize: 14, fontWeight: "900", color: themeColors.text, textAlign: "center", writingDirection: "ltr" },
    imageBox: { backgroundColor: "#ffffff", borderRadius: 12, padding: 6, borderWidth: 1, borderColor: themeColors.border },
    recipientImage: { width: "100%", aspectRatio: 1080 / 295 },
    pendingTitle: { fontSize: 13.5, fontWeight: "900", color: "#B45309", lineHeight: 22 },
    checkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    checkbox: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: themeColors.textSubtle, alignItems: "center", justifyContent: "center", backgroundColor: themeColors.surface },
    checkboxOn: { backgroundColor: "#22A652", borderColor: "#22A652" },
    checkboxError: { borderColor: "#DC2626" },
    checkMark: { color: "white", fontSize: 15, fontWeight: "900", lineHeight: 17 },
    checkLabel: { fontSize: 14, fontWeight: "800", color: themeColors.text },
    fieldLabel: { fontSize: 12.5, fontWeight: "800", color: themeColors.textMuted },
    input: { backgroundColor: themeColors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: themeColors.text, borderWidth: 1, borderColor: themeColors.border },
    inputLtr: { writingDirection: "ltr", textAlign: "left" },
    inputError: { borderColor: "#DC2626" },
    errorText: { color: "#DC2626", fontSize: 12, fontWeight: "700" },
    submitBtn: { borderRadius: 999, paddingVertical: 13, alignItems: "center", backgroundColor: "#22A652", marginTop: 4 },
    submitBtnDisabled: { opacity: 0.5 },
    submitText: { color: "white", fontSize: 14, fontWeight: "900" },
    linkBtn: { alignItems: "center", paddingVertical: 6 },
    link: { color: "#22A652", fontWeight: "800", textDecorationLine: "underline", fontSize: 13 },
  });
}
