import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, Alert } from "react-native";
import { router, type Href } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoid } from "../components/shared/KeyboardAvoid";
import { useLanguage } from "../lib/hooks/useLanguage";
import { useThemeColors } from "../lib/hooks/useThemeColors";
import { useCurrentUser } from "../lib/hooks/useCurrentUser";
import { useLogMedia } from "../lib/hooks/useMedia";
import {
  DEFAULT_COMPANY_SETTINGS, useCompanySettings, useMyCompany, useSaveMyCompany, type CompanyFormValues,
} from "../lib/hooks/useCompanies";
import { COMPANY_CATEGORIES, companyUsesPropertyPhotos, isCompanyCategory, isValidCompanyPhone } from "../lib/companies";
import { PROVINCES, regionsForProvince } from "../data/locations";
import { uploadToCloudinary, cldOptimized, isVideoUrl, VIDEO_AS_IMAGE_MESSAGE, CloudinaryUploadError } from "../lib/cloudinary";
import { showToast } from "../components/shared/Toast";
import { createCompanyStyles, SERVICES_GREEN_LIGHT } from "../components/companies/companyStyles";
import { CompanyScreenHeader } from "../components/companies/CompanyScreenHeader";
import { OptionPickerModal } from "../components/companies/OptionPickerModal";

// ↔ نموذج تسجيل/تعديل شركة فى قسم «الخدمات». نفس الشاشة للإضافة (لا توجد شركة بعد) والتعديل (من «إدارة شركتى»).
//   إجبارى: الصورة/الشعار، الاسم، النشاط، الوصف، المحافظة، المنطقة، اسم المسؤول، الهاتف الأساسى. اختيارى: هاتف آخر، المبنى/الدور/الوحدة،
//   البطاقة الضريبية، السجل التجارى، صور الأعمال (حتى 6). الرفع على Cloudinary (يُضغط بالجودة 0.8 قبل الرفع + q_auto عند العرض).
//   الحفظ عبر save_my_company (الخادم يتحقق من كل شيء ومن أن الحساب حقيقى لا زائر).
const EMPTY: CompanyFormValues = {
  category: "", name: "", description: "", logoUrl: "", province: "", region: "", managerName: "", phone: "", phone2: "",
  buildingNo: "", floorNo: "", unitNo: "", taxCardNo: "", commercialRegisterNo: "", images: [],
};

