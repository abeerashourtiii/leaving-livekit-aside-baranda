# إعداد Cloudinary للمكتبة الموسيقية

المقاطع الموسيقية للإعلانات (لوحة الأدمن ← «المكتبة الموسيقية») بتترفع على Cloudinary، مش على Supabase Storage.
جدول `public.music_tracks` فى Supabase فيه بيانات وصفية بس (الاسم، الوصف، الرابط، المدة).

## 1) preset الرفع (مرة واحدة)
Cloudinary ← Settings ← Upload ← Upload presets ← Add upload preset:
- **Preset name:** `Diarino_music` (أو غيّره بمتغير `EXPO_PUBLIC_CLOUDINARY_MUSIC_PRESET`)
- **Signing mode:** Unsigned
- **Incoming transformation:** *بدون* (لا تضع تحويلات الفيديو 720p هنا — ده ملف صوت)
- **Folder (اختياري):** `diarino/music`

لو الـ preset مش موجود التطبيق بيجرّب preset الفيديو `Diarino_uploads` تلقائيًا، لكن الأفضل preset مخصص للصوت.

## 2) الضغط
الملف الأصلى بيتخزّن زى ما اترفع، وبيتسلّم للمستخدمين مضغوطًا وقت العرض بتحويل فى الرابط:
`.../video/upload/br_96k/<id>.mp3` (mp3 بمعدل 96kbps — مناسب لموسيقى خلفية وأصغر بكتير من الأصل).
لو التحويل فشل (مثلًا Strict transformations مفعّلة) المشغّل بيرجع تلقائيًا للرابط الأصلى. تأكد إن
**Settings ← Security ← Restricted media types / Strict transformations** لا تمنع تحويلات الصوت (أو أضف `br_96k` للمسموح).

## 3) الحذف
حذف مقطع من اللوحة بيشيله من المكتبة بس. الملف نفسه بيفضل فى Cloudinary Media Library (احذفه من هناك لو عايز تحرر المساحة).

## 4) اختيار الملفات من لوحة الأدمن
- **الويب:** شغّال مباشرة.
- **أندرويد/آيفون:** يحتاج مكتبة `expo-document-picker` (اتضافت لـ package.json): نفّذ `npm install` ثم build جديد للتطبيق.
  فى نسخة قديمة مبنيّة من غيرها، اللوحة بتطلب منك الرفع من الويب (التطبيق ما بينهارش).
