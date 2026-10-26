import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "../lib/hooks/useLanguage";
import { useThemeColors, ThemeColors } from "../lib/hooks/useThemeColors";
import { useCurrentUser } from "../lib/hooks/useCurrentUser";
import { useProfile } from "../lib/hooks/useProfile";
import { useLogMedia } from "../lib/hooks/useMedia";
import { usePromoSettings, PROMO_STATUS_LABELS } from "../lib/hooks/usePromotions";
import {
  AD_SPACE_DURATIONS, AdSpaceDuration, EXCLUSIVE_AD_WHATSAPP_URL, adSpacePrice,
  useCancelAdSpaceOrder, useConfirmAdSpacePayment, useCreateAdSpaceOrder, useMyAdSpaceOrders,
} from "../lib/hooks/useAdSpaceOrders";
import { uploadToCloudinary, cldCrop, cldOptimized, isVideoUrl, VIDEO_AS_IMAGE_MESSAGE, CloudinaryUploadError } from "../lib/cloudinary";
import { AD_BANNER_ASPECT, AD_BANNER_SPEC_TEXT } from "../lib/adBannerSpec";
import { openExternalUrl } from "../lib/linking";
import { ImageCropModal, CropRect } from "../components/admin/ImageCropModal";
import { PaymentSection } from "../components/payments/PaymentSection";
import { showToast } from "../components/shared/Toast";

// ↔ حجز «المساحة الإعلانية» (بدل التحويل لواتساب): بتتفتح من الضغط على صورة «ضع إعلانك هنا» فى صفحة القائمة.
//   ١) صورة الإعلان (بإطار قص بمقاس المساحة)  ٢) المدة: 7 أيام 1500 ج / 14 يومًا 2500 ج / 30 يومًا 4000 ج
//   ٣) إصدار الفاتورة ← السداد بفودافون كاش / اتصالات كاش / إنستاباي (PaymentSection) + اسم الراسل ثلاثيًا + رقم التواصل
//   ٤) مراجعة الأدمن للسداد والصورة ← التفعيل: يظهر الإعلان فى صفحة القائمة وفى صفحة البحث مع كل الفلاتر.
//   الإعلان الحصرى: التواصل عبر واتساب. الشاشة عادية (مش Modal) فتشتغل على أندرويد وآيفون والويب وAPK.
function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
}

