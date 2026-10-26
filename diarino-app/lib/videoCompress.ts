import { Platform } from "react-native";

// ↔ ضغط الفيديو على الجهاز قبل الرفع (أندرويد فقط) بمكتبة react-native-compressor.
//
// الهدف: تقليل استهلاك باقة الإنترنت وزمن الرفع، وتفادي انقطاع/فشل رفع فيديوهات
// 1080p/4K الكبيرة. بنضغط لـ 720p (أطول ضلع 1280) بمعدل بت مناسب للريلز.
// (آيفون: الـ picker نفسه بيعيد ترميز الفيديو لـ 720p عبر videoExportPreset فى
// create-listing.tsx — والويب مفيهوش ضغط أصلي، فالدالة دي بترجّع الملف كما هو.)
//
// ✦ القرار ذكي مش أعمى: بنقرر من بيانات الملف (أبعاد/مدة/حجم) اللي الـ picker
//   رجّعها — لو الفيديو أصلًا ≤ 1280 وبمعدل بت منخفض (≤ 4Mbps) بنسيبه من غير ضغط،
//   عشان نتفادى إعادة ترميز ممكن تطلّع ملف أكبر أو أقل جودة بدون فايدة. ولو
//   اتضغط، معدل البت المستهدف = الأقل بين 3Mbps و80% من معدل الأصل.
// ✦ أمان: لو المكتبة مش متركّبة (لسه ما عملتش npm install + build جديد) أو الضغط
//   فشل لأي سبب، بنرجّع الملف الأصلي والرفع بيكمّل عادي — الضغط تحسين مش شرط.
// ✦ Cloudinary بعد كده بيعيد ترميزه تاني بالـ Incoming transformation على الـ
//   preset (docs/video-pipeline.md) — الضغط المحلي هدفه توفير الرفع نفسه.

export type VideoMeta = {
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  fileSize?: number | null;
};

const TARGET_MAX_SIDE = 1280;
const TARGET_BITRATE = 3_000_000; // 3 Mbps
const MIN_BITRATE = 1_000_000; // 1 Mbps (أقل من كده الجودة بتنهار)
const ALREADY_LIGHT_BITRATE = 4_000_000; // ≤ ده + ≤ 1280px = مفيش داعي للضغط

type CompressorModule = {
  Video?: {
    compress: (uri: string, options: Record<string, unknown>, onProgress?: (progress: number) => void) => Promise<string>;
  };
  clearCache?: (cacheDir?: string) => Promise<unknown>;
};

function loadCompressor(): CompressorModule | null {
  if (Platform.OS !== "android") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react-native-compressor") as CompressorModule;
  } catch {
    return null; // المكتبة مش متركّبة فى البناء ده
  }
}

function originalBitrate(meta: VideoMeta): number | null {
  if (!meta.fileSize || !meta.durationMs || meta.durationMs <= 0) return null;
  return (meta.fileSize * 8) / (meta.durationMs / 1000);
}

function alreadyLight(meta: VideoMeta): boolean {
  const maxSide = Math.max(meta.width ?? 0, meta.height ?? 0);
  const bitrate = originalBitrate(meta);
  return maxSide > 0 && maxSide <= TARGET_MAX_SIDE && bitrate !== null && bitrate <= ALREADY_LIGHT_BITRATE;
}

// هل هنضغط الفيديو ده فعلًا؟ (أندرويد + المكتبة متركّبة + الفيديو محتاج ضغط).
// بنستخدمها قبل الرفع عشان نعرض مرحلة "ضغط الفيديو" فى المؤشر بس لو هتحصل.
export function willCompressVideo(meta: VideoMeta): boolean {
  return loadCompressor() !== null && !alreadyLight(meta);
}

export type CompressResult = { uri: string; compressed: boolean; failed: boolean };

export async function compressVideoForUpload(
  uri: string,
  meta: VideoMeta,
  onProgress?: (ratio: number) => void
): Promise<CompressResult> {
  const mod = loadCompressor();
  if (!mod?.Video?.compress || alreadyLight(meta)) return { uri, compressed: false, failed: false };

  const orig = originalBitrate(meta);
  const bitrate = Math.round(
    orig ? Math.max(MIN_BITRATE, Math.min(TARGET_BITRATE, orig * 0.8)) : TARGET_BITRATE
  );

  try {
    const out = await mod.Video.compress(
      uri,
      { compressionMethod: "manual", maxSize: TARGET_MAX_SIDE, bitrate },
      (p) => onProgress?.(Math.max(0, Math.min(1, p)))
    );
    onProgress?.(1);
    return { uri: out || uri, compressed: !!out && out !== uri, failed: false };
  } catch (err) {
    console.warn("Video compression failed — uploading the original file:", err);
    return { uri, compressed: false, failed: true };
  }
}

// تنضيف الملفات المؤقتة اللي المكتبة عملتها (best-effort).
export function clearCompressedVideoCache(): void {
  try {
    const p = loadCompressor()?.clearCache?.();
    if (p && typeof (p as Promise<unknown>).catch === "function") (p as Promise<unknown>).catch(() => {});
  } catch {
    /* ignore */
  }
}
