-- «تضييق» مُولَّد من 20261115000000_private_recordings_signed_urls.sql (2 كتلة). يُطبَّق *بعد* نشر النسخة الجديدة وبعد رفع app_version_requirements.min_version
-- فوق النسخة القديمة (انظر supabase/staged/README.md). أعد تسمية هذا الملف بتاريخ التطبيق الفعلى (YYYYMMDDHHMMSS_...) ثم انقله إلى supabase/migrations.
-- يعتمد على الجزء الإضافى من الملف الأصلى (المُطبَّق قبله).

-- (من 20261115000000_private_recordings_signed_urls.sql) كتلة 1
-- 2) لا رابط عام بعد الآن: تصفير القيم الحالية + trigger يمنع تخزين أى قيمة.
create or replace function public.lives_force_null_recording_url()
returns trigger
language plpgsql
as $$
begin
  new.recording_url := null;
  new.recording_filepath := null;
  return new;
end;
$$;
drop trigger if exists lives_force_null_recording_url on public.lives;
create trigger lives_force_null_recording_url
  before insert or update on public.lives
  for each row execute function public.lives_force_null_recording_url();

update public.lives set recording_url = null, recording_filepath = null
where recording_url is not null or recording_filepath is not null;

-- (من 20261115000000_private_recordings_signed_urls.sql) كتلة 2
-- 4) الحاوية خاصة (إن وُجدت). الملفات لا تُقرأ إلا برابط موقّع من الدالة؛ كتابة Egress عبر مفاتيح S3 لا تتأثر.
do $$
begin
  if exists (select 1 from storage.buckets where id = 'live-recordings') then
    update storage.buckets set public = false where id = 'live-recordings';
  end if;
end $$;

notify pgrst, 'reload schema';
