-- supabase/migrations/20261023000000_ad_promotions_and_payment_methods.sql
--
-- 1) طرق الدفع الثلاث (فودافون كاش / اتصالات كاش / إنستاباي) لفاتورة «تم البيع / تم الإيجار» بدون إيميل إنستاباي:
--    property_deals.payment_method + الدالة الجديدة confirm_deal_payment(deal, method, اسم المرسل ثلاثيًا, رقم التواصل).
--    (دالة submit_deal_payment القديمة بتفضل كما هى حتى لا تتعطل نسخ التطبيق القديمة.)
-- 2) «اجعل الإعلان افتتاحي / مميز» (ترويج مدفوع 7 أيام):
--    promo_settings (الأسعار والمدة يعدّلها الأدمن)، ad_promotions (الطلبات والفواتير)،
--    create_ad_promotion / confirm_promotion_payment / cancel_ad_promotion (الناشر)،
--    admin_list_promotions / admin_update_promotion (الأدمن، صلاحية deals) — وعند «تفعيل» الأدمن بعد مراجعة السداد
--    تُنشأ صف فى sponsored_reels (نفس نظام الريلز الممولة الحالى: افتتاحي = intro، مميز = in_feed) بتاريخ نهاية بعد 7 أيام.
-- 3) إغلاق الإعلان بصفقة يوقف ترويجه تلقائيًا.
-- 4) حذف الحساب: يمنع أيضًا لو فى ترويج دُفع وبانتظار المراجعة.

-- ---------------------------------------------------------------------
-- 1) طرق الدفع لفاتورة الصفقات
-- ---------------------------------------------------------------------
alter table public.property_deals
  add column if not exists payment_method text check (payment_method in ('vodafone_cash', 'etisalat_cash', 'instapay'));

create or replace function public.confirm_deal_payment(
  p_deal_id uuid,
  p_method text,
  p_sender_name text,
  p_contact_phone text
)
returns public.property_deals
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_deal public.property_deals%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_sender_name, '')), '\s+', ' ', 'g');
  v_phone text := btrim(coalesce(p_contact_phone, ''));
  v_row public.property_deals%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_deal from public.property_deals where id = p_deal_id for update;
  if not found or v_deal.payer_id is distinct from v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_deal.status in ('paid', 'waived') then
    raise exception 'deal_closed';
  end if;

  if p_method not in ('vodafone_cash', 'etisalat_cash', 'instapay') then
    raise exception 'bad_method';
  end if;
  -- اسم الراسل ثلاثى: ثلاث كلمات على الأقل.
  if char_length(v_name) > 120 or coalesce(array_length(regexp_split_to_array(v_name, ' '), 1), 0) < 3 then
    raise exception 'bad_sender_name';
  end if;
  if char_length(regexp_replace(v_phone, '\D', '', 'g')) not between 7 and 15 or char_length(v_phone) > 30 then
    raise exception 'bad_contact_phone';
  end if;

  update public.property_deals
     set status = 'submitted',
         payment_method = p_method,
         payment_sender_name = v_name,
         payment_contact_phone = v_phone,
         payment_submitted_at = now()
   where id = p_deal_id
   returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.confirm_deal_payment(uuid, text, text, text) from public;
grant execute on function public.confirm_deal_payment(uuid, text, text, text) to authenticated;

drop function if exists public.admin_list_deals();
create or replace function public.admin_list_deals()
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
    select d.id, d.property_id, d.property_title, d.property_province, d.deal_type, d.fee_egp, d.status,
           d.reported_at, d.due_at, d.paid_at, d.payment_ref, d.note, d.admin_note,
           d.payer_id,
           coalesce(p.full_name, d.payer_name),
           coalesce(p.phone_e164, d.payer_phone),
           coalesce(u.email::text, d.payer_email),
           coalesce(d.payer_account_type, p.account_type),
           d.payment_sender_name, d.payment_sender_email, d.payment_contact_phone, d.payment_submitted_at,
           d.payment_method
      from public.property_deals d
      left join public.profiles p on p.id = d.payer_id
      left join auth.users u on u.id = d.payer_id
     order by d.reported_at desc;
