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
  width: number | null;
  height: number | null;
  duration: number | null; // seconds — videos only
  thumbnailUrl: string | null; // videos only, auto-derived
  format: string;
  bytes: number;
};

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

  const form = new FormData();
  // React Native's fetch/FormData accepts this {uri,type,name} shape for
  // file fields — it streams the file instead of loading it into memory
  // as a blob first, which matters for multi-minute property videos.
  // @ts-ignore RN-specific FormData file value
  form.append("file", { uri, type: mime, name: filename });
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
  return url.replace("/upload/", `/upload/${transform}/`);
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
