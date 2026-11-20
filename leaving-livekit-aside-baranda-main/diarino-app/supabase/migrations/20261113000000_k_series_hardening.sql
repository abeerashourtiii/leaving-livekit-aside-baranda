-- ---------------------------------------------------------------------
-- ملحق الفحص K3 / K4 / K9 — قابل لإعادة التشغيل. (لا يعدّل أى migration قديم.)
-- ---------------------------------------------------------------------

-- K4) ملاحظة ترخيص الموسيقى (مصدر الترخيص ومرجع الإثبات = معلومات تجارية داخلية). كانت عمودًا فى music_tracks وسياسة SELECT على مستوى الصف
--     (active أو أدمن) فأى مستخدم مسجّل يطلب العمود مباشرة عبر REST (التطبيق كان يحذفه من استعلام غير الأدمن فقط). الآن: جدول خاص بالأدمن
--     (music_track_licenses، RLS بصلاحية music)، وتُنقل القيم الموجودة، وtrigger ينقل أى كتابة لعمود music_tracks.license_note إلى الجدول الخاص
--     ويصفّر العمود — فيبقى العمود فارغًا دائمًا (حتى مع نسخ التطبيق القديمة التى ما زالت تكتب فيه).
create table if not exists public.music_track_licenses (
  track_id uuid primary key references public.music_tracks(id) on delete cascade,
  license_note text,
  updated_at timestamptz not null default now()
);
alter table public.music_track_licenses enable row level security;
drop policy if exists "admins manage music licenses" on public.music_track_licenses;
create policy "admins manage music licenses"
  on public.music_track_licenses for all
  to authenticated
  using (public.admin_has_permission('music'))
  with check (public.admin_has_permission('music'));

insert into public.music_track_licenses (track_id, license_note)
select id, license_note from public.music_tracks where license_note is not null
on conflict (track_id) do update set license_note = excluded.license_note, updated_at = now();
update public.music_tracks set license_note = null where license_note is not null;

create or replace function public.music_tracks_move_license_note()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.music_track_licenses (track_id, license_note, updated_at)
  values (new.id, new.license_note, now())
  on conflict (track_id) do update set license_note = excluded.license_note, updated_at = now();
  update public.music_tracks set license_note = null where id = new.id;
  return null;
end;
$$;
drop trigger if exists music_tracks_move_license_note on public.music_tracks;
create trigger music_tracks_move_license_note
  after insert or update of license_note on public.music_tracks
  for each row
  when (new.license_note is not null)
  execute function public.music_tracks_move_license_note();

-- K9) روابط المشاركة الاجتماعية التى يحدّدها الأدمن: https فقط (أو فارغ لإلغاء الرابط). NOT VALID: لا يفشل بسبب صفوف قديمة.
alter table public.social_share_links drop constraint if exists social_share_links_https;
alter table public.social_share_links
  add constraint social_share_links_https
  check (url = '' or url ~* '^https://') not valid;

-- K3) حد الرفع اليومى لكل مستخدم (يُستدعى من edge function cloudinary-sign بمفتاح الخدمة فقط). يرجع true لو ما زال تحت الحد ويحسب الطلب.
create table if not exists public.upload_quota (
  user_id uuid not null,
  day date not null default ((now() at time zone 'utc')::date),
  uploads integer not null default 0,
  primary key (user_id, day)
);
alter table public.upload_quota enable row level security;
revoke all on public.upload_quota from anon, authenticated;

create or replace function public.bump_upload_quota(p_user uuid, p_limit integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.upload_quota (user_id, day, uploads)
  values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set uploads = public.upload_quota.uploads + 1
  returning uploads into v_count;
  if random() < 0.01 then
    delete from public.upload_quota where day < ((now() at time zone 'utc')::date - 7);
  end if;
  return v_count <= greatest(p_limit, 1);
end;
$$;
revoke all on function public.bump_upload_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.bump_upload_quota(uuid, integer) to service_role;

notify pgrst, 'reload schema';