export default function AdSpaceScreen() {
  const { orderId: rawId } = useLocalSearchParams<{ orderId?: string }>();
  const orderId = Array.isArray(rawId) ? rawId[0] : rawId;
  const { t, language } = useLanguage();
  const locale = language === "ar" ? "ar-EG" : "en-US";
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const insets = useSafeAreaInsets();
  const { user } = useCurrentUser();
  const { profile } = useProfile();
  const { settings } = usePromoSettings();
  const { data: orders, isLoading } = useMyAdSpaceOrders(user?.id);
  const create = useCreateAdSpaceOrder();
  const confirm = useConfirmAdSpacePayment();
  const cancel = useCancelAdSpaceOrder();
  const logMedia = useLogMedia();

  const [imageUrl, setImageUrl] = useState("");
  const [imageInfo, setImageInfo] = useState("");
  const [uploading, setUploading] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [days, setDays] = useState<AdSpaceDuration>(7);
  const [rightsOk, setRightsOk] = useState(false);

  const isGuest = !user || !!user.is_anonymous;
  const order = orderId ? orders?.find((o) => o.id === orderId) : undefined;
  const fmt = (n: number) => n.toLocaleString(locale);

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/menu" as Href);
  }

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1 });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset.type === "video" || asset.mimeType?.startsWith("video/") || isVideoUrl(asset.uri)) {
      Alert.alert(t("اختر صورة"), VIDEO_AS_IMAGE_MESSAGE);
      return;
    }
    setCropSource(asset.uri);
  }

  // بعد ✅ فى نافذة القص: نرفع الأصل على Cloudinary ونخزّن رابطًا فيه تحويل القص (نفس مسار صورة الأدمن بالظبط).
  async function onCropConfirmed(rect: CropRect, natural: { width: number; height: number }) {
    const uri = cropSource;
    setCropSource(null);
    if (!uri) return;
    setUploading(true);
    try {
      const up = await uploadToCloudinary(uri, "image");
      if (user?.id) logMedia.mutate({ ownerId: user.id, type: "image", context: "other", result: up });
      let sw = up.width ?? natural.width;
      let sh = up.height ?? natural.height;
      const viewAspect = natural.width / natural.height;
      if (Math.abs(sw / sh - viewAspect) > 0.05 && Math.abs(sh / sw - viewAspect) < 0.05) [sw, sh] = [sh, sw];
      const cropped = cldCrop(up.url, rect, sw, sh);
      let finalUrl = cropped.url;
      if (cropped.url !== up.url) {
        let loads = true;
        try { loads = await Image.prefetch(cldOptimized(cropped.url, "w_700,q_auto,f_auto")); } catch { loads = true; }
        if (!loads) finalUrl = up.url; // لو تحويل القص مرفوض نحتفظ بالأصل (يُعرض مضبوطًا من المركز)
      }
      setImageUrl(finalUrl);
      setImageInfo(`${cropped.width} × ${cropped.height} px`);
    } catch (e) {
      Alert.alert(t("تعذر رفع الصورة"), e instanceof CloudinaryUploadError ? e.message : t("حاول مرة أخرى."));
    } finally {
      setUploading(false);
    }
  }

  function issueInvoice() {
    if (create.isPending) return;
    if (!imageUrl) { showToast(t("اختر صورة الإعلان أولًا")); return; }
    if (!rightsOk) { showToast(t("أقرّ بملكية حقوق الصورة والالتزام بالسياسات أولًا")); return; }
    create.mutate(
      { imageUrl, durationDays: days },
      {
        onSuccess: (row) => {
          showToast(t("تم إصدار الفاتورة"));
          setImageUrl(""); setImageInfo(""); setRightsOk(false);
          if (row?.id) router.replace({ pathname: "/ad-space", params: { orderId: row.id } } as Href);
        },
        onError: (err) => {
          const code = err instanceof Error ? err.message : "";
          if (code === "too_many_open_orders") showToast(t("لديك طلبات غير مسدّدة كثيرة، أكمل أو ألغِ بعضها أولًا"));
          else if (code === "not_authenticated") showToast(t("سجّل الدخول بحسابك أولًا"));
          else showToast(t("تعذر إصدار الفاتورة، حاول مرة أخرى"));
        },
      }
    );
  }

  function onSubmitPayment(v: { method: string; senderName: string; contactPhone: string }) {
    if (!order) return;
    confirm.mutate(
      { id: order.id, method: v.method, senderName: v.senderName, contactPhone: v.contactPhone },
      {
        onSuccess: () => showToast(t("تم إرسال تأكيد السداد، وسيراجعه فريق التطبيق")),
        onError: (err) => {
          const code = err instanceof Error ? err.message : "";
          if (code === "order_closed") showToast(t("هذا الطلب مغلق بالفعل"));
          else if (code === "bad_sender_name") showToast(t("اكتب اسم الراسل ثلاثيًا"));
          else if (code === "bad_contact_phone") showToast(t("اكتب رقمًا صحيحًا للتواصل"));
          else if (code === "bad_method") showToast(t("اختر طريقة السداد"));
          else showToast(t("تعذر إرسال تأكيد السداد، حاول مرة أخرى"));
        },
      }
    );
  }

  function onCancelOrder() {
    if (!order) return;
    cancel.mutate(order.id, {
      onSuccess: () => { showToast(t("تم إلغاء الطلب")); router.replace("/ad-space" as Href); },
      onError: () => showToast(t("تعذر إلغاء الطلب")),
    });
  }

  const canPay = order?.status === "pending_payment" || order?.status === "submitted" || order?.status === "rejected";

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ImageCropModal
          visible={!!cropSource}
          uri={cropSource}
          aspect={AD_BANNER_ASPECT}
          specText={AD_BANNER_SPEC_TEXT}
          onCancel={() => setCropSource(null)}
          onConfirm={onCropConfirmed}
        />
        <View style={styles.header}>
          <Pressable style={styles.closeBtn} onPress={close} hitSlop={8} accessibilityRole="button">
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={themeColors.text} strokeWidth={2}>
              <Path d="M18 6L6 18M6 6l12 12" />
            </Svg>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{orderId ? t("فاتورة المساحة الإعلانية") : t("احجز مساحة إعلانية")}</Text>
          <View style={{ width: 34 }} />
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {isGuest ? (
            <View style={styles.card}>
              <Text style={styles.paragraph}>{t("حجز المساحة الإعلانية يتطلب حسابًا مسجّلًا. سجّل الدخول ثم أعد المحاولة.")}</Text>
              <Pressable style={styles.primaryBtn} onPress={() => router.replace("/" as Href)}>
                <Text style={styles.primaryBtnText}>{t("تسجيل الدخول")}</Text>
              </Pressable>
            </View>
          ) : orderId ? (
            isLoading && !order ? (
              <ActivityIndicator color="#22A652" style={{ marginTop: 40 }} />
            ) : !order ? (
              <View style={styles.card}><Text style={styles.paragraph}>{t("لم يتم العثور على الطلب.")}</Text></View>
            ) : (
              <>
                <View style={styles.card}>
                  <View style={styles.previewBox}>
                    <Image source={{ uri: cldOptimized(order.imageUrl, "w_700,q_auto,f_auto") }} style={styles.preview} contentFit="cover" />
                  </View>
                  <Row styles={styles} k={t("المدة")} v={`${order.durationDays} ${t("يومًا")}`} />
                  <Row styles={styles} k={t("المبلغ المطلوب")} v={`${fmt(order.priceEgp)} ${t("جنيه")}`} strong />
                  <Row styles={styles} k={t("حالة الطلب")} v={t(PROMO_STATUS_LABELS[order.status])} />
                  {order.status === "active" && !!order.endsAt && <Row styles={styles} k={t("مفعّل حتى")} v={formatDate(order.endsAt, locale)} />}
                </View>

                {order.status === "active" && (
                  <View style={[styles.card, styles.okCard]}>
                    <Text style={styles.okTitle}>✅ {t("تم تفعيل إعلانك")}</Text>
                    <Text style={styles.paragraph}>{t("يظهر الآن في المساحة الإعلانية بصفحة القائمة وفي صفحة البحث حتى انتهاء المدة.")}</Text>
                  </View>
                )}
                {order.status === "rejected" && (
                  <View style={[styles.card, styles.badCard]}>
                    <Text style={styles.badTitle}>{t("تم رفض الطلب")}</Text>
                    {!!order.adminNote && <Text style={styles.paragraph}>{order.adminNote}</Text>}
                    <Text style={styles.paragraph}>{t("يمكنك تصحيح بيانات السداد وإعادة إرسالها.")}</Text>
                  </View>
                )}
                {(order.status === "expired" || order.status === "cancelled") && (
                  <View style={styles.card}>
                    <Text style={styles.paragraph}>{order.status === "expired" ? t("انتهت مدة هذا الإعلان.") : t("تم إلغاء هذا الطلب.")}</Text>
                  </View>
                )}

                {canPay && (
                  <PaymentSection
                    key={`${order.id}:${order.status}`}
                    submitting={confirm.isPending}
                    onSubmit={onSubmitPayment}
                    initialPhone={profile?.phoneE164}
                    submitted={order.status === "submitted" ? { method: order.paymentMethod, senderName: order.paymentSenderName, contactPhone: order.paymentContactPhone } : null}
                    footnote={t("بعد الإرسال يراجع التطبيق التحويل والصورة ثم يفعّل إعلانك. تُحفظ هذه البيانات لمراجعة السداد فقط (سياسة الخصوصية).")}
                  />
                )}
                {order.status === "pending_payment" && (
                  <Pressable style={styles.linkBtn} onPress={onCancelOrder} disabled={cancel.isPending}>
                    <Text style={styles.dangerLink}>{t("إلغاء الطلب")}</Text>
                  </Pressable>
                )}
              </>
            )
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("١) صورة إعلانك")}</Text>
                <Text style={styles.small}>{t("مقاس الصورة المطلوب:")} {AD_BANNER_SPEC_TEXT}. {t("ستُضبط داخل إطار بنفس النسبة قبل الرفع.")}</Text>
                <Pressable style={styles.imagePicker} onPress={pickImage} disabled={uploading}>
                  {uploading ? (
                    <ActivityIndicator color="#22A652" />
                  ) : imageUrl ? (
                    <Image source={{ uri: cldOptimized(imageUrl, "w_700,q_auto,f_auto") }} style={styles.preview} contentFit="cover" />
                  ) : (
                    <Text style={styles.imagePickerText}>{t("اضغط لاختيار صورة الإعلان")}</Text>
                  )}
                </Pressable>
                {!!imageInfo && <Text style={styles.small}>{imageInfo}</Text>}
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("٢) مدة الإعلان")}</Text>
                <View style={styles.durationsRow}>
                  {AD_SPACE_DURATIONS.map((d) => {
                    const on = days === d;
                    return (
                      <Pressable key={d} style={[styles.durationBtn, on && styles.durationBtnOn]} onPress={() => setDays(d)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                        <Text style={[styles.durationDays, on && styles.durationDaysOn]}>{d} {t("يومًا")}</Text>
                        <Text style={styles.durationPrice}>{fmt(adSpacePrice(settings, d))} {t("جنيه")}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.small}>{t("تبدأ المدة من تاريخ التفعيل بعد مراجعة السداد.")}</Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("٣) السداد")}</Text>
                <Text style={styles.small}>{t("بعد الضغط على «إصدار الفاتورة» تختار طريقة السداد (فودافون كاش أو اتصالات كاش أو إنستاباي) وتكتب اسم الراسل ثلاثيًا ورقم التواصل، ثم يراجع التطبيق السداد ويفعّل إعلانك.")}</Text>
                <Pressable style={styles.checkRow} onPress={() => setRightsOk((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: rightsOk }}>
                  <View style={[styles.checkbox, rightsOk && styles.checkboxOn]}>{rightsOk && <Text style={styles.checkMark}>✓</Text>}</View>
                  <Text style={styles.checkLabel}>{t("أقرّ بأنني مالك حقوق هذه الصورة، وأن الإعلان لا يخالف الشروط والسياسات، وأتحمل مسؤوليته كاملة.")}</Text>
                </Pressable>
                <Pressable style={[styles.primaryBtn, (!imageUrl || !rightsOk || create.isPending) && styles.btnDisabled]} onPress={issueInvoice} disabled={create.isPending}>
                  {create.isPending ? <ActivityIndicator color="white" size="small" /> : (
                    <Text style={styles.primaryBtnText}>{t("إصدار الفاتورة")} — {fmt(adSpacePrice(settings, days))} {t("جنيه")}</Text>
                  )}
                </Pressable>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("إعلان حصري في المساحة الإعلانية؟")}</Text>
                <Text style={styles.small}>{t("للإعلان الحصري تواصل معنا عبر واتساب.")}</Text>
                <Pressable style={styles.whatsBtn} onPress={() => openExternalUrl(EXCLUSIVE_AD_WHATSAPP_URL)}>
                  <Text style={styles.whatsBtnText}>{t("تواصل عبر واتساب")}</Text>
                </Pressable>
              </View>

              {(orders?.length ?? 0) > 0 && (
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>{t("طلباتي السابقة")}</Text>
                  {orders!.map((o) => (
                    <Pressable key={o.id} style={styles.orderRow} onPress={() => router.push({ pathname: "/ad-space", params: { orderId: o.id } } as Href)}>
                      <Text style={styles.orderText} numberOfLines={1}>
                        {o.durationDays} {t("يومًا")} · {fmt(o.priceEgp)} {t("جنيه")} — {t(PROMO_STATUS_LABELS[o.status])}
                      </Text>
                      <Text style={styles.link}>{t("عرض")}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}

          <Pressable style={styles.linkBtn} onPress={() => router.push("/policy/sales" as Href)}>
            <Text style={styles.link}>{t("سياسة البيع والرسوم")}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
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
    container: { flex: 1, backgroundColor: themeColors.background },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: themeColors.border },
    closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: themeColors.surface },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "800", color: themeColors.text },
    content: { padding: 16, gap: 14 },
    card: { backgroundColor: themeColors.card, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: themeColors.border },
    okCard: { borderColor: "#22A652" },
    badCard: { borderColor: "#DC2626" },
    sectionTitle: { fontSize: 14.5, fontWeight: "900", color: themeColors.text },
    paragraph: { fontSize: 13.5, lineHeight: 22, color: themeColors.text, fontWeight: "500" },
    small: { fontSize: 11.5, color: themeColors.textSubtle, lineHeight: 18 },
    imagePicker: { aspectRatio: AD_BANNER_ASPECT, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", borderColor: themeColors.border, backgroundColor: themeColors.surface, alignItems: "center", justifyContent: "center", overflow: "hidden" },
    imagePickerText: { fontSize: 13, fontWeight: "800", color: themeColors.textMuted },
    previewBox: { aspectRatio: AD_BANNER_ASPECT, borderRadius: 14, overflow: "hidden", backgroundColor: themeColors.surface },
    preview: { width: "100%", height: "100%" },
    durationsRow: { flexDirection: "row", gap: 8 },
    durationBtn: { flex: 1, borderRadius: 14, borderWidth: 1.5, borderColor: themeColors.border, paddingVertical: 12, alignItems: "center", gap: 4, backgroundColor: themeColors.surface },
    durationBtnOn: { borderColor: "#22A652", backgroundColor: themeColors.isDark ? "rgba(34,166,82,0.18)" : "#ecfdf3" },
    durationDays: { fontSize: 13, fontWeight: "900", color: themeColors.textMuted },
    durationDaysOn: { color: "#15803D" },
    durationPrice: { fontSize: 12.5, fontWeight: "900", color: "#22A652" },
    checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: themeColors.textSubtle, alignItems: "center", justifyContent: "center", backgroundColor: themeColors.surface, marginTop: 1 },
    checkboxOn: { backgroundColor: "#22A652", borderColor: "#22A652" },
    checkMark: { color: "white", fontSize: 14, fontWeight: "900", lineHeight: 16 },
    checkLabel: { flex: 1, fontSize: 12, lineHeight: 19, color: themeColors.text, fontWeight: "600" },
    primaryBtn: { borderRadius: 999, paddingVertical: 13, alignItems: "center", backgroundColor: "#22A652" },
    primaryBtnText: { color: "white", fontSize: 14, fontWeight: "900", textAlign: "center" },
    btnDisabled: { opacity: 0.5 },
    whatsBtn: { borderRadius: 999, paddingVertical: 12, alignItems: "center", backgroundColor: "#25D366" },
    whatsBtnText: { color: "white", fontSize: 14, fontWeight: "900" },
    row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
    rowKey: { fontSize: 12.5, color: themeColors.textSubtle, fontWeight: "700" },
    rowVal: { fontSize: 12.5, color: themeColors.text, fontWeight: "800", flexShrink: 1, textAlign: "right" },
    rowValStrong: { color: "#22A652", fontSize: 16 },
    okTitle: { fontSize: 14.5, fontWeight: "900", color: "#15803D" },
    badTitle: { fontSize: 14.5, fontWeight: "900", color: "#DC2626" },
    orderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 6 },
    orderText: { flex: 1, fontSize: 12.5, fontWeight: "700", color: themeColors.textMuted },
    linkBtn: { alignItems: "center", paddingVertical: 6 },
    link: { color: "#22A652", fontWeight: "800", textDecorationLine: "underline", fontSize: 13 },
    dangerLink: { color: "#DC2626", fontWeight: "800", textDecorationLine: "underline", fontSize: 13 },
  });
}
