-- M2) منع تلويث قوائم المحافظات والمناطق.
--  • المحافظات: القائمة مغلقة (27) ولا تُرقّى لأحد. record_province_search_attempt صارت إحصاءً للأدمن فقط
--    (مستخدم غير ضيف، محاولة واحدة لكل (مستخدم، اسم مطبّع)، حد يومى لكل مستخدم، وفلتر الأرقام/الروابط).
--  • المناطق: يراها المقترِح فورًا، ويُعمَّم الاسم على الجميع عند 5 مستخدمين مختلفين (غير ضيوف، حساباتهم عمرها 7 أيام فأكثر)،
--    بعد اجتياز فلتر الأرقام والروابط (reel_comment_blocked_reason)، مع حد معدل لكل مستخدم وإخفاء/حذف للأدمن.
--    الإدراج المباشر على known_regions مسحوب؛ الاقتراح عبر RPC suggest_region فقط.
-- قابل لإعادة التشغيل. لا يعدّل أى migration قديم.

-- 0) تطبيع عربى على الخادم (يطابق normalizeArabic فى العميل): أ/إ/آ→ا، ة→ه، ى→ي، حذف التشكيل والتطويل، توحيد المسافات.
create or replace function public.normalize_arabic_name(p text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(
    translate(
      regexp_replace(lower(coalesce(p, '')), '[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\u2060\uFEFF]', '', 'g'),
      'أإآٱةى',
      'ااااهي'
    ),
    '\s+', ' ', 'g'));
$$;

-- 1) المحافظات: إحصاء للأدمن فقط.
-- @@TIGHTEN-BEGIN
drop policy if exists "known provinces are readable once promoted (3+ searches)" on public.known_provinces;
-- @@TIGHTEN-END

create table if not exists public.province_search_attempts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  name_norm text not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, name_norm),
  constraint province_search_attempts_name_length check (char_length(name) between 1 and 100)
);
create index if not exists province_search_attempts_name_idx on public.province_search_attempts(name_norm);
alter table public.province_search_attempts enable row level security;
revoke all on public.province_search_attempts from public, anon, authenticated;

create or replace function public.record_province_search_attempt(p_name text)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_norm text;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return null;
  end if;
  if v_name = '' or char_length(v_name) > 100 then
    return null;
  end if;
  if public.reel_comment_blocked_reason(v_name) is not null then
    return null;
  end if;
  v_norm := public.normalize_arabic_name(v_name);
  if v_norm = '' then return null; end if;

  -- حد يومى لكل مستخدم (إحصاء فقط).
  if (select count(*) from public.province_search_attempts where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    return null;
  end if;

  insert into public.province_search_attempts (user_id, name_norm, name)
  values (v_uid, v_norm, v_name)
  on conflict (user_id, name_norm) do nothing;

  return (select count(*)::integer from public.province_search_attempts where name_norm = v_norm);
end;
$$;
revoke all on function public.record_province_search_attempt(text) from public, anon;
grant execute on function public.record_province_search_attempt(text) to authenticated;

create or replace function public.admin_province_attempt_stats()
returns table (name text, users integer, last_at timestamptz)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.admin_has_permission('reports') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select (array_agg(a.name order by a.created_at desc))[1], count(*)::integer, max(a.created_at)
      from public.province_search_attempts a
     group by a.name_norm
     order by count(*) desc, max(a.created_at) desc
     limit 100;
end;
$$;
revoke all on function public.admin_province_attempt_stats() from public, anon;
grant execute on function public.admin_province_attempt_stats() to authenticated;

-- 2) المناطق.
alter table public.known_regions add column if not exists suggested_by uuid references public.profiles(id) on delete set null;
alter table public.known_regions add column if not exists hidden boolean not null default false;
alter table public.known_regions add column if not exists promoted_at timestamptz;
alter table public.known_regions add column if not exists name_norm text;
alter table public.known_regions add column if not exists province_norm text;

