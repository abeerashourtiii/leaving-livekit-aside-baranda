import { useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { Property } from "../../lib/types";
import { useSellerContentSettings } from "../../lib/hooks/useContentSettings";
import { useSellerContactPhone } from "../../lib/hooks/useProperties";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors } from "../../lib/hooks/useThemeColors";
import { supabase } from "../../lib/supabase";
import { openExternalUrl } from "../../lib/linking";
import { phoneToWaMeDigits } from "../../lib/phone";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useSubmitPropertyOffer, offerErrorCode } from "../../lib/hooks/usePropertyOffers";
import { MakeOfferModal } from "../requests/MakeOfferModal";
import { promptGuestLogin } from "../../lib/guestGate";
import { showToast } from "../shared/Toast";

// ↔ استخرجت من app/property/[id].tsx — نفس المنطق بالضبط، لكن رقم
// الهاتف بقى بييجي من useSellerContactPhone (الدالة الآمنة الجديدة)
// بدل property.seller.phone اللي بقى فاضي دايمًا دلوقتي (شوف الكومنت
// فوق SELECT_DETAIL فى lib/hooks/useProperties.ts).
// ↔ safeBottom: حافة الأمان السفلية (insets.bottom). صفحة تفاصيل العقار الكاملة
// بتمرّرها عشان الشريط يقف فوق شريط تنقّل النظام (أندرويد/آيفون/APK). لوحة
// الريل (ReelCard) مش بتمرّرها لأنها بتحسب مساحة الشريط العائم بنفسها.
// ↔ زر الشات اتلغى من هنا: المحادثة بخصوص إعلان بقت من خلال التعليقات والردود على الريل (أيقونة التعليقات فى الشريط الجانبى).
//   showCommentsShortcut: فى صفحة التفاصيل الكاملة (اللى مفيهاش ريل ولا أيقونة تعليقات) بنعرض زر «التعليقات» بدل الشات عشان
//   يفضل فيه طريق للمحادثة؛ بيفتح الريل ولوحة التعليقات مفتوحة. فى لوحة الريل نفسها مش بنعرضه (الأيقونة الجانبية موجودة).
export function PropertyCtaBar({ property, safeBottom = 0, showCommentsShortcut = false }: { property: Property; safeBottom?: number; showCommentsShortcut?: boolean }) {
  const { t } = useLanguage();
  const { data: sellerSettings } = useSellerContentSettings(property.seller.id);
  const { data: contactPhone } = useSellerContactPhone(property.id);
  const themeColors = useThemeColors();
  const { user } = useCurrentUser();
  const submitOffer = useSubmitPropertyOffer();
  const [offerOpen, setOfferOpen] = useState(false);

  // ↔ تقديم عرض (أيقونة بجوار زر الاتصال): مش بيظهر على إعلانك أنت، ولا على إعلان اتقفل بصفقة، ولا على الإعلانات التجريبية (id مش UUID).
  const isReal = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(property.id);
  const showOffer = isReal && !property.closedType && property.seller.id !== user?.id;

  function openOffer() {
    if (!user || user.is_anonymous) return promptGuestLogin("generic");
    setOfferOpen(true);
  }

  function handleSubmitOffer(message: string, price: string, whatsapp: string) {
    const num = price ? Number(price) : null;
    submitOffer.mutate(
      { targetId: property.id, price: num && Number.isFinite(num) && num > 0 ? num : null, message, whatsapp },
      {
        // ↔ العرض بيفتح محادثة مع صاحب الإعلان (صفحة «العروض») — بنفتحها عشان يكمّل المحادثة من هناك.
        onSuccess: ({ chatId }) => {
          setOfferOpen(false);
          showToast(t("تم إرسال عرضك لصاحب الإعلان"));
          if (chatId) router.push(`/chat/${chatId}`);
        },
        onError: (err) => {
          const code = offerErrorCode(err);
          if (code === "rate_limited") showToast(t("قدّمت عروضًا كثيرة، انتظر قليلًا ثم حاول مرة أخرى"));
          else if (code === "property_unavailable") { setOfferOpen(false); showToast(t("هذا الإعلان لم يعد متاحًا")); }
          else if (code === "own_property") showToast(t("لا يمكنك تقديم عرض على إعلانك الخاص"));
          else if (code === "bad_price") showToast(t("السعر المقترح غير صحيح"));
          else showToast(t("تعذر إرسال العرض، حاول مرة أخرى"));
        },
      }
    );
  }

  function openWhatsapp() {
    if (!contactPhone) return;
    openExternalUrl(
      `https://wa.me/${phoneToWaMeDigits(contactPhone)}?text=${encodeURIComponent(`مهتم بعقارك: ${property.title}`)}`,
      t("تعذر فتح واتساب")
    );
    // Fire-and-forget: feeds the admin dashboard's "تحويلات واتساب" stat.
    supabase.rpc("increment_wa_clicks", { property_id: property.id }).then(({ error }) => {
      if (error) console.warn("Failed to record WhatsApp click:", error);
    });
  }

  const showWhatsapp = (sellerSettings?.showWhatsapp ?? true) && !!contactPhone;
  const showCall = (sellerSettings?.showCallButton ?? true) && !!contactPhone;
  // مفيش أزرار => مفيش شريط فاضى بحدود وحشو.
  if (!showCommentsShortcut && !showWhatsapp && !showCall && !showOffer) return null;

  return (
    <View style={[styles.ctaBar, { backgroundColor: themeColors.card, borderTopColor: themeColors.border }, safeBottom > 0 ? { paddingBottom: Math.max(28, safeBottom + 14) } : null]}>
      {showCommentsShortcut && (
        <Pressable
          style={styles.chatBtn}
          onPress={() => router.push(`/property/${property.id}/reel?comments=1`)}
          accessibilityRole="button"
          accessibilityLabel={t("التعليقات")}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#22A652" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z" />
          </Svg>
        </Pressable>
      )}
      {/* ↔ أيقونة الواتساب بقت جنب أيقونة الشات مباشرة (بدل زرار عريض
          منفصل بنص "تواصل عبر واتساب")، بنفس حجم وشكل زرار الشات — لسه
          بتتفعّل/تتخفي بنفس شرط الإعدادات (showWhatsapp) زي الأول. */}
      {showWhatsapp && (
        <Pressable style={styles.whatsappIconBtn} onPress={openWhatsapp}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="white">
            <Path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.39 1.26 4.81L2.05 22l5.42-1.32a9.85 9.85 0 004.57 1.14h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.8 14.13c-.24.68-1.4 1.3-1.93 1.35-.5.05-1.13.07-1.82-.12a17.7 17.7 0 01-1.67-.61c-2.93-1.26-4.85-4.2-5-4.4-.15-.2-1.2-1.6-1.2-3.05s.76-2.16 1.03-2.46c.27-.3.6-.37.8-.37h.57c.19 0 .43-.03.66.51.24.55.83 1.9.9 2.05.07.14.12.31.02.5-.1.2-.15.31-.3.48l-.42.5c-.15.14-.3.3-.13.6.17.3.75 1.24 1.6 2 1.1.98 2.03 1.29 2.32 1.44.3.15.47.13.65-.07.17-.2.73-.85.93-1.14.2-.3.4-.24.66-.14.27.1 1.7.8 1.99.95.3.14.49.21.56.33.07.13.07.72-.17 1.4z" />
          </Svg>
        </Pressable>
      )}
      {showCall && (
        <Pressable style={styles.chatBtn} onPress={() => openExternalUrl(`tel:${contactPhone}`, t("تعذر إجراء الاتصال"))}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#22A652" strokeWidth={2}>
            <Path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3.1-8.7A2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .3 2 .7 3a2 2 0 01-.5 2.1L7.9 10.3a16 16 0 006 6l1.5-1.4a2 2 0 012.1-.5c1 .4 2 .6 3 .7a2 2 0 011.7 2z" />
          </Svg>
        </Pressable>
      )}
      {/* ↔ تقديم عرض: أيقونة (علامة سعر) بجوار زر الاتصال، شبيهة بـ«تقديم عرض» فى صفحة الطلبات (نفس النافذة MakeOfferModal). */}
      {showOffer && (
        <Pressable style={styles.chatBtn} onPress={openOffer} accessibilityRole="button" accessibilityLabel={t("تقديم عرض")}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#22A652" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z" />
            <Path d="M7.5 7.5h.01" />
          </Svg>
        </Pressable>
      )}
      <MakeOfferModal visible={offerOpen} property={property} onClose={() => setOfferOpen(false)} onSubmit={handleSubmitOffer} submitting={submitOffer.isPending} />
    </View>
  );
}

const styles = StyleSheet.create({
  ctaBar: {
    flexDirection: "row", gap: 10, padding: 14, paddingBottom: 28,
    borderTopWidth: 1,
  },
  chatBtn: { width: 48, height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: "#22A652", alignItems: "center", justifyContent: "center" },
  whatsappIconBtn: { width: 48, height: 48, borderRadius: 14, backgroundColor: "#25D366", alignItems: "center", justifyContent: "center" },
});
