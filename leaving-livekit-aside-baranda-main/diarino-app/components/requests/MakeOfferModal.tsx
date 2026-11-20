import { useState } from "react";
import { KeyboardAvoid } from "../../components/shared/KeyboardAvoid";
import { Modal, View, Text, TextInput, Pressable, StyleSheet, Animated } from "react-native";
import { PropertyRequest } from "../../data/mock-requests";
import { fmtPrice, Property } from "../../lib/types";
import { PhoneInput, PhoneInputValue } from "../shared/PhoneInput";
import { validateAndFormatPhone } from "../../lib/phone";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { useDragToClose } from "../../lib/hooks/useDragToClose";

// ↔ نفس النافذة بتخدم حالتين: تقديم عرض على «طلب» (request — صفحة الطلبات) أو على «إعلان عقار» (property — صفحة التفاصيل،
//   أيقونة بجوار زر الاتصال). الحقول واحدة (رسالة + سعر مقترح اختيارى + واتساب)، والملخص بيتغيّر حسب المصدر.
type Props = {
  visible: boolean;
  request?: PropertyRequest | null;
  property?: Property | null;
  onClose: () => void;
  onSubmit: (message: string, price: string, whatsapp: string) => void;
  submitting?: boolean;
};

export function MakeOfferModal({ visible, request = null, property = null, onClose, onSubmit, submitting = false }: Props) {
  const { t } = useLanguage();
  const [message, setMessage] = useState("");
  const [price, setPrice] = useState("");
  const [whatsapp, setWhatsapp] = useState<PhoneInputValue>({ countryIso2: "", localNumber: "" });
  const [whatsappError, setWhatsappError] = useState(false);
  const [messageError, setMessageError] = useState(false);
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { translateY, backdropOpacity, panHandlers } = useDragToClose(() => { reset(); onClose(); }, { visible });

  function reset() {
    setMessage(""); setPrice(""); setWhatsapp({ countryIso2: "", localNumber: "" }); setWhatsappError(false); setMessageError(false);
  }

  function submit() {
    // ↔ الرسالة مطلوبة. رقم الواتساب **اختيارى** (طلب المستخدم): ممكن يكمّل المحادثة داخل التطبيق من صفحة «العروض» من غير رقم.
    //   لو كتب رقم لازم يكون صحيح حسب الدولة المختارة (E.164)، ولو سابه فاضي بنبعت "" والخادم بيحوّلها null.
    if (!message.trim()) { setMessageError(true); return; }
    let e164 = "";
    if (whatsapp.localNumber.trim()) {
      const result = whatsapp.countryIso2 ? validateAndFormatPhone(whatsapp.localNumber, whatsapp.countryIso2) : { valid: false as const, reason: "" };
      if (!result.valid) { setWhatsappError(true); return; }
      e164 = result.e164;
    }
    onSubmit(message.trim(), price.trim(), e164);
    reset();
  }

  if (!request && !property) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><KeyboardAvoid style={{ flex: 1 }} mode="sheet">
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => { reset(); onClose(); }} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]} {...panHandlers}>
        <View style={styles.dragHandle} />
        <Text style={styles.title}>{t("تقديم عرض")}</Text>
        {request ? (
          <Text style={styles.summary}>
            <Text style={{ fontWeight: "900" }}>{t(request.type)} {request.purpose === "sale" ? t("للبيع") : t("للإيجار")}</Text>
            {" · "}{request.province} · {request.location}{"\n"}طلب من: {request.requesterName}
          </Text>
        ) : property ? (
          <Text style={styles.summary}>
            <Text style={{ fontWeight: "900" }}>{t(property.type)} {property.purpose === "sale" ? t("للبيع") : t("للإيجار")}</Text>
            {" · "}{property.province} · {property.location}{"\n"}{t("السعر المطلوب")}: {fmtPrice(property.price)} {t("ج.م")}
          </Text>
        ) : null}
        <Text style={styles.privacyNote}>{request ? t("يصل عرضك لصاحب الطلب فقط في محادثة خاصة.") : t("يصل عرضك لصاحب الإعلان فقط في محادثة خاصة.")}</Text>

        <Text style={styles.label}>{t("رسالتك")}<Text style={{ color: "#ef4444" }}> *</Text></Text>
        <TextInput
          style={[styles.textarea, messageError && styles.inputError]}
          value={message}
          onChangeText={(v) => { setMessage(v); setMessageError(false); }}
          placeholder={t("اكتب تفاصيل العرض...")}
          placeholderTextColor={themeColors.textSubtle}
          multiline
          numberOfLines={4}
        />
        {messageError && <Text style={styles.errorText}>{t("اكتب رسالتك")}</Text>}

        <Text style={styles.label}>{t("السعر المقترح")}</Text>
        <TextInput
          style={styles.input}
          value={price}
          onChangeText={setPrice}
          placeholder={property ? String(property.price) : "3800000"}
          placeholderTextColor={themeColors.textSubtle}
          keyboardType="number-pad"
        />
        {!!price && <Text style={styles.pricePreview}>{fmtPrice(Number(price) || 0)} ج.م</Text>}

        <Text style={styles.label}>{t("رقم واتساب للتواصل")}</Text>
        <PhoneInput
          value={whatsapp}
          onChange={(v) => { setWhatsapp(v); setWhatsappError(false); }}
          error={whatsappError}
        />
        {whatsappError && <Text style={styles.errorText}>{t("ادخل رقم واتساب صحيح")}</Text>}
        <Text style={styles.optionalNote}>{t("يمكنك المتابعة بالمحادثة داخل التطبيق من صفحة «العروض» (الأيقونة بجوار جرس الإشعارات) دون كتابة أي رقم. وإن كتبته فسيراه الطرف الآخر.")}</Text>

        <Pressable style={[styles.submitBtn, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting}>
          <Text style={styles.submitBtnText}>{t("إرسال العرض")}</Text>
        </Pressable>
      </Animated.View>
    </KeyboardAvoid></Modal>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
    sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: themeColors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 30 },
    dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: themeColors.border, alignSelf: "center", marginBottom: 12 },
    title: { fontSize: 15, fontWeight: "900", color: themeColors.text, marginBottom: 8 },
    summary: { fontSize: 12, color: themeColors.textSubtle, lineHeight: 19, marginBottom: 16 },
    optionalNote: { fontSize: 11, color: themeColors.textSubtle, lineHeight: 17, marginTop: 6 },
    privacyNote: { fontSize: 11, color: themeColors.textSubtle, lineHeight: 17, marginTop: -8, marginBottom: 8 },
    label: { fontSize: 11.5, fontWeight: "800", color: themeColors.textMuted, marginBottom: 6, marginTop: 10 },
    input: { backgroundColor: themeColors.surface, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 12, fontSize: 13, color: themeColors.text },
    textarea: { backgroundColor: themeColors.surface, borderRadius: 10, padding: 12, fontSize: 13, color: themeColors.text, minHeight: 90, textAlignVertical: "top" },
    inputError: { borderWidth: 1.5, borderColor: "#ef4444" },
    errorText: { color: "#ef4444", fontSize: 11, marginTop: 4 },
    pricePreview: { color: "#22A652", fontSize: 11, fontWeight: "800", marginTop: 4 },
    submitBtn: { marginTop: 18, backgroundColor: "#22A652", borderRadius: 999, paddingVertical: 14, alignItems: "center" },
    submitBtnText: { color: "white", fontWeight: "900", fontSize: 14 },
  });
}
