-- إصدار السياسات 22 (حد الريلز 20 + الباقات الشهرية + حذف الإعلان فى أى وقت + حذف الوسائط من Cloudinary + منع تكرار الرفع):
-- يجب تطبيق هذا الملف قبل نشر أى بناء (ويب/APK/آيفون) يرسل POLICIES_VERSION = '22'، وإلا يرفض trigger الـ profiles إقرار السياسات
-- (جدول policy_versions: B3أ). الإصدار 21 يبقى مقبولًا لنسخ التطبيق القديمة. قابل لإعادة التشغيل.
insert into public.policy_versions (version) values ('22') on conflict do nothing;
