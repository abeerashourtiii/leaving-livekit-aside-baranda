-- supabase/migrations/20261024000000_ad_space_orders.sql
--
-- حجز «المساحة الإعلانية» (بانر صفحة القائمة + صفحة البحث) من داخل التطبيق بدل واتساب:
--   المعلن يرفع صورة إعلانه ويختار المدة (7 أيام = 1500 ج، 14 يومًا = 2500 ج، 30 يومًا = 4000 ج) ثم يسدّد بفودافون كاش /
--   اتصالات كاش / إنستاباي ويكتب اسم الراسل ثلاثيًا ورقم التواصل ← يراجع الأدمن السداد والصورة ← «تأكيد وتفعيل» يُنشئ صف فى
--   ad_banners (نفس نظام الأدمن الحالى: يظهر فى القائمة وفى كل فلاتر البحث) بتاريخ نهاية حسب المدة.
--   الإعلان «الحصرى» يتم التواصل بشأنه عبر واتساب (من الصفحة، لا يمر بهذا الجدول).
--   promo_settings: أسعار الباقات الثلاث (يعدّلها الأدمن).

alter table public.promo_settings
  add column if not exists banner_price_7_egp numeric(10,2) not null default 1500 check (banner_price_7_egp >= 0),
  add column if not exists banner_price_14_egp numeric(10,2) not null default 2500 check (banner_price_14_egp >= 0),
  add column if not exists banner_price_30_egp numeric(10,2) not null default 4000 check (banner_price_30_egp >= 0);

create table if not exists public.ad_space_orders (
  id uuid primary key default gen_random_uuid(),
  payer_id uuid references auth.users(id) on delete set null,
  payer_name text,
  payer_phone text,
  payer_email text,
  title text not null default '',
  image_url text not null,
  duration_days integer not null check (duration_days in (7, 14, 30)),
  price_egp numeric(10,2) not null,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'submitted', 'active', 'rejected', 'cancelled', 'expired')),
  payment_method text check (payment_method in ('vodafone_cash', 'etisalat_cash', 'instapay')),
  payment_sender_name text,
  payment_contact_phone text,
  payment_submitted_at timestamptz,
  payment_ref text,
  admin_note text,
  paid_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  banner_id uuid references public.ad_banners(id) on delete set null,
  created_at timestamptz not null default now(),
  handled_by uuid,
  handled_at timestamptz
);

create index if not exists ad_space_orders_payer_idx on public.ad_space_orders (payer_id, created_at desc);
create index if not exists ad_space_orders_status_idx on public.ad_space_orders (status, created_at desc);

alter table public.ad_space_orders enable row level security;
drop policy if exists "owners read own ad space orders, admins read all" on public.ad_space_orders;
create policy "owners read own ad space orders, admins read all"
  on public.ad_space_orders for select to authenticated
  using (payer_id = auth.uid() or public.admin_has_permission('deals'));
-- لا سياسات كتابة: كل التعديلات عبر الدوال أدناه.

create or replace function public.expire_ad_space_orders()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.ad_banners b
     set active = false
   where b.id in (
     select o.banner_id from public.ad_space_orders o
      where o.status = 'active' and o.ends_at < now() and o.banner_id is not null
   );
  update public.ad_space_orders set status = 'expired' where status = 'active' and ends_at < now();
end;
$$;
revoke all on function public.expire_ad_space_orders() from public;

create or replace function public.create_ad_space_order(
  p_image_url text,
  p_duration_days integer,
  p_title text default null
)
returns public.ad_space_orders
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_set public.promo_settings%rowtype;
  v_price numeric;
  v_url text := btrim(coalesce(p_image_url, ''));
  v_name text;
  v_phone text;
  v_email text;
  v_row public.ad_space_orders%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if v_url !~ '^https://' or char_length(v_url) > 1000 then
    raise exception 'bad_image';
  end if;

  select * into v_set from public.promo_settings where id = true;
  if p_duration_days = 7 then v_price := v_set.banner_price_7_egp;
  elsif p_duration_days = 14 then v_price := v_set.banner_price_14_egp;
  elsif p_duration_days = 30 then v_price := v_set.banner_price_30_egp;
  else raise exception 'bad_duration';
  end if;

  -- حد أقصى 5 طلبات مفتوحة غير مسدّدة لكل مستخدم (منع الإغراق).
  if (select count(*) from public.ad_space_orders where payer_id = v_uid and status = 'pending_payment') >= 5 then
    raise exception 'too_many_open_orders';
  end if;

  select p.full_name, p.phone_e164, u.email::text
    into v_name, v_phone, v_email
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = v_uid;

  insert into public.ad_space_orders (payer_id, payer_name, payer_phone, payer_email, title, image_url, duration_days, price_egp)
  values (v_uid, v_name, v_phone, v_email, left(coalesce(nullif(btrim(p_title), ''), 'إعلان ' || coalesce(v_name, '')), 120), v_url, p_duration_days, v_price)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.create_ad_space_order(text, integer, text) from public;
grant execute on function public.create_ad_space_order(text, integer, text) to authenticated;

