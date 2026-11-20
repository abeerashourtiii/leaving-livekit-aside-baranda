-- supabase/migrations/20261008000000_publish_listings_immediately.sql
--
-- المشكلة: الإعلان الجديد كان يُحفظ بحالة 'pending' (20260907000000) وسياسة
-- RLS "approved properties are public, own listings always visible" تخفيه عن
-- أى حساب غير صاحبه والأدمن، فلا يظهر لباقى المستخدمين.
--
-- الإصلاح: النشر فورى لكل المستخدمين. الأدمن يظل قادرًا على رفض/إخفاء أى
-- إعلان لاحقًا من شاشة إدارة الإعلانات (moderation_status = 'rejected')
-- وعندها فقط يختفى عن الجميع ما عدا صاحبه والأدمن.

-- 1) الإعلانات الجديدة تُنشر مباشرة.
alter table public.properties
  alter column moderation_status set default 'approved';

comment on column public.properties.moderation_status is
  'approved افتراضيًا: الإعلان يظهر للجميع فور النشر. الأدمن يقدر يغيّره إلى rejected لإخفاء الإعلان (RLS: approved أو صاحبه أو الأدمن).';

-- 2) الإعلانات العالقة فى pending تُنشر الآن (المرفوضة تبقى مرفوضة).
update public.properties
   set moderation_status = 'approved'
 where moderation_status = 'pending';
