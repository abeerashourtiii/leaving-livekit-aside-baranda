import { useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, FlatList, Alert, Switch, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useServiceCategories, useServiceCategoryMutations } from "../../lib/hooks/useServiceCategories";
import { serviceCategoryImage } from "../../lib/companies";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";
import { useCurrentUser } from "../../lib/hooks/useCurrentUser";
import { useLogMedia } from "../../lib/hooks/useMedia";
import { uploadToCloudinary, cldThumbnail } from "../../lib/cloudinary";

// ↔ «إدارة قسم الخدمات»: التحكم الكامل فى كروت شريط «الخدمات» بصفحة القائمة بدون تعديل كود —
//   إضافة تصنيف جديد (الاسم + الصورة) فيظهر تلقائيًا فى الشريط وفى قائمة «نشاط الشركة» عند تسجيل شركة، وتعديل الاسم/الصورة،
//   وإعادة الترتيب (↑/↓: الأول = أقصى اليمين)، وإخفاء/إظهار أى كارت، وحذف تصنيف لا شركات عليه.
//   الصلاحية = menuItems (نفس صلاحية «أيقونات القائمة»). الجدول: public.service_categories (migration 20261125000000_services_admin.sql).
export function AdminServices() {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { all, fromServer, isLoading } = useServiceCategories();
  const { create, update, remove, reorder } = useServiceCategoryMutations();
  const { user } = useCurrentUser();
  const logMedia = useLogMedia();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [usesPhotos, setUsesPhotos] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const editing = editingId ? all.find((c) => c.id === editingId) : undefined;

  function resetForm() {
    setEditingId(null); setLabel(""); setImageUrl(null); setUsesPhotos(false);
  }

  function startEdit(id: string) {
    const c = all.find((x) => x.id === id);
    if (!c) return;
    setEditingId(id); setLabel(c.label); setImageUrl(c.imageUrl); setUsesPhotos(c.usesPropertyPhotos);
  }

  // رفع حقيقى على Cloudinary (نفس آلية أيقونات القائمة): أندرويد/آيفون من المعرض والويب من نافذة اختيار الملف.
  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 0.9 });
    if (result.canceled) return;
    setUploading(true);
    try {
      const up = await uploadToCloudinary(result.assets[0].uri, "image");
      if (user?.id) logMedia.mutate({ ownerId: user.id, type: "image", context: "other", result: up });
      setImageUrl(up.url);
    } catch {
      Alert.alert("تعذر رفع الصورة", "حاول مرة أخرى.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    const name = label.trim().replace(/\s+/g, " ");
    if (name.length < 2) {
      Alert.alert("تنبيه", "اكتب اسم التصنيف (حرفان على الأقل)، مثال: شركات الأمن والحراسة.");
      return;
    }
    if (!fromServer) {
      Alert.alert("غير متاح", "جدول التصنيفات غير موجود فى قاعدة البيانات بعد — طبّق migration 20261125000000_services_admin.sql أولًا.");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await update.mutateAsync({ id: editingId, patch: { label: name, imageUrl, usesPropertyPhotos: usesPhotos } });
      } else {
        const nextOrder = all.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1;
        await create.mutateAsync({ input: { label: name, imageUrl, usesPropertyPhotos: usesPhotos }, sortOrder: nextOrder });
      }
      resetForm();
    } catch (err: unknown) {
      Alert.alert("تعذّرت العملية", err instanceof Error ? err.message : "حصل خطأ غير متوقع، حاول تاني.");
    } finally {
      setSaving(false);
    }
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= all.length || !fromServer) return;
    const ids = all.map((c) => c.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids, { onError: (e: unknown) => Alert.alert("تعذّر الترتيب", e instanceof Error ? e.message : "حاول مرة أخرى.") });
  }

  const previewSource = imageUrl ? { uri: imageUrl } : editing ? serviceCategoryImage({ key: editing.key, imageUrl: null }) : null;

  return (
    <View style={{ gap: 14 }}>
      {!fromServer && !isLoading && (
        <View style={[styles.card, { borderColor: "#F59E0B" }]}>
          <Text style={styles.cardTitle}>⚠️ جدول التصنيفات غير موجود بعد</Text>
          <Text style={styles.hint}>
            الشريط يعمل الآن بالتصنيفات الخمسة الثابتة. لتفعيل الإدارة الكاملة طبّق ملف قاعدة البيانات supabase/migrations/20261125000000_services_admin.sql من لوحة Supabase (SQL Editor).
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{editingId ? "تعديل كارت خدمة" : "إضافة كارت خدمة جديد"}</Text>

        <TextInput
          style={styles.input}
          placeholder="اسم التصنيف (يظهر على الكارت وفى نشاط الشركة)"
          placeholderTextColor={themeColors.textSubtle}
          value={label}
          onChangeText={setLabel}
          maxLength={80}
        />

        <Text style={styles.label}>صورة الكارت</Text>
        <Pressable style={styles.imagePicker} onPress={pickImage} disabled={uploading}>
          {uploading ? (
            <ActivityIndicator />
          ) : previewSource ? (
            <Image source={imageUrl ? { uri: cldThumbnail(imageUrl) } : previewSource} style={styles.imagePreview} contentFit="cover" />
          ) : (
            <Text style={styles.imagePickerText}>اضغط لاختيار صورة (يفضّل قريبة من المربع)</Text>
          )}
        </Pressable>
        {!!imageUrl && (
          <Pressable style={styles.removeImageBtn} onPress={() => setImageUrl(null)}>
            <Text style={styles.removeImageBtnText}>{editing && serviceCategoryImage({ key: editing.key, imageUrl: null }) ? "إزالة الصورة المرفوعة (الرجوع للصورة الأصلية)" : "إزالة الصورة"}</Text>
          </Pressable>
        )}

        <View style={styles.switchRow}>
          <Switch value={usesPhotos} onValueChange={setUsesPhotos} />
          <Text style={[styles.label, { flex: 1, marginBottom: 0 }]}>شركات هذا التصنيف تعرض صور عقارات/مشروعات (بدل صور الأعمال)</Text>
        </View>
        <Text style={styles.hint}>
          التصنيف الجديد يظهر تلقائيًا فى شريط «الخدمات» وفى قائمة «اختر نشاط الشركة» عند تسجيل شركة جديدة، وصفحته تعرض الشركات المسجّلة عليه.
        </Text>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          {editingId && (
            <Pressable style={[styles.addBtn, { flex: 1, backgroundColor: themeColors.surface }]} onPress={resetForm}>
              <Text style={[styles.addBtnText, { color: themeColors.textMuted }]}>إلغاء</Text>
            </Pressable>
          )}
          <Pressable style={[styles.addBtn, { flex: 1, opacity: saving || uploading ? 0.6 : 1 }]} onPress={submit} disabled={saving || uploading}>
            <Text style={styles.addBtnText}>{editingId ? "حفظ التعديل" : "إضافة الكارت"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>كروت قسم الخدمات ({all.length})</Text>
        <Text style={styles.hint}>الكارت رقم 1 يظهر أقصى اليمين فى الشريط. الكروت المخفية لا تظهر للمستخدمين ولا فى قائمة نشاط الشركة.</Text>
        <FlatList
          data={all}
          keyExtractor={(c) => c.id}
          scrollEnabled={false}
          renderItem={({ item, index }) => {
            const src = serviceCategoryImage(item);
            return (
              <View style={styles.row}>
                <Text style={styles.positionBadge}>{index + 1}</Text>
                {src ? (
                  <Image source={item.imageUrl ? { uri: cldThumbnail(item.imageUrl) } : src} style={styles.iconPreview} contentFit="cover" />
                ) : (
                  <View style={[styles.iconPreview, { backgroundColor: "#1E5AA8" }]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{item.label}</Text>
                  <Text style={styles.rowMeta}>{item.active ? "ظاهر" : "مخفى"}{item.usesPropertyPhotos ? " · صور عقارات" : ""}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 4 }}>
                  <Pressable style={styles.moveBtn} onPress={() => move(index, -1)} disabled={index === 0}>
                    <Text style={styles.moveBtnText}>↑</Text>
                  </Pressable>
                  <Pressable style={styles.moveBtn} onPress={() => move(index, 1)} disabled={index === all.length - 1}>
                    <Text style={styles.moveBtnText}>↓</Text>
                  </Pressable>
                </View>
                <Switch
                  value={item.active}
                  disabled={!fromServer}
                  onValueChange={(v) => update.mutate({ id: item.id, patch: { active: v } }, { onError: (e: unknown) => Alert.alert("تعذّرت العملية", e instanceof Error ? e.message : "حاول مرة أخرى.") })}
                />
                <Pressable style={styles.editBtn} onPress={() => startEdit(item.id)} disabled={!fromServer}>
                  <Text style={styles.editBtnText}>تعديل</Text>
                </Pressable>
                <Pressable
                  style={styles.deleteBtn}
                  disabled={!fromServer}
                  onPress={() => Alert.alert("حذف الكارت؟", `${item.label}\n\nلا يمكن حذف تصنيف مسجّلة عليه شركات — أخفِه بدل الحذف.`, [
                    { text: "إلغاء", style: "cancel" },
                    {
                      text: "حذف", style: "destructive",
                      onPress: () => remove.mutate(item.id, { onError: (e: unknown) => Alert.alert("تعذّر الحذف", e instanceof Error ? e.message : "حاول مرة أخرى.") }),
                    },
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

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border },
    cardTitle: { fontSize: 13, fontWeight: "900", color: c.text, marginBottom: 10 },
    input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, fontSize: 12.5, marginBottom: 8, color: c.text },
    label: { fontSize: 11.5, fontWeight: "800", color: c.textSubtle, marginBottom: 6, marginTop: 2 },
    hint: { fontSize: 10.5, color: c.textSubtle, marginBottom: 8 },
    imagePicker: {
      height: 120, borderRadius: 10, borderWidth: 1, borderColor: c.border, borderStyle: "dashed",
      alignItems: "center", justifyContent: "center", marginBottom: 8, overflow: "hidden", backgroundColor: c.surface,
    },
    imagePickerText: { fontSize: 12, fontWeight: "700", color: c.textSubtle },
    imagePreview: { width: "100%", height: "100%" },
    removeImageBtn: { alignSelf: "flex-start", marginBottom: 10 },
    removeImageBtnText: { color: "#991B1B", fontWeight: "800", fontSize: 11 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
    addBtn: { backgroundColor: "#6366f1", borderRadius: 999, paddingVertical: 11, alignItems: "center" },
    addBtnText: { color: "white", fontWeight: "900", fontSize: 12.5 },
    row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border },
    positionBadge: { minWidth: 18, textAlign: "center", fontSize: 10.5, fontWeight: "900", color: c.textSubtle, backgroundColor: c.surface, borderRadius: 999, paddingVertical: 2 },
    iconPreview: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center", overflow: "hidden" },
    rowTitle: { fontSize: 12, fontWeight: "800", color: c.text },
    rowMeta: { fontSize: 10, color: c.textSubtle, marginTop: 1 },
    moveBtn: { width: 24, height: 24, borderRadius: 6, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
    moveBtnText: { fontSize: 12, fontWeight: "900", color: c.textMuted },
    editBtn: { backgroundColor: c.isDark ? "rgba(99,102,241,0.18)" : "#eef2ff", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10 },
    editBtnText: { color: "#6366f1", fontWeight: "900", fontSize: 10.5 },
    deleteBtn: { backgroundColor: c.isDark ? "rgba(239,68,68,0.15)" : "#FEF2F2", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10 },
    deleteBtnText: { color: "#991B1B", fontWeight: "900", fontSize: 10.5 },
  });
}
