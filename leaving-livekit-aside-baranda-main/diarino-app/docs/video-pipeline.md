# مراجعة مسار رفع/عرض الفيديو (سرعة الريلز)

## الوضع الحالي
1. **الاختيار** (`app/publish/create-listing.tsx → pickVideo`): كان `quality: 0.8` فقط،
   وده بيأثر على الصور مش الفيديو ← الفيديو بيتاخد **بحجمه الأصلي** من الكاميرا.
2. **الرفع** (`lib/cloudinary.ts → uploadToCloudinary`): رفع مباشر بـ unsigned preset
   `Diarino_uploads`. الرفع غير الموقّع **مينفعش** يبعت `transformation`/`eager`، فأي
   ضغط لازم يبقى داخل الـ preset نفسه على لوحة Cloudinary.
3. **العرض** (`components/reel/ReelVideoPlayer.tsx`): بيشغّل `video.url` (= `secure_url`
   الأصلي) تحميل تدريجي مباشر. لو الملف كبير أو الـ moov atom فى آخره (شائع فى
   فيديوهات أندرويد)، البداية بتبطأ مهما حسّنّا الكود.
4. **حد المدة**: 5 دقايق (`MAX_VIDEO_SEC`) — طويل جدًا للريلز.

## اللي اتعدّل فى التطبيق (آمن، من غير مكتبات جديدة)
* **iOS**: `videoExportPreset: H264_1280x720` — الفيديو بيتعاد ترميزه لـ 720p H.264
  وقت الاختيار (أصغر حجمًا وأسرع فى البداية). أندرويد/ويب بيتجاهلوا الخيار.
* تصحيح تعليق `uploadToCloudinary` (كان بيقول إن Cloudinary بيضغط تلقائيًا، وده غلط).

## اللي محتاج قرار/إعداد (الأهم لأندرويد وللفيديوهات الموجودة)
### 1) Incoming transformation على الـ preset (موصى به — من غير أي تعديل كود)
Cloudinary Dashboard → Settings → Upload → Upload presets → `Diarino_uploads` → Edit →
Upload manipulations → **Incoming transformation** (Edit):

    c_limit,w_1280,h_1280,q_auto:good,vc_h264,f_mp4

(أطول ضلع 1280 مع الحفاظ على النسبة، H.264، جودة تلقائية، MP4 — وبيتعمل faststart
تلقائيًا فالتشغيل بيبدأ بسرعة). ده بيسري على **الرفعات الجديدة** فقط؛ الفيديوهات
القديمة تفضل بحجمها الأصلي. لاحظ: الفيديو بيتعالج وقت الرفع فوقت الرد ممكن يزيد شوية،
وبيستهلك من رصيد التحويلات (Credits) — راجع خطتك.

### 2) ضغط داخل التطبيق قبل الرفع (لأندرويد)
يحتاج مكتبة أصلية (مثلًا `react-native-compressor`) = `npm install` + **إعادة بناء**
الـ APK/iOS، ومتنفّذش على الويب. مش متضاف حاليًا عشان ما أكسرش البناء من غير اختبار.
تقدر تطلب إضافته كخطوة منفصلة.

### 3) حدود مقترحة (قرار منتج)
* تقليل `MAX_VIDEO_SEC` من 300 لـ 90–120 ثانية (الريلز القصيرة أسرع وأخف).
* حد حجم للفيديو قبل الرفع (مثلًا 100 ميجا لو خطة Cloudinary المجانية — سقف الفيديو
  المجاني 100MB) عشان الرفع ما يفشل بعد دقايق طويلة.

## قياس الوضع الفعلي (Supabase → SQL Editor)
كل رفع بيتسجّل فى `public.media` (الحجم، المدة، الأبعاد):

    select
      count(*)                                                    as videos,
      round(avg(bytes) / 1048576.0, 1)                            as avg_mb,
      round(max(bytes) / 1048576.0, 1)                            as max_mb,
      round(avg(duration))                                        as avg_sec,
      round(avg(bytes * 8 / nullif(duration, 0)) / 1000000.0, 1)  as avg_mbps,
      round(avg(greatest(width, height)))                         as avg_long_side_px
    from public.media
    where type = 'video' and context = 'property';

المرجع: ريل 720p صحي ≈ **1.5–3 Mbps** (≈ 10–20MB لدقيقة). لو `avg_mbps` أعلى من ~8 أو
`avg_long_side_px` ≥ 1920 فالفيديوهات بتترفع بدون ضغط، ودي على الأرجح سبب بطء بدء
التشغيل الأكبر.

## تحديث: القرارات المنفّذة
* Incoming transformation على `Diarino_uploads`: `c_limit,w_1280,h_1280,q_auto:good,vc_h264,f_mp4` (تم).
* نتيجة القياس (فيديوهين فقط وقتها): متوسط 1.1MB، 1.0 Mbps، أطول ضلع 771px — يعني الرفعات
  السابقة كانت خفيفة أصلًا؛ العيّنة صغيرة، فأعد الاستعلام لما تتجمّع فيديوهات أكتر.
* حد المدة: **180 ثانية** (`MAX_VIDEO_SEC` فى `app/publish/create-listing.tsx`).
* حد الحجم: **600MB** قبل الرفع (`MAX_VIDEO_BYTES`) — اتعدّل من 100MB بقرار المنتج.
  ⚠ لازم سقف فيديو خطتك على Cloudinary يغطي الرقم ده (الخطة المجانية = 100MB)، وجرّب
  رفع فيديو ~150–300MB فعليًا: الرفع الحالي طلب POST واحد (`FormData`) بدون مهلة ولا
  إعادة محاولة، وعلى شبكة موبايل ممكن يفشل/ينقطع. لو ظهرت مشاكل: chunked upload
  (`X-Unique-Upload-Id` + `Content-Range`) أو ضغط داخل التطبيق قبل الرفع. القديم: **100MB** — أندرويد/آيفون فقط (على الويب
  `fileSize` ممكن يبقى غير متاح فبيتخطى الفحص).

## تحديث: ضغط محلي على أندرويد (react-native-compressor)
* مُضاف فى `lib/videoCompress.ts` + مؤشر تقدّم (`UploadProgressModal`) + رفع بتقدّم فعلي.
* الإعدادات: أطول ضلع 1280، معدل بت مستهدف = الأقل بين 3Mbps و80% من معدل الأصل، ومبيضغطش
  الفيديو لو أصلًا ≤1280px وبمعدل ≤4Mbps. أندرويد فقط؛ آيفون بيضغط فى الـ picker.
* **خطوات التركيب:** `npm install` ثم commit لـ `package-lock.json`، وبعدين Build أصلي جديد
  (التغيير فى package.json بيحتاج بناء — مش بيوصل بـ OTA).
* لو فشل الضغط أو المكتبة مش متركّبة: بيترفع الفيديو الأصلي (مع رسالة قصيرة) — مفيش تعطيل.