create or replace function public.confirm_ad_space_payment(
  p_id uuid,
  p_method text,
  p_sender_name text,
  p_contact_phone text
)
returns public.ad_space_orders
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.ad_space_orders%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_sender_name, '')), '\s+', ' ', 'g');
  v_phone text := btrim(coalesce(p_contact_phone, ''));
  v_row public.ad_space_orders%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_order from public.ad_space_orders where id = p_id for update;
  if not found or v_order.payer_id is distinct from v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_order.status not in ('pending_payment', 'submitted', 'rejected') then
    raise exception 'order_closed';
  end if;
  if p_method not in ('vodafone_cash', 'etisalat_cash', 'instapay') then
    raise exception 'bad_method';
  end if;
  if char_length(v_name) > 120 or coalesce(array_length(regexp_split_to_array(v_name, ' '), 1), 0) < 3 then
    raise exception 'bad_sender_name';
  end if;
  if char_length(regexp_replace(v_phone, '\D', '', 'g')) not between 7 and 15 or char_length(v_phone) > 30 then
    raise exception 'bad_contact_phone';
  end if;

  update public.ad_space_orders
     set status = 'submitted', payment_method = p_method, payment_sender_name = v_name,
         payment_contact_phone = v_phone, payment_submitted_at = now()
   where id = p_id
   returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.confirm_ad_space_payment(uuid, text, text, text) from public;
grant execute on function public.confirm_ad_space_payment(uuid, text, text, text) to authenticated;

create or replace function public.cancel_ad_space_order(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.ad_space_orders set status = 'cancelled'
   where id = p_id and payer_id = v_uid and status = 'pending_payment';
  if not found then
    raise exception 'cannot_cancel';
  end if;
end;
$$;
revoke all on function public.cancel_ad_space_order(uuid) from public;
grant execute on function public.cancel_ad_space_order(uuid) to authenticated;

create or replace function public.admin_list_ad_space_orders()
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
    select o.id, o.title, o.image_url, o.duration_days, o.price_egp, o.status,
           o.payment_method, o.payment_sender_name, o.payment_contact_phone, o.payment_submitted_at,
           o.payment_ref, o.admin_note, o.paid_at, o.starts_at, o.ends_at, o.created_at,
           o.payer_id,
           coalesce(p.full_name, o.payer_name),
           coalesce(p.phone_e164, o.payer_phone),
           coalesce(u.email::text, o.payer_email)
      from public.ad_space_orders o
      left join public.profiles p on p.id = o.payer_id
      left join auth.users u on u.id = o.payer_id
     order by o.created_at desc;
end;
$$;
revoke all on function public.admin_list_ad_space_orders() from public;
grant execute on function public.admin_list_ad_space_orders() to authenticated;

-- «active» = مراجعة السداد والصورة ثم تفعيل: يُنشئ بانر فى ad_banners يبدأ اليوم وينتهى بعد (المدة) يومًا. أى حالة أخرى توقف البانر.
create or replace function public.admin_update_ad_space_order(
  p_id uuid,
  p_status text,
  p_payment_ref text default null,
  p_admin_note text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_order public.ad_space_orders%rowtype;
  v_banner uuid;
  v_start date := current_date;
  v_end date;
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('pending_payment', 'submitted', 'active', 'rejected', 'cancelled') then
    raise exception 'bad_status';
  end if;
  select * into v_order from public.ad_space_orders where id = p_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  if p_status = 'active' then
    if v_order.status = 'active' then
      update public.ad_space_orders
         set payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
             admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
             handled_by = auth.uid(), handled_at = now()
       where id = p_id;
      return;
    end if;
    v_end := v_start + (v_order.duration_days - 1);
    v_banner := v_order.banner_id;
    if v_banner is not null and exists (select 1 from public.ad_banners where id = v_banner) then
      update public.ad_banners set active = true, start_date = v_start, end_date = v_end, image_url = v_order.image_url
       where id = v_banner;
    else
      insert into public.ad_banners (title, image_url, start_date, end_date, active, sort_order)
      values (v_order.title, v_order.image_url, v_start, v_end, true, 0)
      returning id into v_banner;
    end if;
    update public.ad_space_orders
       set status = 'active', paid_at = coalesce(paid_at, now()),
           starts_at = now(), ends_at = now() + make_interval(days => v_order.duration_days),
           banner_id = v_banner,
           payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
           admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
           handled_by = auth.uid(), handled_at = now()
     where id = p_id;
  else
    if v_order.banner_id is not null then
      update public.ad_banners set active = false where id = v_order.banner_id;
    end if;
    update public.ad_space_orders
       set status = p_status,
           payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
           admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
           handled_by = auth.uid(), handled_at = now()
     where id = p_id;
  end if;
end;
$$;
revoke all on function public.admin_update_ad_space_order(uuid, text, text, text) from public;
grant execute on function public.admin_update_ad_space_order(uuid, text, text, text) to authenticated;

-- حذف الحساب: يمنع أيضًا لو فى حجز مساحة إعلانية دُفع وبانتظار المراجعة (نفس نسخة 20261023 + ad_space_orders).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.property_deals
     where payer_id = v_uid and status in ('reported', 'invoiced', 'submitted', 'disputed')
  ) or exists (
    select 1 from public.ad_promotions where payer_id = v_uid and status = 'submitted'
  ) or exists (
    select 1 from public.ad_space_orders where payer_id = v_uid and status = 'submitted'
  ) then
    raise exception 'has_open_fees';
  end if;

  if exists (select 1 from public.user_roles where user_id = v_uid and is_super_admin) then
    raise exception 'super_admin_cannot_delete';
  end if;

  perform set_config('app.account_deletion', 'on', true);
  delete from auth.users where id = v_uid;
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