end;
$$;
revoke all on function public.admin_list_deals() from public;
grant execute on function public.admin_list_deals() to authenticated;

-- ---------------------------------------------------------------------
-- 2) الترويج المدفوع
-- ---------------------------------------------------------------------
create table if not exists public.promo_settings (
  id boolean primary key default true check (id),
  featured_price_egp numeric(10,2) not null default 300 check (featured_price_egp >= 0),
  intro_price_3000_egp numeric(10,2) not null default 1000 check (intro_price_3000_egp >= 0),
  intro_price_5000_egp numeric(10,2) not null default 2000 check (intro_price_5000_egp >= 0),
  duration_days integer not null default 7 check (duration_days between 1 and 90),
  updated_at timestamptz not null default now()
);
insert into public.promo_settings (id) values (true) on conflict (id) do nothing;
alter table public.promo_settings enable row level security;

drop policy if exists "promo settings are readable" on public.promo_settings;
create policy "promo settings are readable"
  on public.promo_settings for select to authenticated using (true);

drop policy if exists "admins can update promo settings" on public.promo_settings;
create policy "admins can update promo settings"
  on public.promo_settings for update to authenticated
  using (public.admin_has_permission('deals'))
  with check (public.admin_has_permission('deals'));

create table if not exists public.ad_promotions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  property_title text not null default '',
  payer_id uuid references auth.users(id) on delete set null,
  payer_name text,
  payer_phone text,
  payer_email text,
  kind text not null check (kind in ('featured', 'intro')),
  reach_goal integer,
  age_min integer,
  age_max integer,
  duration_days integer not null,
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
  sponsored_reel_id uuid references public.sponsored_reels(id) on delete set null,
  created_at timestamptz not null default now(),
  handled_by uuid,
  handled_at timestamptz,
  constraint ad_promotions_kind_goal check (
    (kind = 'featured' and reach_goal is null) or (kind = 'intro' and reach_goal in (3000, 5000))
  ),
  constraint ad_promotions_age_range check (
    (age_min is null and age_max is null)
    or (age_min >= 18 and (age_max is null or age_max >= age_min) and (age_max is null or age_max <= 100))
  )
);

create index if not exists ad_promotions_payer_idx on public.ad_promotions (payer_id, created_at desc);
create index if not exists ad_promotions_property_idx on public.ad_promotions (property_id);
-- طلب واحد فعّال/معلّق لكل إعلان ونوع.
create unique index if not exists ad_promotions_one_open_per_kind
  on public.ad_promotions (property_id, kind)
  where status in ('pending_payment', 'submitted', 'active') and property_id is not null;

alter table public.ad_promotions enable row level security;
drop policy if exists "owners read own promotions, admins read all" on public.ad_promotions;
create policy "owners read own promotions, admins read all"
  on public.ad_promotions for select to authenticated
  using (payer_id = auth.uid() or public.admin_has_permission('deals'));
-- لا سياسات إدراج/تعديل/حذف: كل الكتابة عبر الدوال أدناه (SECURITY DEFINER).

-- إنهاء الترويجات المنتهية (7 أيام) تلقائيًا عند أول استدعاء.
create or replace function public.expire_ad_promotions()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.sponsored_reels sr
     set active = false
   where sr.id in (
     select p.sponsored_reel_id from public.ad_promotions p
      where p.status = 'active' and p.ends_at < now() and p.sponsored_reel_id is not null
   );
  update public.ad_promotions set status = 'expired' where status = 'active' and ends_at < now();
end;
$$;
revoke all on function public.expire_ad_promotions() from public;

