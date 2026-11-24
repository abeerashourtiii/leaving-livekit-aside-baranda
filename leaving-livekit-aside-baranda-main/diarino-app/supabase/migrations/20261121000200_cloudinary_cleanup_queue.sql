-- supabase/migrations/20261121000200_cloudinary_cleanup_queue.sql
--
-- حذف ملفات Cloudinary اليتيمة (صور/فيديو/صوت) عند حذف أو تعديل العناصر المرتبطة بها، دون أن يعتمد حذف السجل على نجاح Cloudinary.
--
-- التصميم (طابور على مستوى قاعدة البيانات، لا على مستوى التطبيق، فيغطى *كل* مسارات الحذف: التطبيق، لوحة الأدمن، حذف الحساب (cascade)، SQL):
--   1) triggers على الجداول التى تحمل روابط Cloudinary تلتقط الروابط المحذوفة/المستبدلة وتدخلها فى public.cloudinary_cleanup_queue
--      (resource_type + public_id مستخرجين من الرابط) — داخل نفس معاملة الحذف/التعديل، فلا يضيع شيء ولا يفشل الحذف أبدًا بسبب Cloudinary.
--   2) Edge Function `cloudinary-cleanup` (فيها API Secret على الخادم فقط) تعالج الطابور: تتحقق أن الملف لم يعد مستخدمًا فى أى سجل نشط
--      (cloudinary_asset_in_use) ثم تنفّذ destroy فعليًا، وعند خطأ مؤقت تعيد المحاولة بتأخير متصاعد وتسجّل الخطأ فى last_error.
--   3) الصور المتعددة داخل العنصر الواحد (properties.media + cover_image، chat_messages.images...) تُلتقط كلها لا ملف واحد فقط.
--   4) مهلة أمان: due_at = بعد ساعة من الحذف/التعديل (حتى لو أعاد المستخدم نفس الملف سريعًا عبر منع التكرار)، والتحقق من الاستخدام وقت المعالجة.
--   5) فحص اليتامى: cloudinary_orphan_candidates يقارن سجل الرفع (media_fingerprints/media) بالسجلات النشطة، بمهلة ≥ 24 ساعة.
-- الأمان: كل الدوال مقصورة على service_role (الـ triggers SECURITY DEFINER) والطابور بلا أى سياسة وصول للمستخدمين.

create table if not exists public.cloudinary_cleanup_queue (
  id bigserial primary key,
  cloud_name text not null,
  resource_type text not null check (resource_type in ('image', 'video', 'raw')),
  public_id text not null check (char_length(public_id) between 1 and 512),
  source_table text,
  source_id text,
  reason text not null default 'deleted' check (reason in ('deleted', 'replaced', 'orphan_scan')),
  created_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '1 hour'),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  done_at timestamptz,
  result text -- deleted | not_found | in_use_skipped | foreign_cloud
);

create unique index if not exists cloudinary_cleanup_queue_pending_uidx
  on public.cloudinary_cleanup_queue (cloud_name, resource_type, public_id) where done_at is null;
create index if not exists cloudinary_cleanup_queue_due_idx
  on public.cloudinary_cleanup_queue (due_at) where done_at is null;

alter table public.cloudinary_cleanup_queue enable row level security;
revoke all on public.cloudinary_cleanup_queue from anon, authenticated;
revoke all on sequence public.cloudinary_cleanup_queue_id_seq from anon, authenticated;

-- ───────── استخراج (cloud, resource_type, public_id) من رابط Cloudinary ─────────
-- الشكل: https://res.cloudinary.com/<cloud>/<image|video|raw>/upload/[تحويلات/]v<الإصدار>/<public_id>.<ext>
-- نأخذ ما بعد مقطع الإصدار v123 (روابط الرفع دائمًا تحمله). بلا إصدار أو بحروف مُرمَّزة (%) نتجاهل الرابط (الأسلم: لا نحذف ما لا نتأكد منه).
create or replace function public.cloudinary_parse_url(p_url text)
returns table (cloud_name text, resource_type text, public_id text)
language plpgsql immutable
as $$
declare
  m text[];
  segs text[];
  n int;
  i int;
  ver int := 0;
  pid text;
begin
  m := regexp_match(coalesce(p_url, ''), '^https://res\.cloudinary\.com/([^/]+)/(image|video|raw)/upload/([^?#]+)');
  if m is null then return; end if;
  segs := string_to_array(m[3], '/');
  n := coalesce(array_length(segs, 1), 0);
  for i in 1..n loop
    if segs[i] ~ '^v[0-9]+$' then ver := i; exit; end if;
  end loop;
  if ver = 0 or ver >= n then return; end if;
  pid := array_to_string(segs[ver + 1:n], '/');
  if m[2] <> 'raw' then pid := regexp_replace(pid, '\.[A-Za-z0-9]+$', ''); end if;
  if pid = '' or pid like '%\%%' then return; end if;
  cloud_name := m[1]; resource_type := m[2]; public_id := pid;
  return next;
end;
$$;