export default function CompanyFormScreen() {
  const { t } = useLanguage();
  const colors = useThemeColors();
  const styles = createCompanyStyles(colors);
  const insets = useSafeAreaInsets();
  const { user, loading: authLoading } = useCurrentUser();
  const isGuest = !user || !!user.is_anonymous;
  const { data: mine, isLoading } = useMyCompany(isGuest ? undefined : user?.id);
  const { settings: pubSettings } = useCompanySettings();
  const settings = mine?.settings ?? pubSettings ?? DEFAULT_COMPANY_SETTINGS;
  const save = useSaveMyCompany();
  const logMedia = useLogMedia();

  const [v, setV] = useState<CompanyFormValues>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [picker, setPicker] = useState<null | "category" | "province" | "region">(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const editing = !!mine;

  useEffect(() => {
    if (hydrated || isLoading) return;
    if (mine) {
      setV({
        category: mine.category, name: mine.name, description: mine.description, logoUrl: mine.logoUrl, province: mine.province,
        region: mine.region, managerName: mine.managerName, phone: mine.phone, phone2: mine.phone2 ?? "",
        buildingNo: mine.buildingNo ?? "", floorNo: mine.floorNo ?? "", unitNo: mine.unitNo ?? "", taxCardNo: mine.taxCardNo ?? "",
        commercialRegisterNo: mine.commercialRegisterNo ?? "", images: mine.images.map((i) => i.url),
      });
    }
    setHydrated(true);
  }, [mine, isLoading, hydrated]);

  const set = <K extends keyof CompanyFormValues>(k: K, val: CompanyFormValues[K]) => setV((p) => ({ ...p, [k]: val }));

  const regionList = useMemo(() => regionsForProvince(v.province), [v.province]);
  const maxPhotos = settings.maxPhotos;
  // الصور الجديدة تتطلب ميزة الصور سارية (الشركة المعتمدة بعد انتهاء الفترة المجانية بلا اشتراك لا تستطيع إضافة صور؛ الحذف مسموح).
  const canAddPhotos = !mine || mine.approvedAt === null || mine.photosActive;

  const errors = {
    logo: !v.logoUrl,
    name: v.name.trim().length < 2,
    category: !isCompanyCategory(v.category),
    description: v.description.trim().length < 10,
    province: !v.province,
    region: !v.region.trim(),
    manager: v.managerName.trim().length < 2,
    phone: !isValidCompanyPhone(v.phone),
    phone2: !!v.phone2.trim() && !isValidCompanyPhone(v.phone2),
  };
  const hasErrors = Object.values(errors).some(Boolean);

  async function pickImages(opts: { multiple: boolean }): Promise<string[]> {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: !opts.multiple,
      aspect: opts.multiple ? undefined : [16, 10],
      allowsMultipleSelection: opts.multiple,
      selectionLimit: opts.multiple ? Math.max(1, maxPhotos - v.images.length) : 1,
      quality: 0.8, // ضغط قبل الرفع (Cloudinary يضغط/يحسّن أيضًا عند العرض q_auto,f_auto)
    });
    if (result.canceled) return [];
    const uris: string[] = [];
    for (const asset of result.assets) {
      if (asset.type === "video" || asset.mimeType?.startsWith("video/") || isVideoUrl(asset.uri)) {
        Alert.alert(t("اختر صورة"), VIDEO_AS_IMAGE_MESSAGE);
        continue;
      }
      uris.push(asset.uri);
    }
    return uris;
  }

  async function uploadAll(uris: string[]): Promise<string[]> {
    const urls: string[] = [];
    for (const uri of uris) {
      const up = await uploadToCloudinary(uri, "image");
      if (user?.id) logMedia.mutate({ ownerId: user.id, type: "image", context: "other", result: up });
      urls.push(up.url);
    }
    return urls;
  }

  async function onPickLogo() {
    if (uploadingLogo) return;
    const uris = await pickImages({ multiple: false });
    if (!uris.length) return;
    setUploadingLogo(true);
    try {
      const [url] = await uploadAll(uris);
      if (url) set("logoUrl", url);
    } catch (e) {
      Alert.alert(t("تعذر رفع الصورة"), e instanceof CloudinaryUploadError ? e.message : t("حاول مرة أخرى."));
    } finally {
      setUploadingLogo(false);
    }
  }

  async function onPickPhotos() {
    if (uploadingPhotos) return;
    if (v.images.length >= maxPhotos) {
      showToast(`${t("الحد الأقصى")} ${maxPhotos} ${t("صور")}`);
      return;
    }
    const uris = await pickImages({ multiple: true });
    if (!uris.length) return;
    setUploadingPhotos(true);
    try {
      const urls = await uploadAll(uris.slice(0, maxPhotos - v.images.length));
      setV((p) => ({ ...p, images: [...p.images, ...urls].slice(0, maxPhotos) }));
    } catch (e) {
      Alert.alert(t("تعذر رفع الصورة"), e instanceof CloudinaryUploadError ? e.message : t("حاول مرة أخرى."));
    } finally {
      setUploadingPhotos(false);
    }
  }

  function onSubmit() {
    if (save.isPending || uploadingLogo || uploadingPhotos) return;
    setShowErrors(true);
    if (hasErrors) {
      showToast(t("أكمل الحقول الإجبارية المميّزة بعلامة *"));
      return;
    }
    save.mutate(
      { ...v, includeImages: true },
      {
        onSuccess: () => {
          showToast(editing ? t("تم حفظ بيانات الشركة") : t("تم إرسال شركتك للمراجعة"));
          router.replace("/my-company" as Href);
        },
        onError: (err) => {
          const code = err instanceof Error ? err.message : "";
          if (code === "photos_inactive") showToast(t("ميزة صور الأعمال غير مفعّلة — فعّل الاشتراك لإضافة صور جديدة"));
          else if (code === "too_many_images") showToast(`${t("الحد الأقصى")} ${maxPhotos} ${t("صور")}`);
          else if (code === "not_authenticated") showToast(t("سجّل الدخول بحسابك أولًا"));
          else if (code.startsWith("bad_")) showToast(t("راجع البيانات المدخلة وحاول مرة أخرى"));
          else showToast(t("تعذر حفظ بيانات الشركة، حاول مرة أخرى"));
        },
      }
    );
  }

  const Label = ({ text, required }: { text: string; required?: boolean }) => (
    <Text style={styles.label}>{text}{required ? <Text style={styles.required}> *</Text> : null}</Text>
  );

  return (
    <KeyboardAvoid style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <CompanyScreenHeader title={editing ? t("تعديل بيانات الشركة") : t("أضف شركتك")} color={colors.text} styles={styles} fallback="/(tabs)/menu" />
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40, alignSelf: "center", width: "100%", maxWidth: 760 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {authLoading || (!isGuest && isLoading) ? (
            <ActivityIndicator color={SERVICES_GREEN_LIGHT} style={{ marginTop: 40 }} />
          ) : isGuest ? (
            <View style={styles.card}>
              <Text style={styles.paragraph}>{t("إضافة شركة تتطلب حسابًا موثّقًا (Google أو بريد إلكتروني) وليس زائرًا. سجّل الدخول ثم أعد المحاولة.")}</Text>
              <Pressable style={styles.primaryBtn} onPress={() => router.replace("/" as Href)}>
                <Text style={styles.primaryBtnText}>{t("تسجيل الدخول")}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {mine?.status === "rejected" && (
                <View style={[styles.card, styles.badCard]}>
                  <Text style={styles.badTitle}>{t("تم رفض تسجيل الشركة")}</Text>
                  {!!mine.rejectReason && <Text style={styles.paragraph}>{mine.rejectReason}</Text>}
                  <Text style={styles.small}>{t("عدّل البيانات ثم احفظ لإعادة إرسالها للمراجعة.")}</Text>
                </View>
              )}

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("البيانات الأساسية")}</Text>

                <Label text={t("صورة / شعار الشركة")} required />
                <Pressable
                  style={[styles.select, { height: 170, justifyContent: "center", borderStyle: "dashed", borderWidth: 1.5 }, showErrors && errors.logo && styles.inputError]}
                  onPress={onPickLogo}
                  disabled={uploadingLogo}
                  accessibilityRole="button"
                >
                  {uploadingLogo ? (
                    <ActivityIndicator color={SERVICES_GREEN_LIGHT} />
                  ) : v.logoUrl ? (
                    <Image source={{ uri: cldOptimized(v.logoUrl, "w_700,q_auto,f_auto") }} style={{ width: "100%", height: "100%", borderRadius: 10 }} contentFit="cover" />
                  ) : (
                    <Text style={[styles.selectText, styles.selectPlaceholder, { textAlign: "center" }]}>{t("اضغط لاختيار صورة أو شعار الشركة")}</Text>
                  )}
                </Pressable>
                {!!v.logoUrl && <Text style={styles.small}>{t("اضغط على الصورة لتغييرها — الصورة القديمة تُحذف تلقائيًا من التخزين.")}</Text>}

                <Label text={t("اسم الشركة")} required />
                <TextInput style={[styles.input, showErrors && errors.name && styles.inputError]} value={v.name} onChangeText={(x) => set("name", x)} placeholder={t("اسم الشركة")} placeholderTextColor={colors.textSubtle} maxLength={120} />

                <Label text={t("نشاط الشركة")} required />
                <Pressable style={[styles.select, showErrors && errors.category && styles.inputError]} onPress={() => setPicker("category")} accessibilityRole="button">
                  <Text style={[styles.selectText, !v.category && styles.selectPlaceholder]} numberOfLines={2}>
                    {v.category ? t(COMPANY_CATEGORIES.find((c) => c.key === v.category)?.label ?? "") : t("اختر نشاط الشركة")}
                  </Text>
                  <Text style={styles.small}>▾</Text>
                </Pressable>
                <Text style={styles.small}>{t("تظهر شركتك تلقائيًا داخل القسم المطابق لنشاطها.")}</Text>

                <Label text={t("وصف الشركة (عن الشركة)")} required />
                <TextInput style={[styles.input, styles.inputMulti, showErrors && errors.description && styles.inputError]} value={v.description} onChangeText={(x) => set("description", x)} placeholder={t("اكتب نبذة عن الشركة وخدماتها (10 أحرف على الأقل)")} placeholderTextColor={colors.textSubtle} multiline maxLength={2000} />
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("العنوان")}</Text>
                <Label text={t("المحافظة")} required />
                <Pressable style={[styles.select, showErrors && errors.province && styles.inputError]} onPress={() => setPicker("province")} accessibilityRole="button">
                  <Text style={[styles.selectText, !v.province && styles.selectPlaceholder]}>{v.province ? t(v.province) : t("اختر المحافظة")}</Text>
                  <Text style={styles.small}>▾</Text>
                </Pressable>

                <Label text={t("المنطقة")} required />
                {regionList.length > 0 ? (
                  <Pressable style={[styles.select, showErrors && errors.region && styles.inputError]} onPress={() => setPicker("region")} accessibilityRole="button">
                    <Text style={[styles.selectText, !v.region && styles.selectPlaceholder]}>{v.region ? t(v.region) : t("اختر المنطقة")}</Text>
                    <Text style={styles.small}>▾</Text>
                  </Pressable>
                ) : (
                  <TextInput style={[styles.input, showErrors && errors.region && styles.inputError]} value={v.region} onChangeText={(x) => set("region", x)} placeholder={v.province ? t("اكتب اسم المنطقة") : t("اختر المحافظة أولًا")} placeholderTextColor={colors.textSubtle} maxLength={120} editable={!!v.province} />
                )}

                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Label text={t("رقم المبنى")} />
                    <TextInput style={styles.input} value={v.buildingNo} onChangeText={(x) => set("buildingNo", x)} maxLength={30} placeholderTextColor={colors.textSubtle} />
                  </View>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Label text={t("رقم الدور")} />
                    <TextInput style={styles.input} value={v.floorNo} onChangeText={(x) => set("floorNo", x)} maxLength={30} placeholderTextColor={colors.textSubtle} />
                  </View>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Label text={t("رقم الوحدة")} />
                    <TextInput style={styles.input} value={v.unitNo} onChangeText={(x) => set("unitNo", x)} maxLength={30} placeholderTextColor={colors.textSubtle} />
                  </View>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("بيانات التواصل والمسؤول")}</Text>
                <Label text={t("اسم المسؤول")} required />
                <TextInput style={[styles.input, showErrors && errors.manager && styles.inputError]} value={v.managerName} onChangeText={(x) => set("managerName", x)} placeholder={t("اسم المسؤول")} placeholderTextColor={colors.textSubtle} maxLength={120} />
                <Text style={styles.small}>{t("اسم المسؤول للإدارة فقط ولا يظهر للزوار.")}</Text>

                <Label text={t("رقم الهاتف الأساسي")} required />
                <TextInput style={[styles.input, showErrors && errors.phone && styles.inputError]} value={v.phone} onChangeText={(x) => set("phone", x)} placeholder="01XXXXXXXXX" placeholderTextColor={colors.textSubtle} keyboardType="phone-pad" maxLength={30} />

                <Label text={t("رقم هاتف آخر")} />
                <TextInput style={[styles.input, showErrors && errors.phone2 && styles.inputError]} value={v.phone2} onChangeText={(x) => set("phone2", x)} placeholder="01XXXXXXXXX" placeholderTextColor={colors.textSubtle} keyboardType="phone-pad" maxLength={30} />
                <Text style={styles.small}>{t("يظهر رقم الهاتف للزوار خلال الفترة المجانية ثم بالاشتراك الشهري (راجع «إدارة شركتي»).")}</Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("بيانات رسمية (اختيارية)")}</Text>
                <Label text={t("رقم البطاقة الضريبية")} />
                <TextInput style={styles.input} value={v.taxCardNo} onChangeText={(x) => set("taxCardNo", x)} maxLength={60} placeholderTextColor={colors.textSubtle} />
                <Label text={t("رقم السجل التجاري")} />
                <TextInput style={styles.input} value={v.commercialRegisterNo} onChangeText={(x) => set("commercialRegisterNo", x)} maxLength={60} placeholderTextColor={colors.textSubtle} />
                <Text style={styles.small}>{t("هذه البيانات للإدارة فقط ولا تظهر للزوار.")}</Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>
                  {companyUsesPropertyPhotos(v.category || undefined) ? t("صور العقارات / الشقق / الكمبوندات (اختيارية)") : t("صور الأعمال السابقة أو الحالية (اختيارية)")}
                </Text>
                <Text style={styles.small}>{t("حتى")} {maxPhotos} {t("صور لكل شركة.")} {v.images.length}/{maxPhotos}</Text>
                {!canAddPhotos && (
                  <View style={[styles.card, styles.warnCard]}>
                    <Text style={styles.paragraph}>{t("ميزة معرض الصور غير مفعّلة حاليًا لشركتك (انتهت الفترة المجانية). فعّل الاشتراك من «إدارة شركتي» لإضافة صور جديدة؛ ويمكنك حذف الصور الحالية.")}</Text>
                  </View>
                )}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {v.images.map((url) => (
                    <View key={url} style={{ width: 96, height: 96 }}>
                      <Image source={{ uri: cldOptimized(url, "w_300,q_auto,f_auto") }} style={{ width: 96, height: 96, borderRadius: 12, backgroundColor: colors.surface }} contentFit="cover" />
                      <Pressable
                        style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: "#DC2626", alignItems: "center", justifyContent: "center" }}
                        onPress={() => setV((p) => ({ ...p, images: p.images.filter((u) => u !== url) }))}
                        accessibilityRole="button"
                        accessibilityLabel={t("حذف الصورة")}
                        hitSlop={6}
                      >
                        <Text style={{ color: "white", fontWeight: "900", fontSize: 13 }}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                  {v.images.length < maxPhotos && canAddPhotos && (
                    <Pressable
                      style={{ width: 96, height: 96, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}
                      onPress={onPickPhotos}
                      disabled={uploadingPhotos}
                      accessibilityRole="button"
                      accessibilityLabel={t("إضافة صور")}
                    >
                      {uploadingPhotos ? <ActivityIndicator color={SERVICES_GREEN_LIGHT} /> : <Text style={{ fontSize: 30, color: SERVICES_GREEN_LIGHT, fontWeight: "900" }}>+</Text>}
                    </Pressable>
                  )}
                </View>
              </View>

              <Pressable style={[styles.primaryBtn, (save.isPending || uploadingLogo || uploadingPhotos) && styles.btnDisabled]} onPress={onSubmit} disabled={save.isPending}>
                {save.isPending ? <ActivityIndicator color="white" size="small" /> : (
                  <Text style={styles.primaryBtnText}>{editing ? t("حفظ التعديلات") : t("إرسال الشركة للمراجعة")}</Text>
                )}
              </Pressable>
              {!editing && <Text style={styles.small}>{t("تُراجع شركتك من الإدارة قبل ظهورها للجمهور، وتبدأ الفترة المجانية (شهران) من تاريخ الموافقة.")}</Text>}

              <Pressable style={styles.linkBtn} onPress={() => router.push("/policy/terms" as Href)}>
                <Text style={styles.link}>{t("الشروط والأحكام")}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>

        <OptionPickerModal
          visible={picker === "category"}
          title={t("اختر نشاط الشركة")}
          options={COMPANY_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
          selected={v.category}
          onSelect={(x) => set("category", x as CompanyFormValues["category"])}
          onClose={() => setPicker(null)}
          renderLabel={t}
        />
        <OptionPickerModal
          visible={picker === "province"}
          title={t("اختر المحافظة")}
          options={PROVINCES.map((p) => ({ value: p, label: p }))}
          selected={v.province}
          onSelect={(x) => setV((p) => ({ ...p, province: x, region: x === p.province ? p.region : "" }))}
          onClose={() => setPicker(null)}
          renderLabel={t}
        />
        <OptionPickerModal
          visible={picker === "region"}
          title={t("اختر المنطقة")}
          options={regionList.map((r) => ({ value: r, label: r }))}
          selected={v.region}
          onSelect={(x) => set("region", x)}
          onClose={() => setPicker(null)}
          renderLabel={t}
        />
      </View>
    </KeyboardAvoid>
  );
}
