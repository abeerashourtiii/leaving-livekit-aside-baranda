-- supabase/migrations/20261029000000_admin_support_replies_and_counts.sql
--
-- لوحة الأدمن:
--  1) الرد على البلاغات والمقترحات (من صفحة «الدعم»): الرد يُحفظ ويصل لصاحب البلاغ/الاقتراح كإشعار «رد الإدارة» فى الجرس.
--  2) admin_pending_counts(): أعداد البنود المنتظرة لإظهار العلامات الحمراء فى القائمة الجانبية (ريلز قيد المراجعة / الدعم /
--     الصفقات والرسوم) — كل رقم بيتحسب فقط لو المشرف عنده صلاحية القسم (غير كده 0).

alter table public.reports
  add column if not exists admin_reply text,
  add column if not exists replied_at timestamptz,
  add column if not exists replied_by uuid references public.profiles(id) on delete set null;

alter table public.suggestions
  add column if not exists admin_reply text,
  add column if not exists replied_at timestamptz,
  add column if not exists replied_by uuid references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------
-- رد على بلاغ: بيوصل لكل من أبلغ عن نفس المحتوى (بلاغات لسه من غير رد) ويُسجَّل على صفوف البلاغات.
-- ---------------------------------------------------------------------
create or replace function public.admin_reply_to_report(p_report_id uuid, p_text text)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_type text;
  v_target uuid;
  v_title text;
  v_n integer := 0;
  r record;
begin
  if not public.admin_has_permission('reports') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_text is null or char_length(v_text) > 1000 then
    raise exception 'invalid_reply';
  end if;

  select target_type, target_id, target_title into v_type, v_target, v_title
    from public.reports where id = p_report_id;
  if not found then
    raise exception 'report_not_found';
  end if;

  for r in
    select distinct on (reporter_id) id, reporter_id
      from public.reports
     where target_type = v_type and target_id = v_target and replied_at is null
     order by reporter_id, created_at
  loop
    insert into public.notifications (recipient_id, actor_id, category, text, property_id)
    values (r.reporter_id, null, 'approval',
            'رد الإدارة على بلاغك عن «' || left(coalesce(v_title, ''), 60) || '»: ' || v_text, null);
    v_n := v_n + 1;
  end loop;

  update public.reports
     set admin_reply = v_text, replied_at = now(), replied_by = auth.uid()
   where target_type = v_type and target_id = v_target and replied_at is null;

  return v_n;
end;
$$;
revoke all on function public.admin_reply_to_report(uuid, text) from public;
grant execute on function public.admin_reply_to_report(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- رد على اقتراح
-- ---------------------------------------------------------------------
create or replace function public.admin_reply_to_suggestion(p_suggestion_id uuid, p_text text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_user uuid;
begin
  if not public.admin_has_permission('reports') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_text is null or char_length(v_text) > 1000 then
    raise exception 'invalid_reply';
  end if;

  select user_id into v_user from public.suggestions where id = p_suggestion_id;
  if not found then
    raise exception 'suggestion_not_found';
  end if;

  update public.suggestions
     set admin_reply = v_text, replied_at = now(), replied_by = auth.uid()
   where id = p_suggestion_id;

  insert into public.notifications (recipient_id, actor_id, category, text, property_id)
  values (v_user, null, 'approval', 'رد الإدارة على اقتراحك: ' || v_text, null);
end;
$$;
revoke all on function public.admin_reply_to_suggestion(uuid, text) from public;
grant execute on function public.admin_reply_to_suggestion(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- أعداد البنود المنتظرة (للعلامات الحمراء فى القائمة الجانبية)
-- ---------------------------------------------------------------------
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
      (select count(*) from (select distinct target_type, target_id from public.reports where replied_at is null) x)
      + (select count(*) from public.suggestions where replied_at is null)
      + (select count(*) from public.ad_contacts)
      + (select count(*) from public.support_messages)
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