-- كل روابط Cloudinary (نصوص) داخل أى قيمة jsonb: عمود نصى، مصفوفة (images)، أو jsonb متداخل (properties.media).
create or replace function public.cloudinary_urls_in(j jsonb)
returns text[]
language sql immutable
as $$
  select coalesce(array_agg(distinct v #>> '{}'), '{}')
  from jsonb_path_query(coalesce(j, 'null'::jsonb), 'strict $.**') as v
  where jsonb_typeof(v) = 'string' and (v #>> '{}') like 'https://res.cloudinary.com/%';
$$;

-- يُدخل إلى الطابور الروابط الموجودة فى p_old وغير الموجودة (بنفس public_id) فى p_new.
create or replace function public.cloudinary_enqueue_removed(
  p_old text[], p_new text[], p_table text, p_source text, p_reason text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  keep text[];
  u text;
  r record;
begin
  select coalesce(array_agg(distinct p.public_id), '{}') into keep
    from unnest(coalesce(p_new, '{}')) n cross join lateral public.cloudinary_parse_url(n) p;
  for u in select distinct unnest(coalesce(p_old, '{}')) loop
    for r in select * from public.cloudinary_parse_url(u) loop
      if r.public_id = any (keep) then continue; end if;
      insert into public.cloudinary_cleanup_queue (cloud_name, resource_type, public_id, source_table, source_id, reason)
      values (r.cloud_name, r.resource_type, r.public_id, p_table, p_source, p_reason)
      on conflict (cloud_name, resource_type, public_id) where done_at is null do nothing;
    end loop;
  end loop;
end;
$$;

create or replace function public.trg_cloudinary_enqueue()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  begin
    if TG_OP = 'DELETE' then
      perform public.cloudinary_enqueue_removed(
        public.cloudinary_urls_in(to_jsonb(OLD)), '{}', TG_TABLE_NAME, to_jsonb(OLD) ->> 'id', 'deleted');
    else
      perform public.cloudinary_enqueue_removed(
        public.cloudinary_urls_in(to_jsonb(OLD)), public.cloudinary_urls_in(to_jsonb(NEW)),
        TG_TABLE_NAME, to_jsonb(OLD) ->> 'id', 'replaced');
    end if;
  exception when others then
    -- حذف/تعديل السجل لا يفشل أبدًا بسبب الطابور (يُسجَّل تحذير فقط؛ وفحص اليتامى يلتقط ما فات).
    raise warning 'cloudinary cleanup enqueue failed for %: %', TG_TABLE_NAME, sqlerrm;
  end;
  return null;
end;
$$;

-- ───────── الـ triggers (حذف السجل + تغيير عمود الوسائط) ─────────
do $$
declare
  spec record;
  cond text;
begin
  for spec in
    select * from (values
      ('properties',      'media, cover_image', 'OLD.media IS DISTINCT FROM NEW.media OR OLD.cover_image IS DISTINCT FROM NEW.cover_image'),
      ('profiles',        'avatar_url',         'OLD.avatar_url IS DISTINCT FROM NEW.avatar_url'),
      ('music_tracks',    'url',                'OLD.url IS DISTINCT FROM NEW.url'),
      ('ad_banners',      'image_url',          'OLD.image_url IS DISTINCT FROM NEW.image_url'),
      ('ad_space_orders', 'image_url',          'OLD.image_url IS DISTINCT FROM NEW.image_url'),
      ('menu_items',      'image_url',          'OLD.image_url IS DISTINCT FROM NEW.image_url'),
      ('lives',           'poster_url',         'OLD.poster_url IS DISTINCT FROM NEW.poster_url'),
      ('chat_messages',   null,                 null)
    ) as t(tbl, cols, cond)
  loop
    if to_regclass('public.' || spec.tbl) is null then continue; end if;
    execute format('drop trigger if exists cloudinary_cleanup_on_delete on public.%I', spec.tbl);
    execute format(
      'create trigger cloudinary_cleanup_on_delete after delete on public.%I for each row execute function public.trg_cloudinary_enqueue()',
      spec.tbl);
    execute format('drop trigger if exists cloudinary_cleanup_on_update on public.%I', spec.tbl);
    if spec.cols is not null then
      execute format(
        'create trigger cloudinary_cleanup_on_update after update of %s on public.%I for each row when (%s) execute function public.trg_cloudinary_enqueue()',
        spec.cols, spec.tbl, spec.cond);
    end if;
  end loop;
end $$;

-- ───────── هل الملف ما زال مستخدمًا فى أى سجل نشط؟ (يمنع حذف ملف أعيد استخدامه عبر منع التكرار أو مشترك بين سجلين) ─────────
-- مطابقة نصية على '/<public_id>.' داخل الرابط؛ أى تطابق جزئى ينتج «مستخدم» (الخطأ فى الاتجاه الآمن: لا نحذف).
create or replace function public.cloudinary_asset_in_use(p_public_id text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  needle text := '/' || p_public_id || '.';
begin
  if p_public_id is null or p_public_id = '' then return true; end if;
  return
    exists (select 1 from public.properties where strpos(coalesce(media::text, ''), needle) > 0 or strpos(coalesce(cover_image, ''), needle) > 0)
    or exists (select 1 from public.profiles where strpos(coalesce(avatar_url, ''), needle) > 0)
    or exists (select 1 from public.music_tracks where public_id = p_public_id or strpos(coalesce(url, ''), needle) > 0)
    or exists (select 1 from public.ad_banners where strpos(coalesce(image_url, ''), needle) > 0)
    or exists (select 1 from public.ad_space_orders where strpos(coalesce(image_url, ''), needle) > 0)
    or exists (select 1 from public.menu_items where strpos(coalesce(image_url, ''), needle) > 0)
    or exists (select 1 from public.lives where strpos(coalesce(poster_url, ''), needle) > 0)
    or exists (select 1 from public.chat_messages where strpos(array_to_string(images, ' '), needle) > 0);
end;
$$;

-- ───────── حجز دفعة من الطابور للمعالجة (lease) ─────────
create or replace function public.claim_cloudinary_cleanup(p_limit integer default 25)
returns setof public.cloudinary_cleanup_queue
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with c as (
    select id from public.cloudinary_cleanup_queue
     where done_at is null and due_at <= now() and next_attempt_at <= now() and attempts < 8
     order by due_at
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update skip locked
  )
  update public.cloudinary_cleanup_queue q
     set attempts = q.attempts + 1,
         next_attempt_at = now() + interval '10 minutes'
    from c
   where q.id = c.id
  returning q.*;
end;
$$;

-- ───────── مرشَّحو اليتامى: ملفات رُفعت (سجل media_fingerprints/media) ولم يعد لها أى سجل نشط، بعد مهلة أمان ─────────
create or replace function public.cloudinary_orphan_candidates(p_older_than interval default interval '24 hours', p_limit integer default 500)
returns table (cloud_name text, resource_type text, public_id text, bytes bigint, created_at timestamptz, source text)
language sql stable security definer set search_path = public
as $$
  with ledger as (
    select url, bytes, created_at, 'media_fingerprints'::text as source from public.media_fingerprints
    union all
    select url, bytes, created_at, 'media'::text from public.media
  ),
  parsed as (
    select p.cloud_name, p.resource_type, p.public_id, max(l.bytes) as bytes, min(l.created_at) as created_at, min(l.source) as source
      from ledger l cross join lateral public.cloudinary_parse_url(l.url) p
     where l.created_at < now() - greatest(p_older_than, interval '24 hours')
     group by p.cloud_name, p.resource_type, p.public_id
  )
  select pr.cloud_name, pr.resource_type, pr.public_id, pr.bytes::bigint, pr.created_at, pr.source
    from parsed pr
   where not public.cloudinary_asset_in_use(pr.public_id)
     and not exists (
       select 1 from public.cloudinary_cleanup_queue q
        where q.cloud_name = pr.cloud_name and q.resource_type = pr.resource_type and q.public_id = pr.public_id and q.done_at is null)
   order by pr.created_at
   limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

revoke all on function public.cloudinary_parse_url(text) from public, anon, authenticated;
revoke all on function public.cloudinary_urls_in(jsonb) from public, anon, authenticated;
revoke all on function public.cloudinary_enqueue_removed(text[], text[], text, text, text) from public, anon, authenticated;
revoke all on function public.trg_cloudinary_enqueue() from public, anon, authenticated;
revoke all on function public.cloudinary_asset_in_use(text) from public, anon, authenticated;
revoke all on function public.claim_cloudinary_cleanup(integer) from public, anon, authenticated;
revoke all on function public.cloudinary_orphan_candidates(interval, integer) from public, anon, authenticated;
grant execute on function public.cloudinary_parse_url(text) to service_role;
grant execute on function public.cloudinary_asset_in_use(text) to service_role;
grant execute on function public.claim_cloudinary_cleanup(integer) to service_role;
grant execute on function public.cloudinary_orphan_candidates(interval, integer) to service_role;
grant select, insert, update, delete on public.cloudinary_cleanup_queue to service_role;
grant usage, select on sequence public.cloudinary_cleanup_queue_id_seq to service_role;

-- إدخال دفعة يتامى إلى الطابور (يتجاوز المكرر الموجود قيد الانتظار). rows = [{cloud_name,resource_type,public_id,source_table}]
create or replace function public.enqueue_cloudinary_orphans(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n integer;
begin
  with ins as (
    insert into public.cloudinary_cleanup_queue (cloud_name, resource_type, public_id, source_table, reason, due_at)
    select r ->> 'cloud_name', r ->> 'resource_type', r ->> 'public_id', r ->> 'source_table', 'orphan_scan', now()
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where r ->> 'resource_type' in ('image', 'video', 'raw') and coalesce(r ->> 'public_id', '') <> ''
    on conflict (cloud_name, resource_type, public_id) where done_at is null do nothing
    returning 1
  )
  select count(*) into n from ins;
  return n;
end;
$$;

revoke all on function public.enqueue_cloudinary_orphans(jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_cloudinary_orphans(jsonb) to service_role;
