import { useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, useWindowDimensions } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage } from "../../lib/hooks/useLanguage";
import { useThemeColors } from "../../lib/hooks/useThemeColors";
import { useCompany } from "../../lib/hooks/useCompanies";
import { companyCategoryLabel, companyUsesPropertyPhotos, companyWhatsappNumber } from "../../lib/companies";
import { cldOptimized } from "../../lib/cloudinary";
import { openExternalUrl } from "../../lib/linking";
import { ImageViewerModal } from "../../components/shared/ImageViewerModal";
import { createCompanyStyles, SERVICES_GREEN_LIGHT } from "../../components/companies/companyStyles";
import { FeaturedAdsStrip } from "../../components/featured/FeaturedAdsStrip";
import { CompanyScreenHeader } from "../../components/companies/CompanyScreenHeader";

// ↔ صفحة تفاصيل شركة (للجميع): الصورة والاسم والنشاط + عن الشركة + العنوان + الهاتف (اتصال/واتساب) + معرض الصور.
//   الهاتف والمعرض يأتيان من الخادم (get_company) فقط لو الميزة سارية (فترة مجانية أو اشتراك) — لا إخفاء بالواجهة وحدها.
export default function CompanyDetailsScreen() {
  const { id: raw } = useLocalSearchParams<{ id?: string }>();
  const id = Array.isArray(raw) ? raw[0] : raw;
  const { t } = useLanguage();
  const colors = useThemeColors();
  const styles = createCompanyStyles(colors);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { data: c, isLoading, isError, refetch } = useCompany(id);
  const [viewer, setViewer] = useState<number | null>(null);

  const contentW = Math.min(width, 760) - 32;
  const thumb = (contentW - 32 - 16) / 3;

  const addressLine = c
    ? [
        [c.province, c.region].filter(Boolean).join(" - "),
        c.buildingNo ? `${t("مبنى")} ${c.buildingNo}` : "",
        c.floorNo ? `${t("دور")} ${c.floorNo}` : "",
        c.unitNo ? `${t("وحدة")} ${c.unitNo}` : "",
      ].filter(Boolean).join("، ")
    : "";

  const phones = c ? [c.phone, c.phone2].filter((p): p is string => !!p) : [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <CompanyScreenHeader title={c?.name ?? t("تفاصيل الشركة")} color={colors.text} styles={styles} fallback="/(tabs)/menu" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40, alignSelf: "center", width: "100%", maxWidth: 760 }]} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <ActivityIndicator color={SERVICES_GREEN_LIGHT} style={{ marginTop: 40 }} />
        ) : isError ? (
          <View style={styles.card}>
            <Text style={styles.paragraph}>{t("تعذر تحميل بيانات الشركة.")}</Text>
            <Pressable style={styles.outlineBtn} onPress={() => void refetch()}><Text style={styles.outlineBtnText}>{t("إعادة المحاولة")}</Text></Pressable>
          </View>
        ) : !c ? (
          <View style={styles.card}><Text style={styles.paragraph}>{t("هذه الشركة غير متاحة.")}</Text></View>
        ) : (
          <>
            {c.status !== "approved" && (
              <View style={[styles.card, styles.warnCard]}>
                <Text style={styles.warnTitle}>{t("معاينة")}</Text>
                <Text style={styles.paragraph}>{t("هذه الشركة غير ظاهرة للجمهور حاليًا (بانتظار اعتماد الإدارة أو مخفية).")}</Text>
              </View>
            )}

            <View style={[styles.card, { alignItems: "center", gap: 8 }]}>
              <Image source={{ uri: cldOptimized(c.logoUrl, "w_700,q_auto,f_auto") }} style={{ width: "100%", aspectRatio: 1.6, borderRadius: 14, backgroundColor: colors.surface }} contentFit="cover" />
              <Text style={[styles.sectionTitle, { fontSize: 19, textAlign: "center" }]}>{c.name}</Text>
              <View style={[styles.chip, styles.chipOn]}><Text style={[styles.chipText, styles.chipTextOn]}>{t(companyCategoryLabel(c.category))}</Text></View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("عن الشركة")}</Text>
              <Text style={styles.paragraph}>{c.description}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("العنوان")}</Text>
              <Text style={styles.paragraph}>📍 {addressLine}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("التواصل")}</Text>
              {c.phoneVisible && phones.length > 0 ? (
                phones.map((p) => (
                  <View key={p} style={{ gap: 8 }}>
                    <Text style={[styles.paragraph, { fontWeight: "800", textAlign: "left" }]} selectable>{p}</Text>
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <Pressable style={styles.callBtn} onPress={() => openExternalUrl(`tel:${p.replace(/[^\d+]/g, "")}`, t("تعذر فتح تطبيق الاتصال"))} accessibilityRole="button">
                        <Text style={styles.actionBtnText}>📞 {t("اتصال")}</Text>
                      </Pressable>
                      <Pressable style={styles.whatsBtn} onPress={() => openExternalUrl(`https://wa.me/${companyWhatsappNumber(p)}`, t("تعذر فتح واتساب"))} accessibilityRole="button">
                        <Text style={styles.actionBtnText}>{t("واتساب")}</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.small}>{t("بيانات التواصل غير متاحة حاليًا.")}</Text>
              )}
            </View>

            {c.photosVisible && c.images.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{companyUsesPropertyPhotos(c.category) ? t("معرض العقارات والمشروعات") : t("معرض الأعمال")}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {c.images.map((img, i) => (
                    <Pressable key={img.id || img.url} onPress={() => setViewer(i)} accessibilityRole="button" accessibilityLabel={`${t("صورة")} ${i + 1}`}>
                      <Image source={{ uri: cldOptimized(img.url, "w_400,q_auto,f_auto") }} style={{ width: thumb, height: thumb, borderRadius: 12, backgroundColor: colors.surface }} contentFit="cover" />
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {/* ↔ «إعلانات مميزة» فى نهاية صفحة الشركة (أسفل البيانات والصور وأرقام الهاتف). */}
            <FeaturedAdsStrip style={{ paddingHorizontal: 0 }} />

            <ImageViewerModal
              images={c.images.map((i) => cldOptimized(i.url, "w_1400,q_auto,f_auto"))}
              initialIndex={viewer ?? 0}
              visible={viewer !== null}
              onClose={() => setViewer(null)}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}