update public.known_regions
   set name_norm = public.normalize_arabic_name(name),
       province_norm = public.normalize_arabic_name(province)
 where name_norm is null or province_norm is null;
create index if not exists known_regions_norm_idx on public.known_regions(province_norm, name_norm);

-- الصفوف الموجودة كانت ظاهرة للجميع أصلًا: تبقى ظاهرة (معتمدة) إلا ما يخالف فلتر الأرقام/الروابط فيُخفى تلقائيًا للمراجعة.
update public.known_regions set promoted_at = created_at where promoted_at is null;
update public.known_regions
   set hidden = true
 where hidden = false
   and (public.reel_comment_blocked_reason(name) is not null or public.reel_comment_blocked_reason(province) is not null);

create table if not exists public.known_region_votes (
  region_id uuid not null references public.known_regions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (region_id, user_id)
);
create index if not exists known_region_votes_user_idx on public.known_region_votes(user_id, created_at desc);
alter table public.known_region_votes enable row level security;
revoke all on public.known_region_votes from public, anon, authenticated;

-- هل أيّد المستخدم الحالى هذا الاسم (اقترحه أو اقترحه مجددًا)؟ دالة آمنة لأن جدول الأصوات مغلق على العملاء.
create or replace function public.i_voted_region(p_region uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.known_region_votes where region_id = p_region and user_id = auth.uid());
$$;
revoke all on function public.i_voted_region(uuid) from public, anon;
grant execute on function public.i_voted_region(uuid) to authenticated;

-- @@TIGHTEN-BEGIN
-- القراءة: المعتمد غير المخفى للجميع، واقتراحك أنت (غير المخفى) لك، والأدمن يرى الكل.
drop policy if exists "known regions are readable by authenticated users" on public.known_regions;
drop policy if exists "known regions: promoted or own suggestion" on public.known_regions;
create policy "known regions: promoted or own suggestion"
  on public.known_regions for select
  to authenticated
  using (hidden = false and (promoted_at is not null or suggested_by = auth.uid() or public.i_voted_region(id)));
-- @@TIGHTEN-END

drop policy if exists "known regions: admin read all" on public.known_regions;
create policy "known regions: admin read all"
  on public.known_regions for select
  to authenticated
  using (public.admin_has_permission('reports'));

drop policy if exists "known regions: admin update" on public.known_regions;
create policy "known regions: admin update"
  on public.known_regions for update
  to authenticated
  using (public.admin_has_permission('reports'))
  with check (public.admin_has_permission('reports'));

drop policy if exists "known regions: admin delete" on public.known_regions;
create policy "known regions: admin delete"
  on public.known_regions for delete
  to authenticated
  using (public.admin_has_permission('reports'));

-- @@TIGHTEN-BEGIN
-- الإدراج المباشر مسحوب (كان with check (true)).
drop policy if exists "authenticated users can add a new region name" on public.known_regions;
revoke insert on public.known_regions from anon, authenticated;
revoke update on public.known_regions from anon, authenticated;
grant update (hidden) on public.known_regions to authenticated; -- RLS تقصره على الأدمن
-- @@TIGHTEN-END

-- المستخدم المؤهِّل للعدّ: غير ضيف وحسابه عمره 7 أيام فأكثر.
create or replace function public.is_qualified_region_voter(p_user uuid)
returns boolean
language sql
stable
security definer set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u
     where u.id = p_user
       and coalesce(u.is_anonymous, false) = false
       and u.created_at <= now() - interval '7 days'
  );
$$;
revoke all on function public.is_qualified_region_voter(uuid) from public, anon, authenticated;

