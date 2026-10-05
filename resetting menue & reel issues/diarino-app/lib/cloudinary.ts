import { Platform } from "react-native";

// ↔ Direct-from-device uploads to Cloudinary using the app's unsigned
// upload preset. Unsigned uploads only ever need the cloud name + the
// preset name — never the API key or (especially) the API secret, which
// must never be shipped inside client code. That's the whole point of
// configuring an upload preset on the Cloudinary dashboard: it lets the
// preset itself define what's allowed (folder, formats, size caps, auto
// moderation, etc.) so the app never has to hold real credentials.
//
// ↔ NOTE (Diarino → Baranda rename): left as "Diarino_uploads" on purpose
// — this string must match the preset name actually configured on the
// Cloudinary dashboard byte-for-byte, or every upload in the app breaks.
// Rename the preset on Cloudinary first, then update this constant to match.
const CLOUD_NAME = "ufz5snhv";

// ↔ preset منفصل لكل نوع (مهم جدًا): الـ preset "Diarino_uploads" عليه Incoming transformation للفيديو
// (c_limit,w_1280,h_1280,q_auto:good,vc_h264,f_mp4 — شوف docs/video-pipeline.md). التحويل ده بيسري على
// *أى* رفع بنفس الـ preset، فأى صورة بتترفع بيه بتتحوّل لملف .mp4 تالف بنوع "image" (رابط
// …/image/upload/….mp4 بيرجّع 400 وطوله 0) — وده سبب إعلانات/صور بتظهر سودا أو فاضية. فالصور بقت بتترفع
// بـ preset تاني بدون أى تحويل فيديو: "Diarino_images" (أنشئه Unsigned — docs/cloudinary-image-preset.md).
// الأسماء قابلة للتغيير من متغيرات البيئة: EXPO_PUBLIC_CLOUDINARY_IMAGE_PRESET / _VIDEO_PRESET.
const VIDEO_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_VIDEO_PRESET || "Diarino_uploads";
const IMAGE_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_IMAGE_PRESET || "Diarino_images";
// presets بديلة للصور لو الأساسى مش موجود (بتتجرّب بالترتيب)
const IMAGE_FALLBACK_PRESETS = ["ml_default"];

// ↔ أخطاء رفع معروفة بمعنى واضح للمستخدم/الأدمن (الواجهات بتعرض message كما هى).
export class CloudinaryUploadError extends Error {
  code: "image_preset_missing" | "image_preset_converts_to_video" | "video_as_image";
  constructor(code: CloudinaryUploadError["code"], message: string) {
    super(message);
    this.name = "CloudinaryUploadError";
    this.code = code;
  }
}

export type CloudinaryUploadResult = {
  url: string;
  publicId: string;
  width: number | null;
  height: number | null;
  duration: number | null; // seconds — videos only
  thumbnailUrl: string | null; // videos only, auto-derived
  format: string;
  bytes: number;
};

export const VIDEO_AS_IMAGE_MESSAGE = "الملف المختار فيديو وليس صورة — اختر صورة (JPG أو PNG).";
const IMAGE_PRESET_MISSING_MESSAGE = `preset رفع الصور «${IMAGE_PRESET}» غير موجود على Cloudinary. أنشئه (Unsigned وبدون أى Incoming transformation للفيديو) كما فى docs/cloudinary-image-preset.md ثم أعد المحاولة.`;
const IMAGE_PRESET_CONVERTS_MESSAGE = `الـ preset المستخدم لرفع الصور «${IMAGE_PRESET}» بيحوّل الصور إلى فيديو (mp4) — شيل منه الـ Incoming transformation الخاص بالفيديو (f_mp4/vc_h264) أو استخدم preset للصور بدونه (docs/cloudinary-image-preset.md).`;
const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "avi", "mkv", "3gp"];

// ↔ رابط ملف فيديو (حسب الامتداد) — بنستخدمه عشان نعرف إعلانات اتخزّنت بالغلط بفيديو بدل صورة.
export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = url.split("?")[0].toLowerCase();
  return VIDEO_EXTENSIONS.some((e) => path.endsWith("." + e));
}

