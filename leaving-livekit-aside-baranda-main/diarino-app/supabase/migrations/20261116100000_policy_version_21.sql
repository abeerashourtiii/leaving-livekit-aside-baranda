-- إصدار السياسات 21: يجب تطبيق هذا الملف قبل نشر أى بناء (ويب/APK/آيفون) يرسل POLICIES_VERSION = '21'،
-- وإلا يرفض trigger الـ profiles إقرار السياسات (جدول policy_versions: B3أ). الإصدار 20 يبقى مقبولًا لنسخ التطبيق القديمة.
-- قابل لإعادة التشغيل.
insert into public.policy_versions (version) values ('21') on conflict do nothing;
