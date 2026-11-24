# تنظيف ملفات Cloudinary اليتيمة

الهدف: لا تبقى صور/فيديوهات/صوتيات على Cloudinary بعد حذف أو تعديل ما يرتبط بها (تستهلك Storage وBandwidth دون داعٍ).

## كيف يعمل
1. **الالتقاط (قاعدة البيانات):** migration `20261121000200_cloudinary_cleanup_queue.sql` تضع triggers على الجداول التى تحمل روابط Cloudinary
   (`properties.media/cover_image` — كل الصور والفيديوهات، `profiles.avatar_url`, `music_tracks.url`, `ad_banners`, `ad_space_orders`, `menu_items`,
   `lives.poster_url`, `chat_messages.images`). عند **حذف** السجل أو **استبدال** ملف فيه، تُدخل الروابط القديمة (resource_type + public_id مستخرجَين من الرابط)
   فى `cloudinary_cleanup_queue` داخل نفس المعاملة. فحذف الإعلان/الحساب/المقطع لا يفشل أبدًا بسبب Cloudinary، ويغطى كل المسارات (التطبيق، الأدمن، cascade عند حذف الحساب).
2. **الحذف الفعلى (الخادم):** Edge Function `cloudinary-cleanup` (mode `process`) تأخذ دفعة من الطابور (مستحقة **فورًا** منذ migration 20261121000300؛ وعند حذف المستخدم إعلانه يستدعى التطبيق mode `process_own` فتُحذف صور وفيديوهات إعلانه فورًا، وإلا تلتقطها الجدولة)، وتتحقق أن الملف **غير مستخدم**
   فى أى سجل نشط (يحمى الملفات المعاد استخدامها بمنع التكرار أو المشتركة)، ثم `destroy` (مع invalidate). خطأ مؤقت ⇒ إعادة محاولة بتأخير متصاعد (حتى 8 مرات)
   مع تسجيل `last_error`. بعد الحذف تُزال بصمات منع التكرار وسجل `media` للملف.
3. **اليتامى السابقة وفشل الحفظ:** mode `scan` يقارن سجل الرفع (`media_fingerprints` + `media`) بالسجلات النشطة، ويعرض/يُدخل للطابور كل ملف رُفع ولم يعد
   له سجل بعد **24 ساعة على الأقل** (فملف قيد الرفع أو الحفظ لا يُمَس). **معاينة dryRun افتراضيًا.** رفع نجح ثم فشل حفظ الإعلان ⇒ تُحتفظ البصمة لإعادة
   المحاولة الذكية (يُعاد استخدام الملف بلا رفع)، وإن لم يُحفظ خلال 24 ساعة يُحذف كيتيم.

## النشر
```bash
supabase db push                                  # 20261121000100 (بصمات) + 20261121000200 (طابور الحذف)
supabase functions deploy cloudinary-cleanup      # verify_jwt=false مضبوط فى config.toml (الدالة تتحقق بنفسها)
supabase secrets set CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=... CLEANUP_CRON_SECRET=<سر طويل عشوائى>
```
> `CLOUDINARY_API_SECRET` لا يوضع إلا هنا (أسرار Supabase)، لا فى التطبيق ولا فى أى متغير `EXPO_PUBLIC_*`.

## التشغيل
* **من لوحة الأدمن (المشرف الرئيسى):** صفحة «🧹 تنظيف Cloudinary»: إحصاءات الطابور، «تشغيل التنظيف الآن»، «فحص ومعاينة» ثم «إضافة اليتامى لقائمة الحذف» (بتأكيد).
* **سكربت:** `SUPABASE_URL=... CLEANUP_CRON_SECRET=... node scripts/cloudinary-cleanup.mjs stats|process|scan [--queue]`.
* **تلقائيًا (موصى به)** — فى SQL Editor (يتطلب تفعيل الامتدادين pg_cron وpg_net):
```sql
select cron.schedule('cloudinary-cleanup-process', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/cloudinary-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cleanup-secret', '<CLEANUP_CRON_SECRET>'),
    body := jsonb_build_object('mode', 'process', 'limit', 50));
$$);
select cron.schedule('cloudinary-cleanup-orphans', '30 3 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/cloudinary-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cleanup-secret', '<CLEANUP_CRON_SECRET>'),
    body := jsonb_build_object('mode', 'scan', 'source', 'ledger', 'dryRun', false));
$$);
```
  (الفحص الليلى يُدخل اليتامى من سجل الرفع للطابور فقط؛ الحذف الفعلى يتم فى معالجة الـ 15 دقيقة مع إعادة التحقق من الاستخدام.)

## ملاحظات أمان
* لا تُحذف ملفات من حساب Cloudinary آخر (الدالة تتخطى أى رابط لا يطابق `CLOUDINARY_CLOUD_NAME`).
* الفحص بسرد Cloudinary مباشرة (`source:"cloudinary"`) يتطلب `prefix` صريحًا ومعاينة أولًا وتأكيد `DELETE` من المشرف الرئيسى — حتى لا تُحذف أصول رُفعت يدويًا من لوحة Cloudinary.
* ملفات التسجيل المباشر (`lives.recording_url`) فى Supabase Storage وليست على Cloudinary ولا تتأثر.
* الملفات التى رُفعت قبل هذا التحديث ولم تُسجَّل بصمتها لا يلتقطها فحص السجل؛ استخدم السرد بـ `prefix` (معاينة ثم تأكيد).