-- الاقتراح: يرجع true إن سُجِّل/كان موجودًا، false إن رُفض بصمت (فلتر/حد معدل/مخفى).
create or replace function public.suggest_region(p_province text, p_name text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_province text := btrim(coalesce(p_province, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_pn text;
  v_nn text;
  v_id uuid;
  v_hidden boolean;
  v_supporters integer;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return false;
  end if;
  if char_length(v_province) not between 1 and 100 or char_length(v_name) not between 1 and 100 then
    return false;
  end if;
  if public.reel_comment_blocked_reason(v_name) is not null or public.reel_comment_blocked_reason(v_province) is not null then
    return false;
  end if;
  v_pn := public.normalize_arabic_name(v_province);
  v_nn := public.normalize_arabic_name(v_name);
  if v_pn = '' or v_nn = '' then return false; end if;

  -- حد معدل لكل مستخدم: 20 اقتراحًا/تأييدًا فى اليوم.
  if (select count(*) from public.known_region_votes where user_id = v_uid and created_at > now() - interval '1 day') >= 20 then
    return false;
  end if;

  select id, hidden into v_id, v_hidden
    from public.known_regions
   where province_norm = v_pn and name_norm = v_nn
   order by (promoted_at is not null) desc, created_at
   limit 1;

  if v_id is not null and v_hidden then
    return false; -- لا نُعيد إظهار ما أخفاه الأدمن
  end if;

  if v_id is null then
    insert into public.known_regions (province, name, suggested_by, name_norm, province_norm)
    values (v_province, v_name, v_uid, v_nn, v_pn)
    on conflict (province, name) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.known_regions where province = v_province and name = v_name;
      if v_id is null then return false; end if;
    end if;
  end if;

  insert into public.known_region_votes (region_id, user_id) values (v_id, v_uid) on conflict do nothing;

  -- التعميم عند 5 مستخدمين مؤهَّلين مختلفين.
  select count(*)::integer into v_supporters
    from public.known_region_votes v
   where v.region_id = v_id and public.is_qualified_region_voter(v.user_id);
  if v_supporters >= 5 then
    update public.known_regions set promoted_at = now() where id = v_id and promoted_at is null;
  end if;

  return true;
end;
$$;
revoke all on function public.suggest_region(text, text) from public, anon;
grant execute on function public.suggest_region(text, text) to authenticated;

-- قائمة الأدمن (المقترحات + داعموها + المقترِح).
create or replace function public.admin_list_region_suggestions()
returns table (id uuid, province text, name text, hidden boolean, promoted boolean, supporters integer, suggester_name text, created_at timestamptz)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.admin_has_permission('reports') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select r.id, r.province, r.name, r.hidden, (r.promoted_at is not null),
           (select count(*)::integer from public.known_region_votes v where v.region_id = r.id and public.is_qualified_region_voter(v.user_id)),
           p.full_name, r.created_at
      from public.known_regions r
      left join public.profiles p on p.id = r.suggested_by
     order by r.created_at desc
     limit 300;
end;
$$;
revoke all on function public.admin_list_region_suggestions() from public, anon;
grant execute on function public.admin_list_region_suggestions() to authenticated;

-- إخفاء/إظهار/حذف مع تسجيل فى سجل التدقيق.
create or replace function public.admin_moderate_region(p_id uuid, p_action text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor_name text;
  v_row public.known_regions%rowtype;
begin
  if auth.uid() is null or not public.admin_has_permission('reports') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_row from public.known_regions where id = p_id;
  if not found then return; end if;

  if p_action = 'hide' then
    update public.known_regions set hidden = true where id = p_id;
  elsif p_action = 'unhide' then
    update public.known_regions set hidden = false where id = p_id;
  elsif p_action = 'delete' then
    delete from public.known_regions where id = p_id;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  select full_name into v_actor_name from public.profiles where id = auth.uid();
  insert into public.admin_audit_log (actor_id, actor_name, action, target_table, target_id, before, after)
  values (auth.uid(), v_actor_name, 'region_' || p_action, 'known_regions', p_id, null,
          jsonb_build_object('id', p_id, 'status', p_action));
end;
$$;
revoke all on function public.admin_moderate_region(uuid, text) from public, anon;
grant execute on function public.admin_moderate_region(uuid, text) to authenticated;

notify pgrst, 'reload schema';
