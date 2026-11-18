-- L1/L2/L3) غرف البث وتسجيلاتها:
--  • L2: اسم الغرفة يُولَّد على الخادم (live_<uuid>) عبر create_live_room؛ ولا إدراج مباشر فى lives من العملاء.
--  • L1: مسار ملف التسجيل (recording_filepath) ومعرّف التسجيل (egress_id) ينتقلان لجدول خاص لا يقرؤه أى عميل (service_role فقط)،
--        ويُصفَّران فى lives، فلا يستطيع مشاهد أثناء البث معرفة مسار الملف.
--  • L3: end_live_room(room) تُنهى البث بعد التحقق من المضيف؛ وكتابة egress_id/recording_status من العميل تتوقف (الخادم وحده).
-- قابل لإعادة التشغيل. لا يعدّل أى migration قديم.

-- 1) جدول خاص بأسرار التسجيل.
create table if not exists public.live_recording_private (
  live_id uuid primary key references public.lives(id) on delete cascade,
  egress_id text,
  recording_filepath text,
  created_at timestamptz not null default now()
);
create index if not exists live_recording_private_egress_idx on public.live_recording_private(egress_id);
alter table public.live_recording_private enable row level security;
-- لا سياسات = لا وصول لـ anon/authenticated؛ service_role يتجاوز RLS.
revoke all on public.live_recording_private from public, anon, authenticated;

-- نقل القيم الحالية ثم تصفيرها من lives (recording_url يبقى كما هو؛ يظهر للآخرين فقط للبث المنشور).
insert into public.live_recording_private (live_id, egress_id, recording_filepath)
select id, egress_id, recording_filepath
from public.lives
where egress_id is not null or recording_filepath is not null
on conflict (live_id) do update
  set egress_id = coalesce(public.live_recording_private.egress_id, excluded.egress_id),
      recording_filepath = coalesce(public.live_recording_private.recording_filepath, excluded.recording_filepath);

-- 3) L2: إنشاء الغرفة على الخادم.
create or replace function public.create_live_room(p_title text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room text;
  v_title text := nullif(left(btrim(coalesce(p_title, '')), 200), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'guest_cannot_broadcast' using errcode = '42501';
  end if;

  v_room := 'live_' || gen_random_uuid()::text;
  insert into public.lives (room_name, host_id, title, status, recording_status, rights_declared_at)
  values (v_room, v_uid, v_title, 'live', 'none', now());
  return v_room;
end;
$$;
revoke all on function public.create_live_room(text) from public, anon;
grant execute on function public.create_live_room(text) to authenticated;

-- 4) L3: إنهاء البث بعد التحقق من المضيف (لا يمسّ إلا بثًّا جاريًا يملكه المتصل).
create or replace function public.end_live_room(p_room_name text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.lives
     set status = 'ended', ended_at = now()
   where room_name = p_room_name
     and host_id = auth.uid()
     and status = 'live';
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
revoke all on function public.end_live_room(text) from public, anon;
grant execute on function public.end_live_room(text) to authenticated;

