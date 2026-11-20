-- M1) «تجاهل» فى صندوق الدعم صار حذفًا ناعمًا: يُخفى من الأدمن فورًا ويُحذف نهائيًا بعد 30 يومًا (مهمة يومية).
-- يشمل البلاغات والمقترحات وطلبات التواصل والإعلانات (reports / suggestions / support_messages / ad_contacts).
-- قابل لإعادة التشغيل. لا يعدّل أى migration قديم.
alter table public.reports add column if not exists dismissed_at timestamptz;
alter table public.suggestions add column if not exists dismissed_at timestamptz;
alter table public.support_messages add column if not exists dismissed_at timestamptz;
alter table public.ad_contacts add column if not exists dismissed_at timestamptz;

create index if not exists reports_dismissed_idx on public.reports(dismissed_at) where dismissed_at is not null;
create index if not exists suggestions_dismissed_idx on public.suggestions(dismissed_at) where dismissed_at is not null;
create index if not exists support_messages_dismissed_idx on public.support_messages(dismissed_at) where dismissed_at is not null;
create index if not exists ad_contacts_dismissed_idx on public.ad_contacts(dismissed_at) where dismissed_at is not null;

create or replace function public.admin_dismiss_support_item(p_kind text, p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor_name text;
  v_table text;
begin
  if auth.uid() is null or not public.admin_has_permission('reports') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_kind = 'report' then
    -- البلاغات على نفس المحتوى تظهر مجمّعة: نتجاهل المجموعة كلها.
    update public.reports r set dismissed_at = coalesce(r.dismissed_at, now())
     where (r.target_type, r.target_id) in (select target_type, target_id from public.reports where id = p_id);
    v_table := 'reports';
  elsif p_kind = 'suggestion' then
    update public.suggestions set dismissed_at = coalesce(dismissed_at, now()) where id = p_id;
    v_table := 'suggestions';
  elsif p_kind = 'contact' then
    update public.support_messages set dismissed_at = coalesce(dismissed_at, now()) where id = p_id;
    v_table := 'support_messages';
  elsif p_kind = 'ad_contact' then
    update public.ad_contacts set dismissed_at = coalesce(dismissed_at, now()) where id = p_id;
    v_table := 'ad_contacts';
  else
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  select full_name into v_actor_name from public.profiles where id = auth.uid();
  insert into public.admin_audit_log (actor_id, actor_name, action, target_table, target_id, before, after)
  values (auth.uid(), v_actor_name, p_kind || '_dismiss', v_table, p_id, null, jsonb_build_object('id', p_id, 'status', 'dismissed'));
end;
$$;
revoke all on function public.admin_dismiss_support_item(text, uuid) from public, anon;
grant execute on function public.admin_dismiss_support_item(text, uuid) to authenticated;

-- الحذف النهائى بعد 30 يومًا من التجاهل.
create or replace function public.purge_dismissed_support_items()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_total integer := 0;
  v_n integer;
begin
  delete from public.reports where dismissed_at < now() - interval '30 days';
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from public.suggestions where dismissed_at < now() - interval '30 days';
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from public.support_messages where dismissed_at < now() - interval '30 days';
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  delete from public.ad_contacts where dismissed_at < now() - interval '30 days';
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  return v_total;
end;
$$;
revoke all on function public.purge_dismissed_support_items() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron with schema extensions;
  perform cron.schedule('purge-dismissed-support', '41 3 * * *', $job$select public.purge_dismissed_support_items()$job$);
exception when others then
  raise notice 'pg_cron غير متاح (%): شغّل select public.purge_dismissed_support_items(); دوريًا يدويًا.', sqlerrm;
end $$;

-- عدّادات الأدمن لا تحسب المتجاهَل.
create or replace function public.admin_pending_counts()
returns table (reels_pending integer, support_pending integer, deals_pending integer)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_reels integer := 0;
  v_support integer := 0;
  v_deals integer := 0;
begin
  if auth.uid() is null then
    return query select 0, 0, 0;
    return;
  end if;

  if public.admin_has_permission('reels') then
    select count(*)::integer into v_reels from public.properties where moderation_status = 'pending';
  end if;

  if public.admin_has_permission('reports') then
    select (
      (select count(*) from (select distinct target_type, target_id from public.reports where replied_at is null and dismissed_at is null) x)
      + (select count(*) from public.suggestions where replied_at is null and dismissed_at is null)
      + (select count(*) from public.ad_contacts where dismissed_at is null)
      + (select count(*) from public.support_messages where dismissed_at is null)
    )::integer into v_support;
  end if;

  if public.admin_has_permission('deals') then
    select (
      (select count(*) from public.property_deals where status in ('submitted', 'disputed'))
      + (select count(*) from public.ad_promotions where status = 'submitted')
      + (select count(*) from public.ad_space_orders where status = 'submitted')
    )::integer into v_deals;
  end if;

  return query select v_reels, v_support, v_deals;
end;
$$;
revoke all on function public.admin_pending_counts() from public;
grant execute on function public.admin_pending_counts() to authenticated;

notify pgrst, 'reload schema';
