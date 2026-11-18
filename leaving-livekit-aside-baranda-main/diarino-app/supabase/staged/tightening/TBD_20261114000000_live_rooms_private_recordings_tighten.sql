-- «تضييق» مُولَّد من 20261114000000_live_rooms_private_recordings.sql (3 كتلة). يُطبَّق *بعد* نشر النسخة الجديدة وبعد رفع app_version_requirements.min_version
-- فوق النسخة القديمة (انظر supabase/staged/README.md). أعد تسمية هذا الملف بتاريخ التطبيق الفعلى (YYYYMMDDHHMMSS_...) ثم انقله إلى supabase/migrations.
-- يعتمد على الجزء الإضافى من الملف الأصلى (المُطبَّق قبله).

-- (من 20261114000000_live_rooms_private_recordings.sql) كتلة 1
-- التصفير يمرّ عبر الـ trigger (auth.uid() فارغ هنا فيُسمح).
update public.lives set egress_id = null, recording_filepath = null
where egress_id is not null or recording_filepath is not null;

-- (من 20261114000000_live_rooms_private_recordings.sql) كتلة 2
-- 2) trigger الحماية: المضيف لم يعد يكتب egress_id (الخادم فقط). باقى القواعد كما هى (G2).
create or replace function public.lives_guard_host_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  allowed text[] := array['title','pinned','pinned_at','comments_hidden','published_public','status','ended_at',
                          'recording_status','viewer_peak','duration_sec','poster_url'];
begin
  if auth.uid() is null then return new; end if;
  if public.admin_has_permission('lives') then return new; end if;

  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'live_column_not_writable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (old.status = 'live' and new.status = 'ended') then
    raise exception 'live_status_transition_forbidden' using errcode = '42501';
  end if;
  if new.recording_status is distinct from old.recording_status
     and new.recording_status not in ('none', 'recording', 'processing', 'failed') then
    raise exception 'live_recording_status_forbidden' using errcode = '42501';
  end if;
  if new.viewer_peak is distinct from old.viewer_peak and (new.viewer_peak < 0 or new.viewer_peak > 50000) then
    raise exception 'live_viewer_peak_out_of_range' using errcode = '22023';
  end if;
  if new.duration_sec is distinct from old.duration_sec and (new.duration_sec < 0 or new.duration_sec > 86400) then
    raise exception 'live_duration_out_of_range' using errcode = '22023';
  end if;
  if new.poster_url is distinct from old.poster_url and new.poster_url is not null and new.poster_url !~ '^https://' then
    raise exception 'live_poster_url_forbidden' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists lives_guard_host_update on public.lives;
create trigger lives_guard_host_update
  before update on public.lives
  for each row execute function public.lives_guard_host_update();

-- (من 20261114000000_live_rooms_private_recordings.sql) كتلة 3
-- 5) سحب صلاحية الإدراج المباشر على lives من العملاء (الإنشاء عبر create_live_room فقط).
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'lives' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on public.lives', p.policyname);
  end loop;
end $$;
revoke insert on public.lives from anon, authenticated;

notify pgrst, 'reload schema';
