import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import type { CloudinaryUploadResult } from "./cloudinary";

// ↔ منع تكرار رفع نفس الملف على Cloudinary (يوفّر Storage + Bandwidth) — يعمل بنفس الكود على أندرويد/آيفون/الويب/APK.
//
//   1) «البصمة»: MD5 على أندرويد/آيفون (expo-file-system يحسبه نيتف بالبث دون تحميل الملف فى الذاكرة) وSHA-256 على الويب (Web Crypto)،
//      مع حجم الملف ونوعه (image/video/audio). المفتاح = المستخدم + النوع + الخوارزمية + البصمة + الحجم.
//   2) قبل الرفع نبحث عن رفع سابق لنفس المفتاح: (أ) ذاكرة الجهاز AsyncStorage (تعمل بلا اتصال وبين الجلسات)، ثم (ب) جدول
//      public.media_fingerprints (migration 20261121000100) فتشمل إعادة التثبيت واختلاف الأجهزة. نتحقق بطلب HEAD أن الرابط ما زال حيًّا
//      (404/410 = حُذف من Cloudinary فنُسقط السجل ونرفع من جديد). عند الوجود يُعاد استخدام secure_url/public_id مباشرة دون رفع.
//   3) بعد أى رفع ناجح نسجّل البصمة فورًا فى الجهاز والجدول (قبل أن تحفظ أى شاشة سجلها)، فإن فشل حفظ الإعلان لاحقًا أو انقطع الاتصال
//      فإعادة المحاولة لا ترفع الملف ثانيةً. ونفس الملف المرفوع فى أكثر من حقل فى وقت واحد يُرفع مرة واحدة (in-flight dedupe).
//
// الأمان: المطابقة *داخل حساب المستخدم نفسه فقط* (مفتاح الذاكرة يحمل معرّفه وRLS الجدول owner_id = auth.uid())، فلا تعاد أبدًا روابط مستخدم لآخر.
// لا نستخدم overwrite=true ولا نمرّر public_id من العميل، فلا شيء هنا يستبدل ملفًا موجودًا. أى فشل فى هذه الطبقة يُتجاهل ويُرفع الملف كالمعتاد.

export type MediaKind = "image" | "video" | "audio";
export type Fingerprint = { kind: MediaKind; algo: "md5" | "sha256"; hash: string; size: number };

const LOCAL_PREFIX = "media_fp_v1:";
const LOCAL_MAX_ENTRIES = 150;
const WEB_MAX_HASH_BYTES = 150 * 1024 * 1024; // أكبر من هذا على الويب لا نحسب بصمة (حماية الذاكرة) ونرفع كالمعتاد
const ALIVE_CHECK_TIMEOUT_MS = 6000;

type StoredEntry = { result: CloudinaryUploadResult; savedAt: number };

const fpKey = (fp: Fingerprint) => `${fp.kind}|${fp.algo}|${fp.hash}|${fp.size}`;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** بصمة الملف أو null إن تعذّر حسابها (فلا نطابق ونرفع عاديًا). */
export async function computeFingerprint(uri: string, kind: MediaKind): Promise<Fingerprint | null> {
  try {
    if (Platform.OS === "web") {
      const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
      if (!subtle) return null;
      const blob = await (await fetch(uri)).blob();
      if (!blob.size || blob.size > WEB_MAX_HASH_BYTES) return null;
      const hash = toHex(await subtle.digest("SHA-256", await blob.arrayBuffer()));
      return { kind, algo: "sha256", hash, size: blob.size };
    }
    const info = await FileSystem.getInfoAsync(uri, { md5: true, size: true });
    if (!info.exists || info.isDirectory || !info.md5 || !info.size) return null;
    return { kind, algo: "md5", hash: info.md5, size: info.size };
  } catch {
    return null;
  }
}

// ───────── ذاكرة الجهاز ─────────
async function readLocal(ownerId: string): Promise<Record<string, StoredEntry>> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_PREFIX + ownerId);
    return raw ? (JSON.parse(raw) as Record<string, StoredEntry>) : {};
  } catch {
    return {};
  }
}
async function writeLocal(ownerId: string, map: Record<string, StoredEntry>): Promise<void> {
  try {
    const entries = Object.entries(map);
    if (entries.length > LOCAL_MAX_ENTRIES) {
      entries.sort((a, b) => b[1].savedAt - a[1].savedAt);
      map = Object.fromEntries(entries.slice(0, LOCAL_MAX_ENTRIES));
    }
    await AsyncStorage.setItem(LOCAL_PREFIX + ownerId, JSON.stringify(map));
  } catch {
    /* best-effort */
  }
}

