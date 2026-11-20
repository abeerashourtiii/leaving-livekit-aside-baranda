import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";

// ↔ نظافة الملفات المؤقتة (أندرويد / آيفون) — التطبيق لا يحفظ أى وسائط فى معرض الصور ولا فى التخزين العام:
//   • كل ما يكتبه التطبيق مؤقتًا (ناتج ضغط الفيديو، لقطات الغلاف، نسخ منتقى الملفات...) يبقى داخل مجلد الكاش الخاص به
//     (FileSystem.cacheDirectory ← Android: context.cacheDir / iOS: Library/Caches) وليس فى التخزين الخارجى العام أو MediaStore.
//   • الملفات الفارغة (0 بايت ← تظهر كفيديو 0:00 أسود) والوسائط المؤقتة القديمة تُحذف تلقائيًا (sweepAppCache) ويُحذف الناتج المؤقت بعد استخدامه.
//   • أى تنزيل يُحفظ فى الكاش يمر عبر downloadVerifiedToCache: لا يُعتمد إلا بعد HTTP 200/206 وحجم > 0، وإلا يُحذف الملف فى catch فورًا.
// على الويب لا شيء من هذا يلزم (لا نظام ملفات؛ المتصفح يدير كاشه) فكل الدوال هنا no-op.
// مجلدات الكاش الداخلية للمكتبات (Glide / ExoPlayer / SDWebImage / WebKit) لا نلمسها: تديرها مكتباتها وفهرسها الداخلى يتعطل لو حذفنا منها.

const IS_NATIVE = Platform.OS !== "web";
const SKIP_DIRS = new Set([
  "image_manager_disk_cache", // Glide (expo-image على أندرويد)
  "expo_video_cache", // ExoPlayer cache (expo-video)
  "com.hackemist.SDImageCache", // SDWebImage (expo-image على iOS)
  "com.apple.WebKit.WebContent",
  "WebKit",
  "fsCachedData",
  "Snapshots",
]);
const MEDIA_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|mp4|m4v|mov|3gp|mkv|webm|avi|mp3|m4a|aac|wav|ogg)$/i;
const MIN_AGE_MS_EMPTY = 10 * 60 * 1000; // لا نلمس ملفًا فارغًا عمره أقل من 10 دقائق (قد يكون قيد الكتابة الآن)
const MAX_AGE_MS_MEDIA = 24 * 60 * 60 * 1000; // وسائط مؤقتة أقدم من 24 ساعة تُحذف
const MAX_DEPTH = 4;
const MAX_ENTRIES = 3000; // سقف لزمن المسح

let sweptThisLaunch = false;

/** حذف ملف/مجلد مؤقت بهدوء (لا يرمى أى خطأ). */
export async function safeDelete(uri: string | null | undefined): Promise<void> {
  if (!IS_NATIVE || !uri || !/^file:/i.test(uri)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    /* best-effort */
  }
}

/** هل الملف موجود وحجمه > 0؟ (ملف 0 بايت = تحميل فاشل ← يُحذف ولا يُعتمد). */
export async function isNonEmptyFile(uri: string): Promise<boolean> {
  if (!IS_NATIVE) return true;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return !!info.exists && !info.isDirectory && typeof info.size === "number" && info.size > 0;
  } catch {
    return false;
  }
}

/**
 * تنزيل إلى الكاش الداخلى فقط بتحقق صارم: HTTP 200/206 وحجم > 0، وفى أى فشل/انقطاع يُحذف الملف المؤقت فى catch فورًا.
 * يرجّع مسار الملف الصالح أو null. (لا يحفظ شيئًا فى المعرض؛ للحفظ فى المعرض عمدًا اطلب إذنًا صريحًا وزرًا صريحًا من المستخدم.)
 */
export async function downloadVerifiedToCache(url: string, fileName: string): Promise<string | null> {
  if (!IS_NATIVE || !FileSystem.cacheDirectory) return null;
  const safeName = fileName.replace(/[^\w.\-]/g, "_").slice(0, 80) || `dl_${Date.now()}`;
  const dest = `${FileSystem.cacheDirectory}${safeName}`;
  try {
    const res = await FileSystem.downloadAsync(url, dest);
    const okStatus = res.status === 200 || res.status === 206;
    if (!okStatus || !(await isNonEmptyFile(res.uri))) {
      await safeDelete(res.uri);
      await safeDelete(dest);
      return null;
    }
    return res.uri;
  } catch {
    await safeDelete(dest); // انقطاع الشبكة/فشل التحميل: لا نترك ملفًا فارغًا أو جزئيًا
    return null;
  }
}

async function walk(dir: string, depth: number, budget: { left: number }, now: number): Promise<void> {
  if (depth > MAX_DEPTH || budget.left <= 0) return;
  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (budget.left-- <= 0) return;
    if (name.startsWith(".")) continue; // .nomedia وغيره
    const path = `${dir}${name}`;
    let info: FileSystem.FileInfo;
    try {
      info = await FileSystem.getInfoAsync(path);
    } catch {
      continue;
    }
    if (!info.exists) continue;
    if (info.isDirectory) {
      if (SKIP_DIRS.has(name)) continue;
      await walk(`${path}/`, depth + 1, budget, now);
      continue;
    }
    const ageMs = typeof info.modificationTime === "number" ? now - info.modificationTime * 1000 : 0;
    const isEmpty = typeof info.size === "number" && info.size === 0;
    if ((isEmpty && ageMs > MIN_AGE_MS_EMPTY) || (MEDIA_EXT.test(name) && ageMs > MAX_AGE_MS_MEDIA)) {
      await safeDelete(path);
    }
  }
}

/** مسح مرة واحدة لكل تشغيل: حذف الملفات الفارغة (0 بايت) والوسائط المؤقتة القديمة داخل كاش التطبيق فقط. */
export async function sweepAppCache(force = false): Promise<void> {
  if (!IS_NATIVE || !FileSystem.cacheDirectory) return;
  if (sweptThisLaunch && !force) return;
  sweptThisLaunch = true;
  try {
    await walk(FileSystem.cacheDirectory, 0, { left: MAX_ENTRIES }, Date.now());
  } catch (e) {
    console.warn("[mediaHygiene] sweep failed:", e);
  }
}
