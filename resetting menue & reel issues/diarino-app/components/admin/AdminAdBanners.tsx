import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, FlatList, Alert, Switch, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useAllAdBanners, useAdBannerMutations } from "../../lib/hooks/useAdBanners";
import { useAdCarouselSettings, useUpdateAdCarouselSettings } from "../../lib/hooks/useAdCarouselSettings";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useLogMedia } from "../../lib/hooks/useMedia";
import { uploadToCloudinary, cldOptimized, cldCrop, isVideoUrl, VIDEO_AS_IMAGE_MESSAGE } from "../../lib/cloudinary";
import { CascadeImage } from "../shared/CascadeImage";
import { ImageCropModal, CropRect } from "./ImageCropModal";
import { AD_BANNER_ASPECT, AD_BANNER_SPEC_TEXT, AD_BANNER_WIDTH, AD_BANNER_HEIGHT } from "../../lib/adBannerSpec";

// ↔ full control over the "مساحة إعلانية" card on the menu page: add a
// banner with a run duration (start/end date), delete it, or add several
// that auto-rotate (components/menu/AdBannerCarousel.tsx cycles through
// every banner returned by useActiveAdBanners()).
// ↔ مصغّرة إعلان فى القائمة: بسلسلة محاولات، ولو الصورة كلها ما اتحمّلتش (ملف فيديو اتخزّن بالغلط أو رابط
//   تالف) بتظهر علامة ⚠ بدل صندوق فاضى عشان الأدمن يعرف إنه لازم يحذف الإعلان ويرفعه من جديد.
function BannerThumb({ url, styles }: { url: string | null; styles: ReturnType<typeof createStyles> }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  if (!url) return <View style={[styles.bannerThumb, styles.bannerThumbEmpty]} />;
  return (
    <View>
      <CascadeImage
        url={url}
        width={240}
        style={styles.bannerThumb}
        onAllFailed={() => setFailed(true)}
        fallback={<View style={[styles.bannerThumb, styles.bannerThumbEmpty, styles.bannerThumbBroken]} />}
      />
      {failed && <Text style={styles.bannerThumbWarn}>⚠ صورة تالفة</Text>}
    </View>
  );
}

