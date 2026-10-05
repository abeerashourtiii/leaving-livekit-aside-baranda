# إصلاح: الصور بتتحوّل لـ mp4 على Cloudinary (إعلانات/صور سودا)

## المشكلة
الـ preset `Diarino_uploads` عليه Incoming transformation للفيديو:

    c_limit,w_1280,h_1280,q_auto:good,vc_h264,f_mp4

(من `docs/video-pipeline.md`). Cloudinary بيطبّقه على **كل** رفع بنفس الـ preset — فأى **صورة** بتترفع بيه
بتتخزّن كملف `….mp4` تالف بنوع image: الرابط `…/image/upload/….mp4` بيرجّع **400** وحجمه **0** — فالصورة
بتظهر سودا/فاضية فى الإعلانات وأى مكان تانى. (الأصل بيضيع، فلازم الصورة تتحذف وتترفع من جديد.)

## الحل (مرة واحدة — Cloudinary Dashboard)
1. **Settings → Upload → Upload presets → Add upload preset**
2. الاسم: **`Diarino_images`** (بالظبط، حساس لحالة الأحرف) — أو أى اسم تانى وتحطه فى
   `EXPO_PUBLIC_CLOUDINARY_IMAGE_PRESET`.
3. **Signing mode: Unsigned**.
4. **Incoming transformation: سيبه فاضى** (أو للتصغير الآمن للصور فقط: `c_limit,w_2000,h_2000,q_auto`).
   **ممنوع** `f_mp4` / `vc_h264` / أى حاجة للفيديو.
5. (اختياري) Asset folder: `images`. Allowed formats: `jpg,png,webp,gif,heic`. Save.
6. سيب `Diarino_uploads` زي ما هو للفيديو (الضغط اللى ضبطته للريلز يفضل شغال) — التطبيق بقى يرفع الصور
   بـ `Diarino_images` والفيديو بـ `Diarino_uploads`.

## ملاحظة: بديل تلقائى
لو `Diarino_images` غير موجود (أو بيحوّل الصور لفيديو) التطبيق بيجرّب تلقائيًا الـ preset الافتراضى `ml_default`
(Unsigned وبيتعمل مع معظم حسابات Cloudinary) قبل ما يفشل برسالة واضحة. لكن الأفضل تنشئ `Diarino_images`.

## بعد كده
* احذف الإعلانات/الصور القديمة اللى رابطها بينتهى بـ `.mp4` وارفعها من جديد (لوحة الأدمن بتعلّم الإعلان
  التالف بـ ⚠).
* لو التطبيق قال «preset رفع الصور … غير موجود» → الاسم فى الخطوة 2 مش مطابق.
* لو قال «بيحوّل الصور إلى فيديو» → الـ preset فيه f_mp4 لسه.