// ───────── التحقق أن الرابط ما زال حيًّا ─────────
async function isAlive(url: string): Promise<boolean> {
  if (!/^https:\/\/res\.cloudinary\.com\//.test(url)) return false;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ALIVE_CHECK_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, { method: "HEAD", signal: ctrl?.signal });
    return res.status !== 404 && res.status !== 410; // أى رد آخر (حتى 401/403) = الملف موجود
  } catch {
    return true; // انقطاع/مهلة: لا نعتبره محذوفًا (الرفع نفسه كان سيفشل بلا اتصال)
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type FingerprintRow = {
  url: string; public_id: string; thumbnail_url: string | null; width: number | null; height: number | null;
  duration: number | null; format: string | null; bytes: number | null;
};

function rowToResult(r: FingerprintRow): CloudinaryUploadResult {
  return {
    url: r.url,
    publicId: r.public_id,
    width: r.width,
    height: r.height,
    duration: r.duration != null ? Number(r.duration) : null,
    thumbnailUrl: r.thumbnail_url,
    format: r.format ?? "",
    bytes: Number(r.bytes ?? 0),
  };
}

/** رفع سابق لنفس الملف من نفس المستخدم ما زال حيًّا، أو null. */
export async function findExistingUpload(ownerId: string, fp: Fingerprint): Promise<CloudinaryUploadResult | null> {
  const key = fpKey(fp);
  const local = await readLocal(ownerId);
  const hit = local[key];
  if (hit?.result?.url) {
    if (await isAlive(hit.result.url)) return hit.result;
    delete local[key];
    await writeLocal(ownerId, local);
  }
  try {
    const { data, error } = await supabase
      .from("media_fingerprints")
      .select("url, public_id, thumbnail_url, width, height, duration, format, bytes")
      .eq("owner_id", ownerId)
      .eq("kind", fp.kind)
      .eq("algo", fp.algo)
      .eq("content_hash", fp.hash)
      .eq("size_bytes", fp.size)
      .maybeSingle();
    if (error || !data) return null; // الجدول غير موجود (migration لم تُطبَّق) أو لا سجل: نرفع كالمعتاد
    const result = rowToResult(data as FingerprintRow);
    if (await isAlive(result.url)) {
      local[key] = { result, savedAt: Date.now() };
      await writeLocal(ownerId, local);
      return result;
    }
    await supabase.from("media_fingerprints").delete().eq("owner_id", ownerId).eq("kind", fp.kind).eq("algo", fp.algo).eq("content_hash", fp.hash).eq("size_bytes", fp.size);
    return null;
  } catch {
    return null;
  }
}

/** تسجيل رفع ناجح فورًا (جهاز + جدول) كى لا يُرفع الملف ثانيةً عند أى إعادة محاولة. */
export async function rememberUpload(ownerId: string, fp: Fingerprint, result: CloudinaryUploadResult): Promise<void> {
  const local = await readLocal(ownerId);
  local[fpKey(fp)] = { result, savedAt: Date.now() };
  await writeLocal(ownerId, local);
  try {
    await supabase.from("media_fingerprints").upsert(
      {
        owner_id: ownerId, kind: fp.kind, algo: fp.algo, content_hash: fp.hash, size_bytes: fp.size,
        url: result.url, public_id: result.publicId, thumbnail_url: result.thumbnailUrl,
        width: result.width, height: result.height, duration: result.duration, format: result.format, bytes: result.bytes,
      },
      { onConflict: "owner_id,kind,algo,content_hash,size_bytes", ignoreDuplicates: true }
    );
  } catch {
    /* best-effort: الذاكرة المحلية تكفى مؤقتًا */
  }
}

// ───────── نفس الملف يُرفع مرة واحدة حتى لو طُلب فى أكثر من حقل فى نفس الوقت ─────────
const inflight = new Map<string, Promise<CloudinaryUploadResult>>();

export function runDeduped(
  ownerId: string,
  fp: Fingerprint,
  doUpload: () => Promise<CloudinaryUploadResult>
): Promise<CloudinaryUploadResult> {
  const key = `${ownerId}|${fpKey(fp)}`;
  const running = inflight.get(key);
  if (running) return running.then((r) => ({ ...r, reused: true }));
  const p = (async () => {
    const hit = await findExistingUpload(ownerId, fp);
    if (hit) return { ...hit, reused: true };
    const result = await doUpload();
    await rememberUpload(ownerId, fp, result);
    return result;
  })();
  inflight.set(key, p);
  const clear = () => { inflight.delete(key); };
  p.then(clear, clear);
  return p;
}