// ↔ uploadToCloudinary() — picks a local file:// URI (from
// expo-image-picker) straight up to Cloudinary and returns duration +
// dimensions in the same response, so there's no separate "processing"
// step to poll for on the client.
//
// ⚠ Cloudinary لا بيضغط الفيديو تلقائيًا: الملف بيتخزّن (ويتعرض فى الريلز
// عبر secure_url) *بحجمه الأصلي* إلا لو الـ upload preset نفسه (Dashboard →
// Settings → Upload → Upload presets) فيه "Incoming transformation" للفيديو.
// الرفع غير الموقّع (unsigned) مينفعش يبعت transformation/eager من التطبيق،
// عشان كده الضبط ده لازم يتعمل على الـ preset. التفاصيل والقيم المقترحة فى
// docs/video-pipeline.md.
//
// onProgress (اختياري): نسبة الرفع 0..1 — بنستخدمه لمؤشر "رفع الفيديو". لما يتبعت
// بنرفع بـ XMLHttpRequest (الوحيد اللي بيدّي upload progress فى React Native
// والويب)؛ ولما مايتبعتش بنفضل على fetch زي الأول — فباقي الاستخدامات (صور
// البروفايل/الشات/الأدمن) متأثرتش.
export async function uploadToCloudinary(
  uri: string,
  type: "image" | "video",
  onProgress?: (ratio: number) => void
): Promise<CloudinaryUploadResult> {
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${type}/upload`;

  const filename = uri.split("/").pop() || `upload.${type === "video" ? "mp4" : "jpg"}`;
  const ext = (filename.split(".").pop() || (type === "video" ? "mp4" : "jpg")).toLowerCase();
  const mime = type === "video" ? `video/${ext}` : `image/${ext === "jpg" ? "jpeg" : ext}`;

  // ↔ بنجهّز الملف مرة واحدة، وبنبنى FormData جديد لكل محاولة preset (الملف على الويب Blob، وعلى الموبايل
  //   {uri,type,name} بيتبعت من الـ URI نفسه فى كل محاولة).
  let webBlob: Blob | null = null;
  let webName = "";
  if (Platform.OS === "web") {
    // ↔ إصلاح "Unsupported source URL: [object Object]" على الويب: صيغة {uri,type,name} خاصة بـ React Native فقط
    // — على الويب FormData بتحوّلها لنص "[object Object]" فكان Cloudinary يرفض *كل* رفع من الويب (صور الإعلانات،
    // الصور الشخصية، الشات، الفيديو...). على الويب لازم نبعت الملف نفسه كـ Blob: بنجيبه من blob:/data: URI
    // اللى بيرجّعه الـ picker، ونسمّيه بامتداد صحيح من نوعه الفعلى (الـ URI على الويب مالوش امتداد).
    webBlob = await (await fetch(uri)).blob();
    if (type === "image" && webBlob.type.startsWith("video/")) throw new CloudinaryUploadError("video_as_image", VIDEO_AS_IMAGE_MESSAGE);
    const blobExt = ((webBlob.type.split("/")[1] || (type === "video" ? "mp4" : "jpg")).split(";")[0] || "jpg").replace("jpeg", "jpg");
    webName = `upload-${Date.now()}.${blobExt}`;
  } else if (type === "image" && VIDEO_EXTENSIONS.includes(ext)) {
    // ↔ ملف فيديو اتختار كـ "صورة" (بعض المعارض بتسمح بده): بنرفضه بدل ما يتخزّن بامتداد mp4 ورابط
    // image/upload — ورابط زي ده Cloudinary بيرجّع 400 عند عرضه كصورة (إعلان بصورة سوداء).
    throw new CloudinaryUploadError("video_as_image", VIDEO_AS_IMAGE_MESSAGE);
  }

  const makeForm = (preset: string) => {
    const form = new FormData();
    if (webBlob) {
      form.append("file", webBlob, webName);
    } else {
      // React Native's fetch/FormData accepts this {uri,type,name} shape for
      // file fields — it streams the file instead of loading it into memory
      // as a blob first, which matters for multi-minute property videos.
      // @ts-ignore RN-specific FormData file value
      form.append("file", { uri, type: mime, name: filename });
    }
    form.append("upload_preset", preset);
    return form;
  };

  const send = async (preset: string) => {
    const form = makeForm(preset);
    if (onProgress) return await postFormWithProgress(endpoint, form, onProgress);
    const res = await fetch(endpoint, { method: "POST", body: form as unknown as BodyInit });
    return { ok: res.ok, json: await res.json() };
  };

  const isPresetMissing = (json: { error?: { message?: string } }) => {
    const msg = json?.error?.message || "";
    return /preset/i.test(msg) && /(not found|unknown|invalid|disabled)/i.test(msg);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isConvertedToVideo = (json: any) =>
    String(json?.format).toLowerCase() === "mp4" || /\.mp4(\?|$)/i.test(String(json?.secure_url));

  // ↔ الصور: preset الصور أولًا، ولو مش موجود أو بيحوّل الصور لفيديو نجرّب "ml_default" (preset Unsigned
  // افتراضى بيتعمل مع أى حساب Cloudinary) قبل ما نفشل برسالة واضحة. الفيديو: preset الفيديو بس.
  const presets = type === "image" ? [IMAGE_PRESET, ...IMAGE_FALLBACK_PRESETS.filter((p) => p !== IMAGE_PRESET)] : [VIDEO_PRESET];

  let ok = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  let lastFailure: "missing" | "converted" | "other" = "other";
  for (let i = 0; i < presets.length; i++) {
    ({ ok, json } = await send(presets[i]));
    const last = i === presets.length - 1;
    if (!ok) {
      if (type === "image" && isPresetMissing(json)) { lastFailure = "missing"; if (!last) continue; }
      else lastFailure = "other";
      break;
    }
    if (type === "image" && isConvertedToVideo(json)) {
      // ↔ صورة اتحوّلت لـ mp4 (preset عليه f_mp4) = ملف تالف مش هيتعرض أبدًا — منحفظش رابطه.
      lastFailure = "converted"; ok = false;
      if (!last) continue;
      break;
    }
    break;
  }
  if (!ok) {
    if (lastFailure === "missing") throw new CloudinaryUploadError("image_preset_missing", IMAGE_PRESET_MISSING_MESSAGE);
    if (lastFailure === "converted") throw new CloudinaryUploadError("image_preset_converts_to_video", IMAGE_PRESET_CONVERTS_MESSAGE);
    throw new Error(json?.error?.message || "تعذر الرفع إلى Cloudinary");
  }

  return {
    url: json.secure_url,
    publicId: json.public_id,
    width: json.width ?? null,
    height: json.height ?? null,
    duration: json.duration ?? null,
    thumbnailUrl: type === "video" ? cldVideoThumbnail(json.secure_url) : null,
    format: json.format,
    bytes: json.bytes,
  };
}

// ↔ POST لـ FormData مع تقدم الرفع (XHR). بيحل على أي status (بيرجّع ok + json) وبيرفض
// بس لو الاتصال نفسه اتقطع — نفس عقد fetch+res.json() اللي فوق.
function postFormWithProgress(
  endpoint: string,
  form: FormData,
  onProgress: (ratio: number) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ ok: boolean; json: any }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    if (xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let json: any = null;
      try { json = JSON.parse(xhr.responseText); } catch { /* رد مش JSON */ }
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (ok) onProgress(1);
      resolve({ ok, json });
    };
    xhr.onerror = () => reject(new Error("انقطع الاتصال أثناء الرفع"));
    xhr.ontimeout = () => reject(new Error("انتهت مهلة الرفع"));
    xhr.onabort = () => reject(new Error("تم إلغاء الرفع"));
    xhr.send(form as unknown as XMLHttpRequestBodyInit);
  });
}

// ↔ "عند عرض صورة: استخدم w_800,q_auto,f_auto" — inserts a Cloudinary
// delivery transformation right after /upload/ in a secure_url so the
// CDN serves an already-compressed, format-optimized version sized for
// how it's actually displayed, instead of the original upload. Only
// touches real Cloudinary URLs; anything else (older Supabase Storage
// URLs from before this, local file:// previews) passes through as-is.
export function cldOptimized(url: string | null | undefined, transform = "w_800,q_auto,f_auto"): string {
  if (!url) return "";
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  // ↔ لو الرابط فيه تحويل مخزّن قبل كده (مثلاً قص الإعلان c_crop,... من لوحة الأدمن)،
  // تحويل العرض لازم يتحط *بعده* مش قبله — تحويلات Cloudinary بتتنفّذ بالترتيب
  // (قص إحداثيات الصورة الأصلية الأول، وبعدين تصغير). التحويلات المخزّنة بتكون قبل
  // جزء النسخة v123. من غير تحويلات مخزّنة السلوك زي الأول بالظبط.
  const marker = "/upload/";
  const i = url.indexOf(marker) + marker.length;
  const head = url.slice(0, i);
  const segs = url.slice(i).split("/");
  const v = segs.findIndex((s) => /^v\d+$/.test(s));
  segs.splice(v > 0 ? v : 0, 0, transform);
  return head + segs.join("/");
}

// ↔ قص صورة Cloudinary بإحداثيات نسبية (0..1 من عرض/ارتفاع الصورة): بنحوّلها لبكسلات
// على أبعاد الصورة المرفوعة ونخزّن رابط فيه تحويل c_crop — فالقص بيتطبّق عند العرض
// على كل المنصات (أندرويد/آيفون/ويب/APK) من غير أي مكتبة native، والصورة الأصلية
// كاملة فاضلة على Cloudinary. بيرجّع الرابط + أبعاد المقصوص بالبكسل.
export function cldCrop(
  url: string,
  rect: { x: number; y: number; w: number; h: number },
  srcW: number,
  srcH: number
): { url: string; width: number; height: number } {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  // ↔ لو القص بيغطّى الصورة كلها تقريبًا (الصورة أصلًا بنسبة المساحة ومن غير تكبير) مفيش داعى
  // لتحويل c_crop خالص — بنستخدم رابط الصورة الأصلى زي ما هو (أضمن وأخف، وما بيعتمدش على
  // السماح بتحويلات مخصّصة فى حساب Cloudinary).
  if (rect.w >= 0.995 && rect.h >= 0.995) return { url, width: srcW, height: srcH };
  const w = clamp(Math.round(rect.w * srcW), 1, srcW);
  const h = clamp(Math.round(rect.h * srcH), 1, srcH);
  const x = clamp(Math.round(rect.x * srcW), 0, srcW - w);
  const y = clamp(Math.round(rect.y * srcH), 0, srcH - h);
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return { url, width: w, height: h };
  return {
    url: url.replace("/upload/", `/upload/c_crop,g_north_west,x_${x},y_${y},w_${w},h_${h}/`),
    width: w,
    height: h,
  };
}

// ↔ a thumbnail transformation for grids/lists, where 800px is overkill.
export function cldThumbnail(url: string | null | undefined): string {
  return cldOptimized(url, "w_400,h_400,c_fill,q_auto,f_auto");
}

// ↔ derives a poster-frame JPEG from a Cloudinary video URL (frame at
// 0s) — used both for the upload-result thumbnail below and, since it's
// a pure URL transform with no extra network round-trip, to show a
// static poster for reel cards that aren't near the active one instead
// of mounting a real <Video> player for every item (see ReelCard.tsx).
export function cldVideoThumbnail(videoUrl: string): string {
  return videoUrl
    .replace("/video/upload/", "/video/upload/so_0/")
    .replace(/\.\w+$/, ".jpg");
}

// ↔ صورة "بوستر" الريل (أول إطار) بحجم وجودة مناسبين للعرض فقط: w_720 +
// q_auto بدل الإطار الكامل بدقة الفيديو الأصلية (ممكن يبقى مئات الكيلوبايت)،
// فبتتحمّل وتتخزّن أسرع بكتير. بتتعرض فوق الفيديو لحد ما أول إطار يشتغل
// فعليًا (ReelCard.tsx) وبتتحمّل مسبقًا للريلز الجاية (lib/reelPrefetch.ts)
// — فالتنقل بين الريلز مفيهوش شاشة سوداء ولا انتظار.
export function cldReelPoster(videoUrl: string): string {
  return videoUrl
    .replace("/video/upload/", "/video/upload/so_0,w_720,c_limit,q_auto/")
    .replace(/\.\w+$/, ".jpg");
}

// ↔ إصلاح "كروت العقارات (نتائج البحث، وقايمة إعلانات صفحة المعلن) بتعرض
// تدرّج لوني بدل صورة حقيقية": ترتيب أولويات لاختيار صورة فعلية للكارت
// — صورة الغلاف اللي رفعها المعلن، وإلا أول صورة فعلية من الوسائط، وإلا
// لقطة حقيقية من الريل نفسه (نفس طريقة بوستر الريل فى ReelCard.tsx).
// التدرّج اللوني (ReelBackground) بيفضل بس كبديل احتياطي للحالة النادرة
// إن الإعلان من غير أي صورة أو فيديو خالص. مركزّة هنا (مش مكررة فى كل
// شاشة) عشان أي كارت عقار جديد فى المستقبل ياخد نفس السلوك تلقائيًا.
export function cardThumbnailUrl(item: { coverImage: string | null; media: { type: string; url: string }[] }): string | null {
  if (item.coverImage) return cldThumbnail(item.coverImage);
  const firstImage = item.media?.find((m) => m.type === "image");
  if (firstImage) return cldThumbnail(firstImage.url);
  const firstVideo = item.media?.find((m) => m.type === "video");
  if (firstVideo) return cldVideoThumbnail(firstVideo.url);
  return null;
}

// ↔ بيشيل تحويل القص (c_crop,...) المخزّن فى رابط الإعلان ويرجّع رابط الصورة الأصلية المرفوعة —
// بنستخدمه كخط رجوع لو تحميل نسخة المقصوصة فشل لأى سبب (قيود Cloudinary مثلًا).
export function cldStripCrop(url: string | null | undefined): string {
  if (!url) return "";
  return url.replace(/\/upload\/c_crop,[^/]+\//, "/upload/");
}

// ↔ روابط مرشّحة لعرض صورة إعلان بترتيب الأفضلية (يتجرّب واحد واحد لحد ما يشتغل — شوف
// components/shared/CascadeImage.tsx): النسخة المقصوصة بعرض مناسب، بالتحويل المعتاد w_800، الرابط كما هو،
// وبعدها الأصل بدون قص. ولو الرابط لملف فيديو اتخزّن بالغلط (…/image/upload/….mp4 — Cloudinary بيرجّع 400)
// بنجرّب الأول لقطة poster من الفيديو (…/video/upload/so_0,…/….jpg).
export function cldImageCandidates(url: string | null | undefined, width = 1200): string[] {
  if (!url) return [];
  const base = cldStripCrop(url);
  const list: string[] = [];
  if (isVideoUrl(url)) {
    const poster = base
      .replace("/image/upload/", "/video/upload/")
      .replace("/video/upload/", `/video/upload/so_0,w_${width},q_auto,f_jpg/`)
      .replace(/\.[a-z0-9]+(\?.*)?$/i, ".jpg");
    list.push(poster);
  }
  if (isVideoUrl(url)) return list.filter((v, i) => !!v && list.indexOf(v) === i); // الباقى كان بيرجّع 400 دايمًا
  list.push(
    cldOptimized(url, `w_${width},q_auto,f_auto`),
    cldOptimized(url, "w_800,q_auto,f_auto"),
    url,
    cldOptimized(base, "w_800,q_auto,f_auto"),
    base
  );
  return list.filter((v, i) => !!v && list.indexOf(v) === i);
}