create or replace function public.create_ad_promotion(
  p_property_id uuid,
  p_kind text,
  p_reach_goal integer default null,
  p_age_min integer default null,
  p_age_max integer default null
)
returns public.ad_promotions
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prop public.properties%rowtype;
  v_set public.promo_settings%rowtype;
  v_price numeric;
  v_goal integer;
  v_name text;
  v_phone text;
  v_email text;
  v_row public.ad_promotions%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  perform public.expire_ad_promotions();

  select * into v_prop from public.properties where id = p_property_id;
  if not found or v_prop.seller_id <> v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_prop.moderation_status is distinct from 'approved' or v_prop.closed_at is not null then
    raise exception 'ad_not_promotable';
  end if;
  if p_kind not in ('featured', 'intro') then
    raise exception 'bad_kind';
  end if;
  if p_age_min is null and p_age_max is not null then
    raise exception 'bad_age';
  end if;
  if p_age_min is not null and (p_age_min < 18 or (p_age_max is not null and (p_age_max < p_age_min or p_age_max > 100))) then
    raise exception 'bad_age';
  end if;

  select * into v_set from public.promo_settings where id = true;
  if p_kind = 'featured' then
    v_goal := null;
    v_price := v_set.featured_price_egp;
  else
    v_goal := p_reach_goal;
    if v_goal = 3000 then v_price := v_set.intro_price_3000_egp;
    elsif v_goal = 5000 then v_price := v_set.intro_price_5000_egp;
    else raise exception 'bad_reach_goal';
    end if;
  end if;

  if exists (
    select 1 from public.ad_promotions
     where property_id = p_property_id and kind = p_kind
       and status in ('pending_payment', 'submitted', 'active')
  ) then
    raise exception 'already_promoted';
  end if;

  select p.full_name, p.phone_e164, u.email::text
    into v_name, v_phone, v_email
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = v_uid;

  insert into public.ad_promotions (
    property_id, property_title, payer_id, payer_name, payer_phone, payer_email,
    kind, reach_goal, age_min, age_max, duration_days, price_egp
  )
  values (
    p_property_id, coalesce(v_prop.short_title, v_prop.title, ''), v_uid, v_name, v_phone, v_email,
    p_kind, v_goal, p_age_min, p_age_max, v_set.duration_days, v_price
  )
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.create_ad_promotion(uuid, text, integer, integer, integer) from public;
grant execute on function public.create_ad_promotion(uuid, text, integer, integer, integer) to authenticated;

create or replace function public.confirm_promotion_payment(
  p_id uuid,
  p_method text,
  p_sender_name text,
  p_contact_phone text
)
returns public.ad_promotions
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.ad_promotions%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_sender_name, '')), '\s+', ' ', 'g');
  v_phone text := btrim(coalesce(p_contact_phone, ''));
  v_row public.ad_promotions%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_order from public.ad_promotions where id = p_id for update;
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

  update public.ad_promotions
     set status = 'submitted',
         payment_method = p_method,
         payment_sender_name = v_name,
         payment_contact_phone = v_phone,
         payment_submitted_at = now()
   where id = p_id
   returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.confirm_promotion_payment(uuid, text, text, text) from public;
grant execute on function public.confirm_promotion_payment(uuid, text, text, text) to authenticated;

create or replace function public.cancel_ad_promotion(p_id uuid)
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
  update public.ad_promotions
     set status = 'cancelled'
   where id = p_id and payer_id = v_uid and status = 'pending_payment';
  if not found then
    raise exception 'cannot_cancel';
  end if;
