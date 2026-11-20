-- A4) حملة الريل المميز لازم يكون لها حد واحد على الأقل: هدف وصول أو تاريخ انتهاء (حتى لا تعمل بلا نهاية).
-- NOT VALID: يُطبَّق على الكتابات الجديدة فقط ولا يفشل بسبب صفوف قديمة (استعلم عنها ثم VALIDATE: supabase/verification/pre-deploy-checks.sql §7).
-- تفعيل الترويج المدفوع يضبط end_date دائمًا (start + duration) فلا يتأثر. إضافى. قابل لإعادة التشغيل.
alter table public.sponsored_reels drop constraint if exists sponsored_reels_has_limit_check;
alter table public.sponsored_reels
  add constraint sponsored_reels_has_limit_check
  check (reach_goal is not null or end_date is not null) not valid;

notify pgrst, 'reload schema';
