-- L1-ج) تسجيلات البث: حاوية خاصة + روابط موقّعة قصيرة العمر.
--  • لا يُخزَّن رابط عام أبدًا: lives.recording_url تبقى null دائمًا (trigger)، وتوفّر التسجيل تُعرف من recording_status='ready'.
--  • المسار الحقيقى فى live_recording_private فقط؛ دالة Edge `live-recording-url` تتحقق من can_view_live_recording ثم توقّع رابطًا قصير العمر.
--  • تعبئة مسارات التسجيلات القديمة من recording_filepath / من recording_url القديمة قبل تصفير الأخيرة.
-- ⚠ بعد هذا الـ migration لا تعمل شاشة الإعادة فى نسخ التطبيق القديمة (كانت تعتمد على الرابط العام) — يلزم نشر النسخة الجديدة.
-- ⚠ نقل ملفات التسجيلات القديمة إلى أسماء عشوائية يتم بسكربت scripts/migrate-live-recordings.mjs (SQL لا يستطيع نقل ملفات التخزين).
-- قابل لإعادة التشغيل. لا يعدّل أى migration قديم.

-- 1) تعبئة المسار من recording_filepath أولًا ثم من الرابط العام القديم (…/object/public/<bucket>/<path>) لأى بث لا يزال مساره ناقصًا.
insert into public.live_recording_private (live_id, recording_filepath)
select l.id,
       coalesce(
         nullif(l.recording_filepath, ''),
         substring(l.recording_url from '/object/(?:public|sign|authenticated)/[^/]+/([^?]+)')
       )
from public.lives l
where (l.recording_filepath is not null and l.recording_filepath <> '')
   or l.recording_url ~ '/object/(public|sign|authenticated)/[^/]+/'
on conflict (live_id) do update
  set recording_filepath = coalesce(nullif(public.live_recording_private.recording_filepath, ''), excluded.recording_filepath);

-- @@TIGHTEN-BEGIN
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
-- @@TIGHTEN-END

-- 3) من يحق له مشاهدة التسجيل: المضيف، أو الأدمن (صلاحية lives)، أو أى مستخدم مسجّل لبث منشور ومعتمد. التسجيل لازم يكون ready.
create or replace function public.can_view_live_recording(p_live_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select auth.uid() is not null
     and exists (
       select 1
         from public.lives l
        where l.id = p_live_id
          and l.recording_status = 'ready'
          and (
            l.host_id = auth.uid()
            or public.admin_has_permission('lives')
            or (l.published_public = true and l.moderation_status = 'approved')
          )
     );
$$;
revoke all on function public.can_view_live_recording(uuid) from public, anon;
grant execute on function public.can_view_live_recording(uuid) to authenticated;

-- @@TIGHTEN-BEGIN
-- 4) الحاوية خاصة (إن وُجدت). الملفات لا تُقرأ إلا برابط موقّع من الدالة؛ كتابة Egress عبر مفاتيح S3 لا تتأثر.
do $$
begin
  if exists (select 1 from storage.buckets where id = 'live-recordings') then
    update storage.buckets set public = false where id = 'live-recordings';
  end if;
end $$;
-- @@TIGHTEN-END

notify pgrst, 'reload schema';