end;
$$;
revoke all on function public.cancel_ad_promotion(uuid) from public;
grant execute on function public.cancel_ad_promotion(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- الأدمن
-- ---------------------------------------------------------------------
create or replace function public.admin_list_promotions()
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
    select a.id, a.property_id, a.property_title, a.kind, a.reach_goal, a.age_min, a.age_max,
           a.duration_days, a.price_egp, a.status, a.payment_method, a.payment_sender_name,
           a.payment_contact_phone, a.payment_submitted_at, a.payment_ref, a.admin_note,
           a.paid_at, a.starts_at, a.ends_at, a.created_at,
           a.payer_id,
           coalesce(p.full_name, a.payer_name),
           coalesce(p.phone_e164, a.payer_phone),
           coalesce(u.email::text, a.payer_email),
           coalesce(sr.current_reach, 0)
      from public.ad_promotions a
      left join public.profiles p on p.id = a.payer_id
      left join auth.users u on u.id = a.payer_id
      left join public.sponsored_reels sr on sr.id = a.sponsored_reel_id
     order by a.created_at desc;
end;
$$;
revoke all on function public.admin_list_promotions() from public;
grant execute on function public.admin_list_promotions() to authenticated;

-- «active» = تأكيد السداد وتفعيل الترويج (يُنشئ/يُفعّل صف sponsored_reels). أى حالة أخرى توقف الترويج لو كان شغالًا.
create or replace function public.admin_update_promotion(
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
  v_order public.ad_promotions%rowtype;
  v_prop public.properties%rowtype;
  v_reel uuid;
  v_start date := current_date;
  v_end date;
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('pending_payment', 'submitted', 'active', 'rejected', 'cancelled') then
    raise exception 'bad_status';
  end if;

  select * into v_order from public.ad_promotions where id = p_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  if p_status = 'active' then
    if v_order.property_id is null then
      raise exception 'property_unavailable';
    end if;
    select * into v_prop from public.properties where id = v_order.property_id;
    if not found or v_prop.closed_at is not null then
      raise exception 'property_unavailable';
    end if;

    if v_order.status = 'active' then
      -- مفعّل بالفعل: نحدّث الملاحظات فقط ولا نمدّد المدة.
      update public.ad_promotions
         set payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
             admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
             handled_by = auth.uid(), handled_at = now()
       where id = p_id;
      return;
    end if;

    v_end := v_start + (v_order.duration_days - 1);
    v_reel := v_order.sponsored_reel_id;
    if v_reel is not null and exists (select 1 from public.sponsored_reels where id = v_reel) then
      update public.sponsored_reels
         set active = true, start_date = v_start, end_date = v_end,
             reach_goal = v_order.reach_goal, current_reach = 0,
             age_min = v_order.age_min, age_max = v_order.age_max
       where id = v_reel;
    else
      insert into public.sponsored_reels (property_id, placement, reach_goal, age_min, age_max, gender_target, active, start_date, end_date)
      values (v_order.property_id, case when v_order.kind = 'intro' then 'intro' else 'in_feed' end,
              v_order.reach_goal, v_order.age_min, v_order.age_max, 'all', true, v_start, v_end)
      returning id into v_reel;
    end if;

    update public.ad_promotions
       set status = 'active', paid_at = coalesce(paid_at, now()),
           starts_at = now(), ends_at = now() + make_interval(days => v_order.duration_days),
           sponsored_reel_id = v_reel,
           payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
           admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
           handled_by = auth.uid(), handled_at = now()
     where id = p_id;
  else
    if v_order.sponsored_reel_id is not null then
      update public.sponsored_reels set active = false where id = v_order.sponsored_reel_id;
    end if;
    update public.ad_promotions
       set status = p_status,
           payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
           admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
           handled_by = auth.uid(), handled_at = now()
     where id = p_id;
  end if;
end;
$$;
revoke all on function public.admin_update_promotion(uuid, text, text, text) from public;
grant execute on function public.admin_update_promotion(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) إغلاق الإعلان بصفقة (تم البيع / تم الإيجار) يوقف ترويجه
-- ---------------------------------------------------------------------
create or replace function public.stop_promotions_when_ad_closed()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.closed_at is not null and old.closed_at is null then
    update public.sponsored_reels set active = false where property_id = new.id;
    update public.ad_promotions set status = 'cancelled' where property_id = new.id and status = 'pending_payment';
    update public.ad_promotions set status = 'expired' where property_id = new.id and status = 'active';
  end if;
  return null;
end;
$$;

drop trigger if exists stop_promotions_when_ad_closed on public.properties;
create trigger stop_promotions_when_ad_closed
  after update of closed_at on public.properties
  for each row
  when (new.closed_at is not null and old.closed_at is null)
  execute function public.stop_promotions_when_ad_closed();

-- ---------------------------------------------------------------------
-- 4) حذف الحساب: الرسم أو الترويج المُؤكَّد سداده وبانتظار المراجعة يمنع الحذف
-- ---------------------------------------------------------------------
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
    select 1 from public.ad_promotions
     where payer_id = v_uid and status = 'submitted'
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
