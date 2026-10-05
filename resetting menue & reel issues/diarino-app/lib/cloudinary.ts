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
const UPLOAD_PRESET = "Diarino_uploads";

export type CloudinaryUploadResult = {
  url: string;
  publicId: string;
  resourceType: "image" | "video";
  width: number | null;
  height: number | null;
  duration: number | null; // seconds — videos only
  thumbnailUrl: string | null; // videos only, auto-derived
  format: string;
  bytes: number;
};

export const VIDEO_AS_IMAGE_MESSAGE = "الملف المختار فيديو وليس صورة — اختر صورة (JPG أو PNG).";
const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "avi", "mkv", "3gp"];

// ↔ يفضّل نوع مورد Cloudinary على الامتداد؛ الامتداد وحده قد يكون خاطئًا.
export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = url.split("?")[0].toLowerCase();
  const cloudinaryResourceType = path.match(/\/(image|video)\/upload\//)?.[1];
  if (cloudinaryResourceType) return cloudinaryResourceType === "video";
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
  onProgress?: (ratio: number) => void,
  sourceMimeType?: string | null
): Promise<CloudinaryUploadResult> {
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${type}/upload`;

  const uriFilename = uri.split(/[?#]/)[0].split("/").pop() || `upload.${type === "video" ? "mp4" : "jpg"}`;
  const originalFilename = uriFilename;
  const originalExt = (originalFilename.split(".").pop() || (type === "video" ? "mp4" : "jpg")).toLowerCase();
  const normalizedSourceMime = sourceMimeType?.split(";")[0].trim().toLowerCase();
  if (type === "image" && normalizedSourceMime?.startsWith("video/")) {
    throw new Error(VIDEO_AS_IMAGE_MESSAGE);
  }
  const sourceImageMime = type === "image" && normalizedSourceMime && /^image\/[a-z0-9.+-]+$/.test(normalizedSourceMime)
    ? normalizedSourceMime
    : null;
  if (type === "image" && !sourceImageMime && VIDEO_EXTENSIONS.includes(originalExt)) {
    throw new Error(VIDEO_AS_IMAGE_MESSAGE);
  }
  const ext = type === "image" ? "jpg" : originalExt;
  const filename = type === "image"
    ? `${originalFilename.replace(/\.[^.]+$/, "")}.jpg`
    : originalFilename;
  const mime = type === "video"
    ? `video/${ext}`
    : sourceImageMime
      ? sourceImageMime
      : "image/jpeg";

  const form = new FormData();
  if (Platform.OS === "web") {
    // ↔ إصلاح "Unsupported source URL: [object Object]" على الويب: صيغة {uri,type,name} خاصة بـ React Native فقط
    // — على الويب FormData بتحوّلها لنص "[object Object]" فكان Cloudinary يرفض *كل* رفع من الويب (صور الإعلانات،
    // الصور الشخصية، الشات، الفيديو...). على الويب لازم نبعت الملف نفسه كـ Blob: بنجيبه من blob:/data: URI
    // اللى بيرجّعه الـ picker، ونسمّيه بامتداد صحيح من نوعه الفعلى (الـ URI على الويب مالوش امتداد).
    const blob = await (await fetch(uri)).blob();
    const blobMime = blob.type || normalizedSourceMime || "";
    if (type === "image" && blobMime.startsWith("video/")) throw new Error(VIDEO_AS_IMAGE_MESSAGE);
    const blobExt = ((blobMime.split("/")[1] || (type === "video" ? "mp4" : "jpg")).split(";")[0] || "jpg").replace("jpeg", "jpg");
    form.append("file", blob, `upload-${Date.now()}.${type === "image" ? "jpg" : blobExt}`);
  } else {
    // React Native's fetch/FormData accepts this {uri,type,name} shape for
    // file fields — it streams the file instead of loading it into memory
    // as a blob first, which matters for multi-minute property videos.
    // @ts-ignore RN-specific FormData file value
    form.append("file", { uri, type: mime, name: filename });
  }
  form.append("upload_preset", UPLOAD_PRESET);

  let ok: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  if (onProgress) {
    ({ ok, json } = await postFormWithProgress(endpoint, form, onProgress));
  } else {
    const res = await fetch(endpoint, { method: "POST", body: form as unknown as BodyInit });
    json = await res.json();
    ok = res.ok;
  }
  if (!ok) throw new Error(json?.error?.message || "تعذر الرفع إلى Cloudinary");
  if (json.resource_type !== type) {
    throw new Error("نوع الملف المرفوع لا يطابق نوع المورد الذي أعاده Cloudinary");
  }

  return {
    url: json.secure_url,
    publicId: json.public_id,
    resourceType: json.resource_type,
    width: json.width ?? null,
    height: json.height ?? null,
    duration: json.duration ?? null,
    thumbnailUrl: json.resource_type === "video" ? cldVideoThumbnail(json.secure_url) : null,
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
// وبعدها الأصل بدون قص. لقطة الفيديو تتولد فقط عندما يحدد مسار Cloudinary أن المورد فيديو،
// وليس بناءً على امتداد قد يكون غير صحيح في الرابط.
export function cldImageCandidates(url: string | null | undefined, width = 1200): string[] {
  if (!url) return [];
  const base = cldStripCrop(url);
  const list: string[] = [];
  if (url.includes("res.cloudinary.com") && /\/video\/upload\//.test(url)) {
    const poster = base
      .replace("/video/upload/", `/video/upload/so_0,w_${width},q_auto,f_jpg/`)
      .replace(/\.[a-z0-9]+(\?.*)?$/i, ".jpg");
    list.push(poster);
  }
  list.push(
    cldOptimized(url, `w_${width},q_auto,f_auto`),
    cldOptimized(url, "w_800,q_auto,f_auto"),
    url,
    cldOptimized(base, "w_800,q_auto,f_auto"),
    base
  );
  return list.filter((v, i) => !!v && list.indexOf(v) === i);
}