export function AdminAdBanners() {
  const { data: banners = [] } = useAllAdBanners();
  const { create, toggleActive, remove } = useAdBannerMutations();
  const { data: rotationSettings } = useAdCarouselSettings();
  const updateRotation = useUpdateAdCarouselSettings();
  const [durationInput, setDurationInput] = useState("4");
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { user } = useCurrentUser();
  const logMedia = useLogMedia();

  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageInfo, setImageInfo] = useState<string>("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [cropSourceMimeType, setCropSourceMimeType] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [days, setDays] = useState("7");

  useEffect(() => {
    if (rotationSettings) setDurationInput(String(Math.round(rotationSettings.durationMs / 1000)));
  }, [rotationSettings?.durationMs]);

  // ↔ ١) الاختيار من المعرض بدون واجهة القص الأصلية للنظام (اللى كان فيها زر "Crop")،
  //   ثم نافذة القص الخاصة بالتطبيق (ImageCropModal) بإطار ثابت بمقاس المساحة الإعلانية
  //   والموافقة بعلامة صح ✅.
  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    // ↔ بعض معارض أندرويد بتسمح باختيار فيديو حتى مع فلتر الصور — إعلان بفيديو كان بيتخزّن برابط .mp4
    //   وCloudinary بيرجّع 400 عند عرضه كصورة (صندوق أسود). نرفضه من الأول.
    if (asset.type === "video" || asset.mimeType?.startsWith("video/") || (!asset.mimeType && isVideoUrl(asset.uri))) {
      Alert.alert("اختر صورة", VIDEO_AS_IMAGE_MESSAGE);
      return;
    }
    setCropSourceMimeType(asset.mimeType ?? null);
    setCropSource(asset.uri);
  }

  // ↔ بعد ✅: بنرفع الأصل على Cloudinary (زي useAccount's pickAvatar بالظبط) ونخزّن رابط
  //   فيه تحويل c_crop بإحداثيات القص — فالقص بيتطبّق وقت العرض على كل المنصات.
  async function onCropConfirmed(rect: CropRect, natural: { width: number; height: number }) {
    const uri = cropSource;
    setCropSource(null);
    if (!uri) return;
    setUploadingImage(true);
    try {
      const up = await uploadToCloudinary(uri, "image", undefined, cropSourceMimeType);
      if (user?.id) logMedia.mutate({ ownerId: user.id, type: "image", context: "other", result: up });
      // أبعاد Cloudinary بعد تدوير EXIF؛ لو اتبدّل الطول/العرض مقارنة بما شفناه فى النافذة نبدّلهم.
      let sw = up.width ?? natural.width;
      let sh = up.height ?? natural.height;
      const viewAspect = natural.width / natural.height;
      if (Math.abs(sw / sh - viewAspect) > 0.05 && Math.abs(sh / sw - viewAspect) < 0.05) [sw, sh] = [sh, sw];
      const cropped = cldCrop(up.url, rect, sw, sh);
      // ↔ نتأكد إن الرابط المقصوص بيتحمّل فعلًا (Cloudinary ممكن يرفض تحويل القص لو الحساب فيه
      //   "Strict transformations")؛ لو فشل نخزّن الصورة الأصلية (بتتعرض cover من المركز) ونبلّغ الأدمن
      //   بدل ما يتحفظ إعلان صورته مش بتظهر.
      let finalUrl = cropped.url;
      let note = `الصورة بعد القص: ${cropped.width} × ${cropped.height} بكسل` + (cropped.width < AD_BANNER_WIDTH ? ` — أقل من المقاس المطلوب (${AD_BANNER_WIDTH} × ${AD_BANNER_HEIGHT}) وقد تظهر أقل حدّة` : " ✓ بجودة كافية");
      if (cropped.url !== up.url) {
        let loads = true;
        try { loads = await Image.prefetch(cldOptimized(cropped.url, "w_700,q_auto,f_auto")); } catch { loads = true; }
        if (!loads) {
          finalUrl = up.url;
          note = "⚠ تعذّر تطبيق القص على Cloudinary (غالبًا حسابك يمنع التحويلات المخصّصة — Strict transformations). حُفظت الصورة الأصلية بدون قص وستظهر مضبوطة من المركز؛ للحصول على الشكل المطلوب جهّز الصورة بمقاس " + `${AD_BANNER_WIDTH} × ${AD_BANNER_HEIGHT}` + " خارج التطبيق ثم ارفعها.";
        }
      }
      setImageUrl(finalUrl);
      setImageInfo(note);
    } catch (e) {
      Alert.alert("تعذر رفع الصورة", e instanceof Error && e.message === VIDEO_AS_IMAGE_MESSAGE ? VIDEO_AS_IMAGE_MESSAGE : "حاول مرة أخرى.");
    } finally {
      setUploadingImage(false);
    }
  }

  function addBanner() {
    if (!title.trim()) return;
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + (Number(days) || 7));
    create.mutate({
      title: title.trim(),
      imageUrl: imageUrl.trim() || undefined,
      linkUrl: linkUrl.trim() || undefined,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      sortOrder: banners.length,
    });
    setTitle(""); setImageUrl(""); setImageInfo(""); setLinkUrl(""); setDays("7");
  }

  return (
    <View style={{ gap: 14 }}>
      <ImageCropModal
        visible={!!cropSource}
        uri={cropSource}
        aspect={AD_BANNER_ASPECT}
        specText={AD_BANNER_SPEC_TEXT}
        onCancel={() => setCropSource(null)}
        onConfirm={onCropConfirmed}
      />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>طريقة عرض الإعلانات</Text>
        <View style={styles.durationRow}>
          <Pressable
            style={[styles.rotationBtn, rotationSettings?.rotationMode === "auto" && styles.rotationBtnActive]}
            onPress={() => updateRotation.mutate({ rotationMode: "auto" })}
          >
            <Text style={[styles.rotationBtnText, rotationSettings?.rotationMode === "auto" && styles.rotationBtnTextActive]}>تلقائي (ينتقل لليمين)</Text>
          </Pressable>
          <Pressable
            style={[styles.rotationBtn, rotationSettings?.rotationMode === "manual" && styles.rotationBtnActive]}
            onPress={() => updateRotation.mutate({ rotationMode: "manual" })}
          >
            <Text style={[styles.rotationBtnText, rotationSettings?.rotationMode === "manual" && styles.rotationBtnTextActive]}>يدوي (بالسحب فقط)</Text>
          </Pressable>
        </View>
        {/* ↔ صورة "ضع إعلانك هنا واستهدف آلاف العملاء يوميًا" الدائمة: بتفضل ظاهرة ضمن دورة
            الإعلانات للترويج لحجز إعلانات تانية، ويمكن تعطيلها من هنا. */}
        <View style={styles.durationRow}>
          <Switch
            value={rotationSettings?.showPlaceholder ?? true}
            onValueChange={(v) =>
              updateRotation.mutate({ showPlaceholder: v }, {
                onError: () => Alert.alert("تعذر الحفظ", "طبّق ملف قاعدة البيانات 20261003000000_ad_placeholder_toggle.sql أولًا ثم حاول مرة أخرى."),
              })
            }
          />
          <Text style={[styles.durationLabel, { flex: 1 }]}>إظهار صورة «ضع إعلانك هنا واستهدف آلاف العملاء يوميًا» ضمن الإعلانات</Text>
        </View>
        {rotationSettings?.rotationMode !== "manual" && (
          <View style={styles.durationRow}>
            <Text style={styles.durationLabel}>مدة عرض كل إعلان (ثواني):</Text>
            <TextInput
              style={styles.durationInput}
              keyboardType="number-pad"
              value={durationInput}
              onChangeText={setDurationInput}
              onBlur={() => {
                const secs = Number(durationInput) || 4;
                updateRotation.mutate({ durationMs: secs * 1000 });
              }}
            />
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>إضافة إعلان جديد</Text>
        <TextInput style={styles.input} placeholder="عنوان الإعلان" placeholderTextColor={themeColors.textSubtle} value={title} onChangeText={setTitle} />
        {/* ↔ ٣) المقاس المطلوب للصورة (يطابق المساحة الإعلانية أعلى صفحة القائمة) عشان المشرف
            يقدر يجهّزها برّه التطبيق بنفس المقاس لو حب. */}
        <View style={styles.specBox}>
          <Text style={styles.specTitle}>📐 مقاس صورة الإعلان المطلوب</Text>
          <Text style={styles.specValue}>{AD_BANNER_SPEC_TEXT}</Text>
          <Text style={styles.specNote}>جهّز الصورة بهذا المقاس بالظبط لتظهر كاملة بدون اقتصاص (الحد الأدنى للوضوح: {AD_BANNER_WIDTH} بكسل عرضًا). أى صورة بمقاس مختلف تُضبط داخل التطبيق بإطار بنفس النسبة ثم تُوافق عليها بعلامة ✅.</Text>
        </View>
        <Pressable style={styles.imagePicker} onPress={pickImage} disabled={uploadingImage}>
          {uploadingImage ? (
            <ActivityIndicator color="#f59e0b" />
          ) : imageUrl ? (
            <Image source={{ uri: cldOptimized(imageUrl, "w_700,q_auto,f_auto") }} style={styles.imagePreview} contentFit="cover" />
          ) : (
            <Text style={styles.imagePickerText}>اختر صورة الإعلان</Text>
          )}
        </Pressable>
        {!!imageInfo && <Text style={styles.imageInfo}>{imageInfo}</Text>}
        <TextInput style={styles.input} placeholder="الرابط عند الضغط (اختياري)" placeholderTextColor={themeColors.textSubtle} value={linkUrl} onChangeText={setLinkUrl} />
        <View style={styles.durationRow}>
          <Text style={styles.durationLabel}>مدة العرض (أيام):</Text>
          <TextInput style={styles.durationInput} keyboardType="number-pad" value={days} onChangeText={setDays} />
        </View>
        <Pressable style={styles.addBtn} onPress={addBanner} disabled={create.isPending}>
          <Text style={styles.addBtnText}>{create.isPending ? "جاري الإضافة..." : "إضافة الإعلان"}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>الإعلانات الحالية ({banners.length})</Text>
        <FlatList
          data={banners}
          keyExtractor={(b) => b.id}
          scrollEnabled={false}
          ListEmptyComponent={<Text style={styles.emptyText}>لا توجد إعلانات مضافة</Text>}
          renderItem={({ item }) => {
            const expired = item.endDate ? item.endDate < new Date().toISOString().slice(0, 10) : false;
            return (
              <View style={styles.bannerRow}>
                <BannerThumb url={item.imageUrl} styles={styles} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bannerTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.bannerDates}>
                    {item.startDate} → {item.endDate || "بلا نهاية"} {expired ? "· منتهي" : ""}
                  </Text>
                </View>
                <Switch value={item.active} onValueChange={(v) => toggleActive.mutate({ id: item.id, active: v })} />
                <Pressable
                  style={styles.deleteBtn}
                  onPress={() => Alert.alert("حذف الإعلان؟", "", [
                    { text: "إلغاء", style: "cancel" },
                    { text: "حذف", style: "destructive", onPress: () => remove.mutate(item.id) },
                  ])}
                >
                  <Text style={styles.deleteBtnText}>حذف</Text>
                </Pressable>
              </View>
            );
          }}
        />
      </View>
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: themeColors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: themeColors.border },
    cardTitle: { fontSize: 13, fontWeight: "900", color: themeColors.text, marginBottom: 10 },
    input: { borderWidth: 1, borderColor: themeColors.border, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, fontSize: 12.5, marginBottom: 8, color: themeColors.text },
    specBox: { backgroundColor: themeColors.isDark ? "rgba(245,158,11,0.12)" : "#FFFBEB", borderRadius: 10, borderWidth: 1, borderColor: "#F59E0B", padding: 10, marginBottom: 8, gap: 3 },
    specTitle: { fontSize: 12, fontWeight: "900", color: themeColors.text },
    specValue: { fontSize: 13, fontWeight: "900", color: "#B45309" },
    specNote: { fontSize: 11, color: themeColors.textSubtle, lineHeight: 17 },
    imageInfo: { fontSize: 11, color: themeColors.textSubtle, marginBottom: 8, fontWeight: "700" },
    imagePicker: {
      width: "100%", aspectRatio: AD_BANNER_ASPECT, borderRadius: 10, borderWidth: 1, borderColor: themeColors.border, borderStyle: "dashed",
      alignItems: "center", justifyContent: "center", marginBottom: 8, overflow: "hidden", backgroundColor: themeColors.surface,
    },
    imagePickerText: { fontSize: 12, fontWeight: "700", color: themeColors.textSubtle },
    imagePreview: { width: "100%", height: "100%" },
    durationRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
    durationLabel: { fontSize: 12, color: themeColors.textSubtle, fontWeight: "700" },
    rotationBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10, backgroundColor: themeColors.surface },
    rotationBtnActive: { backgroundColor: "#f59e0b" },
    rotationBtnText: { fontSize: 11.5, fontWeight: "800", color: themeColors.textSubtle },
    rotationBtnTextActive: { color: "white" },
    durationInput: { borderWidth: 1, borderColor: themeColors.border, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 12.5, width: 60, textAlign: "center", color: themeColors.text },
    addBtn: { backgroundColor: "#f59e0b", borderRadius: 999, paddingVertical: 11, alignItems: "center" },
    addBtnText: { color: "white", fontWeight: "900", fontSize: 12.5 },
    emptyText: { textAlign: "center", color: themeColors.textSubtle, fontSize: 12, paddingVertical: 16 },
    bannerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: themeColors.border },
    bannerThumb: { width: 78, height: 78 / AD_BANNER_ASPECT, borderRadius: 6 },
    bannerThumbEmpty: { backgroundColor: themeColors.surface },
    bannerThumbBroken: { borderWidth: 1, borderColor: "#DC2626" },
    bannerThumbWarn: { color: "#DC2626", fontSize: 9.5, fontWeight: "800", textAlign: "center", marginTop: 2 },
    bannerTitle: { fontSize: 12.5, fontWeight: "800", color: themeColors.text },
    bannerDates: { fontSize: 10.5, color: themeColors.textSubtle, marginTop: 2 },
    deleteBtn: { backgroundColor: themeColors.isDark ? "rgba(239,68,68,0.15)" : "#FEF2F2", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
    deleteBtnText: { color: "#991B1B", fontWeight: "900", fontSize: 11 },
  });
}
