-- supabase/migrations/20261027000000_fix_admin_finance_lists.sql
--
-- إصلاح: صفحة «الصفقات والرسوم» فى لوحة الأدمن (الصفقات، طلبات الترويج، حجوزات المساحة الإعلانية) كانت بتفشل دايمًا
-- بـ «تعذر تحميل ...» حتى مع تطبيق كل الـ migrations.
--
-- السبب: الدوال admin_list_deals / admin_list_promotions / admin_list_ad_space_orders بتعمل RETURN QUERY، وplpgsql بيطلب
-- تطابق *النوع بالظبط* مع تعريف returns table. العمود profiles.phone_e164 نوعه varchar(20) (migration 20260829000000) فالتعبير
--   coalesce(p.phone_e164, d.payer_phone)
-- بيرجع varchar مش text، فكل استدعاء بيفشل بالخطأ:
--   structure of query does not match function result type — Returned type character varying does not match expected type text
-- الإصلاح: تحويل صريح (::text / ::integer / ::numeric) لكل أعمدة الإرجاع. نفس التواقيع (لا تغيير فى التطبيق).

drop function if exists public.admin_list_deals();
create function public.admin_list_deals()
returns table (
  id uuid, property_id uuid, property_title text, property_province text, deal_type text, fee_egp numeric,
  status text, reported_at timestamptz, due_at timestamptz, paid_at timestamptz, payment_ref text, note text,
  admin_note text, payer_id uuid, payer_name text, payer_phone text, payer_email text, payer_account_type text,
  payment_sender_name text, payment_sender_email text, payment_contact_phone text, payment_submitted_at timestamptz,
  payment_method text
)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select d.id, d.property_id, d.property_title::text, d.property_province::text, d.deal_type::text, d.fee_egp::numeric,
           d.status::text, d.reported_at, d.due_at, d.paid_at, d.payment_ref::text, d.note::text, d.admin_note::text,
           d.payer_id,
           coalesce(p.full_name::text, d.payer_name::text),
           coalesce(p.phone_e164::text, d.payer_phone::text),
           coalesce(u.email::text, d.payer_email::text),
           coalesce(d.payer_account_type::text, p.account_type::text),
           d.payment_sender_name::text, d.payment_sender_email::text, d.payment_contact_phone::text, d.payment_submitted_at,
           d.payment_method::text
      from public.property_deals d
      left join public.profiles p on p.id = d.payer_id
      left join auth.users u on u.id = d.payer_id
     order by d.reported_at desc;
end;
$$;
revoke all on function public.admin_list_deals() from public;
grant execute on function public.admin_list_deals() to authenticated;

drop function if exists public.admin_list_promotions();
create function public.admin_list_promotions()
returns table (
  id uuid, property_id uuid, property_title text, kind text, reach_goal integer, age_min integer, age_max integer,
  duration_days integer, price_egp numeric, status text, payment_method text, payment_sender_name text,
  payment_contact_phone text, payment_submitted_at timestamptz, payment_ref text, admin_note text,
  paid_at timestamptz, starts_at timestamptz, ends_at timestamptz, created_at timestamptz,
  payer_id uuid, payer_name text, payer_phone text, payer_email text, current_reach integer
)
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.expire_ad_promotions();
  return query
    select a.id, a.property_id, a.property_title::text, a.kind::text, a.reach_goal::integer, a.age_min::integer, a.age_max::integer,
           a.duration_days::integer, a.price_egp::numeric, a.status::text, a.payment_method::text, a.payment_sender_name::text,
           a.payment_contact_phone::text, a.payment_submitted_at, a.payment_ref::text, a.admin_note::text,
           a.paid_at, a.starts_at, a.ends_at, a.created_at,
           a.payer_id,
           coalesce(p.full_name::text, a.payer_name::text),
           coalesce(p.phone_e164::text, a.payer_phone::text),
           coalesce(u.email::text, a.payer_email::text),
           coalesce(sr.current_reach, 0)::integer
      from public.ad_promotions a
      left join public.profiles p on p.id = a.payer_id
      left join auth.users u on u.id = a.payer_id
      left join public.sponsored_reels sr on sr.id = a.sponsored_reel_id
     order by a.created_at desc;
end;
$$;
revoke all on function public.admin_list_promotions() from public;
grant execute on function public.admin_list_promotions() to authenticated;

drop function if exists public.admin_list_ad_space_orders();
create function public.admin_list_ad_space_orders()
returns table (
  id uuid, title text, image_url text, duration_days integer, price_egp numeric, status text,
  payment_method text, payment_sender_name text, payment_contact_phone text, payment_submitted_at timestamptz,
  payment_ref text, admin_note text, paid_at timestamptz, starts_at timestamptz, ends_at timestamptz, created_at timestamptz,
  payer_id uuid, payer_name text, payer_phone text, payer_email text
)
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.expire_ad_space_orders();
  return query
    select o.id, o.title::text, o.image_url::text, o.duration_days::integer, o.price_egp::numeric, o.status::text,
           o.payment_method::text, o.payment_sender_name::text, o.payment_contact_phone::text, o.payment_submitted_at,
           o.payment_ref::text, o.admin_note::text, o.paid_at, o.starts_at, o.ends_at, o.created_at,
           o.payer_id,
           coalesce(p.full_name::text, o.payer_name::text),
           coalesce(p.phone_e164::text, o.payer_phone::text),
           coalesce(u.email::text, o.payer_email::text)
      from public.ad_space_orders o
      left join public.profiles p on p.id = o.payer_id
      left join auth.users u on u.id = o.payer_id
     order by o.created_at desc;
end;
$$;
revoke all on function public.admin_list_ad_space_orders() from public;
grant execute on function public.admin_list_ad_space_orders() to authenticated;

notify pgrst, 'reload schema';
