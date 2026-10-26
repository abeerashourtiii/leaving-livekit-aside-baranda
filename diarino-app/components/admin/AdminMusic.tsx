import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, Alert, Switch, ActivityIndicator } from "react-native";
import { Audio } from "expo-av";
import { useAllMusicTracks, useMusicMutations, resolveMusicSource, MusicTrack } from "../../lib/musicLibrary";
import { startMusicPreview, stopMusicPreview } from "../../lib/musicPlayer";
import { pickAudioFile, PickedAudio } from "../../lib/pickAudioFile";
import { uploadToCloudinary } from "../../lib/cloudinary";
import { logAndGetSafeMessage } from "../../lib/errors";
import { useThemeColors, ThemeColors } from "../../lib/hooks/useThemeColors";

// ↔ التحكم فى المكتبة الموسيقية للإعلانات من لوحة الأدمن: إضافة مقطع (رفع لـ Cloudinary + صف فى public.music_tracks)،
// إخفاء/إظهاره، أو حذفه، ومعاينته. الملفات الصوتية على Cloudinary مش على Supabase Storage (جدول music_tracks بيانات
// وصفية بس)، وبتتسلّم للمستخدمين مضغوطة (mp3 بمعدل 96kbps بالرابط — شوف musicDeliveryUrl).
// ⚠ حذف مقطع بيشيله من المكتبة بس؛ الملف نفسه بيفضل على Cloudinary (الحذف النهائى من Media Library هناك).
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function fmtDuration(sec: number | null) {
  if (!sec) return "—";
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

async function measureDurationSec(uri: string): Promise<number | null> {
  try {
    const { sound, status } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
    const ms = status.isLoaded ? status.durationMillis ?? null : null;
    await sound.unloadAsync().catch(() => {});
    return ms ? ms / 1000 : null;
  } catch {
    return null;
  }
}

export function AdminMusic() {
  const themeColors = useThemeColors();
  const styles = createStyles(themeColors);
  const { data: tracks = [], isLoading, isError, refetch } = useAllMusicTracks();
  const { add, toggleActive, remove } = useMusicMutations();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // ↔ إثبات الترخيص (سياسة حقوق النشر): مصدر المقطع ومرجع ملف الإثبات فى docs/licenses — إلزامى لأى مقطع بيتضاف من اللوحة.
  const [licenseNote, setLicenseNote] = useState("");
  const [picked, setPicked] = useState<PickedAudio | null>(null);
  const [pickedDuration, setPickedDuration] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => () => { void stopMusicPreview(); }, []);

  async function handlePick() {
    const res = await pickAudioFile();
    if (res === "cancelled") return;
    if (res === "unsupported") {
      Alert.alert("غير متاح على هذه النسخة", "اختيار الملفات الصوتية يحتاج تحديث التطبيق (expo-document-picker). يمكنك الرفع من نسخة الويب الآن.");
      return;
    }
    if (res.size != null && res.size > MAX_AUDIO_BYTES) {
      Alert.alert("الملف كبير", "الحد الأقصى لحجم المقطع 25 ميجابايت. اختر ملفًا أصغر.");
      return;
    }
    setPicked(res);
    setPickedDuration(await measureDurationSec(res.uri));
    if (!title.trim()) setTitle(res.name.replace(/\.[^.]+$/, ""));
  }

  async function handleUpload() {
    if (!picked) return Alert.alert("اختر ملف الموسيقى أولًا");
    const cleanTitle = title.trim();
    if (!cleanTitle) return Alert.alert("اكتب اسم المقطع");
    if (!licenseNote.trim()) return Alert.alert("مصدر الترخيص مطلوب", "اكتب مصدر المقطع ومرجع إثبات الترخيص (مثال: Stable Audio — خطة Pro — 2026-10-12 — stable-audio-license.pdf). راجع docs/licenses/README.md.");
    if (tracks.some((t) => t.title.toLowerCase() === cleanTitle.toLowerCase())) return Alert.alert("الاسم مستخدم", "يوجد مقطع بنفس الاسم، اختر اسمًا مختلفًا.");
    setUploading(true);
    setProgress(0);
    try {
      const result = await uploadToCloudinary(picked.uri, "audio", setProgress);
      await add.mutateAsync({
        title: cleanTitle, description: description.trim(), url: result.url, publicId: result.publicId,
        durationSec: result.duration ?? pickedDuration, licenseNote: licenseNote.trim(),
      });
      setTitle(""); setDescription(""); setLicenseNote(""); setPicked(null); setPickedDuration(null);
    } catch (err) {
      Alert.alert("تعذر إضافة المقطع", logAndGetSafeMessage("music upload failed", err, "تأكد من preset الرفع على Cloudinary (docs/cloudinary-music-preset.md) وحاول مرة أخرى."));
    } finally {
      setUploading(false);
    }
  }

  async function togglePreview(track: MusicTrack) {
    if (previewing === track.id) {
      await stopMusicPreview();
      setPreviewing(null);
      return;
    }
    const source = resolveMusicSource(track.title, [track]);
    if (!source) return;
    setPreviewing(track.id);
    const ok = await startMusicPreview(source, () => setPreviewing((cur) => (cur === track.id ? null : cur)));
    if (!ok) {
      setPreviewing(null);
      Alert.alert("تعذر تشغيل المقطع");
    }
  }

  function confirmRemove(track: MusicTrack) {
    Alert.alert("حذف المقطع؟", `${track.title}\nسيختفي من المكتبة (الإعلانات القديمة التي تستخدمه ستعرض مقطعًا افتراضيًا).`, [
      { text: "إلغاء", style: "cancel" },
      { text: "حذف", style: "destructive", onPress: () => remove.mutate(track.id, { onError: (e) => Alert.alert("تعذر الحذف", logAndGetSafeMessage("music remove failed", e, "حاول مرة أخرى.")) }) },
    ]);
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>إضافة مقطع جديد</Text>
        <Text style={styles.hint}>يُرفع الملف إلى Cloudinary ويُسلَّم للمستخدمين مضغوطًا (mp3 · 96kbps)، ولا يشغل مساحة من Supabase.</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="اسم المقطع (يظهر للمستخدم)" placeholderTextColor={themeColors.textSubtle} />
        <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder="وصف قصير (اختياري) مثل: هادئة وعصرية" placeholderTextColor={themeColors.textSubtle} />
        <TextInput style={[styles.input, { minHeight: 64, textAlignVertical: "top" }]} value={licenseNote} onChangeText={setLicenseNote} multiline placeholder="مصدر الترخيص (مطلوب): الجهة/الأداة + الخطة + تاريخ التوليد + اسم ملف الإثبات فى docs/licenses" placeholderTextColor={themeColors.textSubtle} />
        <Text style={styles.hint}>لا تضف أى مقطع ليس لديك ترخيص تجارى مكتوب له. المقطع يُنشر لكل المستخدمين داخل إعلاناتهم، والمسؤولية القانونية عن ترخيصه على صاحب التطبيق.</Text>
        <Pressable style={styles.pickBtn} onPress={handlePick} disabled={uploading}>
          <Text style={styles.pickBtnText}>{picked ? `🎵 ${picked.name}${pickedDuration ? ` (${fmtDuration(pickedDuration)})` : ""}` : "اختر ملف موسيقى (mp3 / m4a / wav)"}</Text>
        </Pressable>
        {uploading && (
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} /></View>
        )}
        <Pressable style={[styles.primaryBtn, (uploading || !picked) && { opacity: 0.6 }]} onPress={handleUpload} disabled={uploading || !picked}>
          {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>رفع وإضافة للمكتبة</Text>}
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>المقاطع ({tracks.length})</Text>
      {isLoading && <ActivityIndicator color="#6366f1" />}
      {isError && (
        <View style={styles.card}>
          <Text style={styles.hint}>تعذر تحميل المكتبة. تأكد من تطبيق ملف قاعدة البيانات 20261011000000_music_library.sql على Supabase.</Text>
          <Pressable style={styles.pickBtn} onPress={() => refetch()}><Text style={styles.pickBtnText}>إعادة المحاولة</Text></Pressable>
        </View>
      )}
      {tracks.map((track) => (
        <View key={track.id} style={styles.card}>
          <View style={styles.row}>
            <Pressable style={[styles.previewBtn, previewing === track.id && styles.previewBtnOn]} onPress={() => togglePreview(track)}>
              <Text style={styles.previewBtnText}>{previewing === track.id ? "⏸" : "▶"}</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.trackTitle} numberOfLines={1}>{track.title}</Text>
              <Text style={styles.hint} numberOfLines={1}>
                {track.description || "—"} · {fmtDuration(track.durationSec)} · {track.url ? "Cloudinary" : "مدمج بالتطبيق"}
              </Text>
              <Text style={[styles.hint, !track.licenseNote && { color: "#B45309" }]} numberOfLines={2}>
                {track.licenseNote ? `📄 ${track.licenseNote}` : "⚠ لا يوجد مرجع ترخيص مسجَّل لهذا المقطع"}
              </Text>
            </View>
            <Switch value={track.active} onValueChange={(v) => toggleActive.mutate({ id: track.id, active: v })} trackColor={{ true: "#10b981" }} />
          </View>
          <Pressable style={styles.deleteBtn} onPress={() => confirmRemove(track)}>
            <Text style={styles.deleteBtnText}>حذف من المكتبة</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: themeColors.card, borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: themeColors.border },
    cardTitle: { fontSize: 14, fontWeight: "900", color: themeColors.text },
    sectionTitle: { fontSize: 13, fontWeight: "900", color: themeColors.textMuted },
    hint: { fontSize: 11.5, color: themeColors.textSubtle, lineHeight: 18 },
    input: { backgroundColor: themeColors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: themeColors.text, borderWidth: 1, borderColor: themeColors.border },
    pickBtn: { backgroundColor: themeColors.isDark ? "rgba(99,102,241,0.18)" : "#eef2ff", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, alignItems: "center" },
    pickBtnText: { color: "#6366f1", fontSize: 12.5, fontWeight: "800" },
    primaryBtn: { backgroundColor: "#6366f1", borderRadius: 999, paddingVertical: 12, alignItems: "center" },
    primaryBtnText: { color: "#fff", fontSize: 13, fontWeight: "900" },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: themeColors.isDark ? "#2E3237" : "#E5E7EB", overflow: "hidden" },
    progressFill: { height: 6, backgroundColor: "#6366f1" },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    trackTitle: { fontSize: 13.5, fontWeight: "900", color: themeColors.text },
    previewBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: "#6366f1", alignItems: "center", justifyContent: "center" },
    previewBtnOn: { backgroundColor: "#6366f1" },
    previewBtnText: { color: "#6366f1", fontSize: 13, fontWeight: "900" },
    deleteBtn: { alignSelf: "flex-start", paddingVertical: 4 },
    deleteBtnText: { color: "#B91C1C", fontSize: 12, fontWeight: "800" },
  });
}
