-- supabase/migrations/20261022000000_deal_fees_instapay.sql
--
-- «رسوم الخدمة» + فاتورة InstaPay + إظهار الإعلان المُغلق (تم البيع / تم الإيجار) فى صفحة المعلن:
--  1) deal_settings.fee_rent_egp : رسم الإيجار (500 ج.م) منفصل عن رسم البيع fee_egp (1000 ج.م).
--  2) property_deals             : حالة جديدة 'submitted' (الناشر أكّد السداد، بانتظار مراجعة التطبيق) + بيانات التأكيد
--                                  (اسم المرسل كما فى InstaPay / بريد حسابه / رقم التواصل / وقت التأكيد).
--  3) report_property_deal       : الرسم حسب نوع الصفقة (بيع 1000 / إيجار 500 من الإعدادات).
--  4) submit_deal_payment        : الناشر وحده يؤكد السداد ويُدخل البيانات الثلاث → الحالة 'submitted'.
--  5) admin_list_deals / admin_update_deal : تعرض بيانات التأكيد، وتقبل الحالة الجديدة.
--  6) RLS properties             : الإعلان المُغلق بصفقة يبقى ظاهرًا لصفحة المعلن للجميع؛ ويُخفى من الريلز والبحث والخريطة
--                                  بفلتر closed_at is null (فى التطبيق ودوال الخريطة تحت). التعليقات (سياسات reel_comments تحت) والعروض عليه ممنوعة كما كانت.
--  7) delete_my_account          : الرسم المُؤكَّد سداده وبانتظار المراجعة يمنع حذف الحساب كذلك.

-- ---------------------------------------------------------------------
-- 1) الإعدادات
-- ---------------------------------------------------------------------
alter table public.deal_settings
  add column if not exists fee_rent_egp numeric(10,2) not null default 500 check (fee_rent_egp >= 0);

-- ---------------------------------------------------------------------
-- 2) property_deals: حالة 'submitted' + بيانات تأكيد السداد
-- ---------------------------------------------------------------------
alter table public.property_deals
  add column if not exists payment_sender_name text,
  add column if not exists payment_sender_email text,
  add column if not exists payment_contact_phone text,
  add column if not exists payment_submitted_at timestamptz;

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.property_deals'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.property_deals drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.property_deals
  add constraint property_deals_status_check
  check (status in ('reported', 'invoiced', 'submitted', 'paid', 'disputed', 'waived'));

-- ---------------------------------------------------------------------
-- 3) report_property_deal: الرسم حسب نوع الصفقة
-- ---------------------------------------------------------------------
create or replace function public.report_property_deal(
  p_property_id uuid,
  p_deal_type text,
  p_note text default null
)
returns public.property_deals
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prop public.properties%rowtype;
  v_set public.deal_settings%rowtype;
  v_type text;
  v_name text;
  v_phone text;
  v_email text;
  v_fee numeric;
  v_row public.property_deals%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_prop from public.properties where id = p_property_id for update;
  if not found or v_prop.seller_id <> v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if p_deal_type not in ('sale', 'rent') or p_deal_type <> v_prop.purpose then
    raise exception 'type_mismatch';
  end if;

  if exists (
    select 1 from public.property_deals
    where property_id = p_property_id and status <> 'waived'
  ) then
    raise exception 'already_reported';
  end if;

  select * into v_set from public.deal_settings where id = true;
  v_fee := case when p_deal_type = 'rent' then coalesce(v_set.fee_rent_egp, 500) else coalesce(v_set.fee_egp, 1000) end;

  select p.account_type, p.full_name, p.phone_e164, u.email::text
    into v_type, v_name, v_phone, v_email
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = v_uid;

  insert into public.property_deals (
    property_id, property_title, property_province, payer_id, payer_account_type,
    payer_name, payer_phone, payer_email,
    deal_type, fee_egp, due_at, note
  )
  values (
    p_property_id, coalesce(v_prop.short_title, v_prop.title, ''), v_prop.province, v_uid, v_type,
    v_name, v_phone, v_email,
    p_deal_type, v_fee,
    now() + make_interval(days => coalesce(v_set.pay_days, 7)),
    nullif(left(coalesce(p_note, ''), 500), '')
  )
  returning * into v_row;

  perform set_config('app.deal_rpc', 'on', true);
  update public.properties
     set closed_at = now(),
         closed_type = case when p_deal_type = 'sale' then 'sold' else 'rented' end,
         pinned = false,
         pinned_at = null
   where id = p_property_id;

  return v_row;
end;
$$;

revoke all on function public.report_property_deal(uuid, text, text) from public;
grant execute on function public.report_property_deal(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) الناشر: تأكيد السداد (علامة «تم السداد» + اسم المرسل + بريد InstaPay + رقم التواصل)
-- ---------------------------------------------------------------------
create or replace function public.submit_deal_payment(
  p_deal_id uuid,
  p_sender_name text,
  p_sender_email text,
  p_contact_phone text
)
returns public.property_deals
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_deal public.property_deals%rowtype;
  v_name text := btrim(coalesce(p_sender_name, ''));
  v_email text := lower(btrim(coalesce(p_sender_email, '')));
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

  if char_length(v_name) < 3 or char_length(v_name) > 120 then
    raise exception 'bad_sender_name';
  end if;
  -- InstaPay: عنوان الدفع قد يكون بريدًا (name@instapay) أو بريدًا إلكترونيًا عاديًا.
  if char_length(v_email) < 5 or char_length(v_email) > 160 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'bad_sender_email';
  end if;
  if char_length(regexp_replace(v_phone, '\D', '', 'g')) < 7 or char_length(v_phone) > 30 then
    raise exception 'bad_contact_phone';
  end if;

  update public.property_deals
     set status = 'submitted',
         payment_sender_name = v_name,
         payment_sender_email = v_email,
         payment_contact_phone = v_phone,
         payment_submitted_at = now()
   where id = p_deal_id
   returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.submit_deal_payment(uuid, text, text, text) from public;
grant execute on function public.submit_deal_payment(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) الأدمن: القائمة (مع بيانات التأكيد) والتحديث (مع الحالة الجديدة)
-- ---------------------------------------------------------------------
drop function if exists public.admin_list_deals();

create or replace function public.admin_list_deals()
returns table (
  id uuid,
  property_id uuid,
  property_title text,
  property_province text,
  deal_type text,
  fee_egp numeric,
  status text,
  reported_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  payment_ref text,
  note text,
  admin_note text,
  payer_id uuid,
  payer_name text,
  payer_phone text,
  payer_email text,
  payer_account_type text,
  payment_sender_name text,
  payment_sender_email text,
  payment_contact_phone text,
  payment_submitted_at timestamptz
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
           d.payment_sender_name, d.payment_sender_email, d.payment_contact_phone, d.payment_submitted_at
      from public.property_deals d
      left join public.profiles p on p.id = d.payer_id
      left join auth.users u on u.id = d.payer_id
     order by d.reported_at desc;
end;
$$;

revoke all on function public.admin_list_deals() from public;
grant execute on function public.admin_list_deals() to authenticated;

create or replace function public.admin_update_deal(
  p_id uuid,
  p_status text,
  p_payment_ref text default null,
  p_admin_note text default null,
  p_reopen boolean default false
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_deal public.property_deals%rowtype;
  v_pay_days integer;
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('reported', 'invoiced', 'submitted', 'paid', 'disputed', 'waived') then
    raise exception 'bad_status';
  end if;

  select * into v_deal from public.property_deals where id = p_id for update;
  if not found then
    raise exception 'deal_not_found';
  end if;
  select coalesce(pay_days, 7) into v_pay_days from public.deal_settings where id = true;

  update public.property_deals
     set status = p_status,
         paid_at = case when p_status = 'paid' then coalesce(paid_at, now()) else null end,
         due_at = case when p_status = 'invoiced' then now() + make_interval(days => coalesce(v_pay_days, 7)) else due_at end,
         payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
         admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
         handled_by = auth.uid(),
         handled_at = now()
   where id = p_id;

  -- إلغاء الصفقة (مثلًا أُبلغ عنها بالخطأ) مع إعادة فتح الإعلان.
  if p_status = 'waived' and p_reopen and v_deal.property_id is not null then
    perform set_config('app.deal_rpc', 'on', true);
    update public.properties set closed_at = null, closed_type = null where id = v_deal.property_id;
  end if;
end;
$$;

revoke all on function public.admin_update_deal(uuid, text, text, text, boolean) from public;
grant execute on function public.admin_update_deal(uuid, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 6) الإعلان المُغلق بصفقة: يظهر فى صفحة المعلن (للجميع) ويُخفى من الريلز والبحث
-- ---------------------------------------------------------------------
drop policy if exists "approved properties are public, own listings always visible" on public.properties;
create policy "approved properties are public, own listings always visible"
  on public.properties for select
  to authenticated
  using (
    moderation_status = 'approved'
    or seller_id = auth.uid()
    or public.admin_has_permission('reels')
    or public.admin_has_permission('deals')
  );

-- دوال البحث بالخريطة: لا تُرجع الإعلانات المُغلقة بصفقة (نفس النسخة السابقة + شرط closed_at is null).
create or replace function public.properties_in_radius(
  center_lat double precision,
  center_lng double precision,
  radius_km double precision,
  p_purpose text default null,
  p_type text default null,
  p_provinces text[] default null,
  p_regions text[] default null,
  p_price_min numeric default null,
  p_price_max numeric default null,
  p_area_min numeric default null,
  p_area_max numeric default null,
  p_min_rooms numeric default null,
  p_query text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table(id uuid)
language sql stable
as $$
  select p.id
  from public.properties p
  where p.lat is not null and p.lng is not null
    and p.closed_at is null
    and earth_box(ll_to_earth(center_lat, center_lng), radius_km * 1000) @> ll_to_earth(p.lat, p.lng)
    and earth_distance(ll_to_earth(center_lat, center_lng), ll_to_earth(p.lat, p.lng)) <= radius_km * 1000
    and (p_purpose is null or p_purpose = 'all' or p.purpose = p_purpose)
    and (p_type is null or p_type = 'all' or p.type = p_type)
    and (p_provinces is null or p.province = any(p_provinces))
    and (p_regions is null or p.location = any(p_regions))
    and (p_price_min is null or p.price >= p_price_min)
    and (p_price_max is null or p.price <= p_price_max)
    and (p_area_min is null or p.area >= p_area_min)
    and (p_area_max is null or p.area <= p_area_max)
    and (p_min_rooms is null or p.rooms >= p_min_rooms)
    and (
      p_query is null or p_query = '' or
      p.title ilike '%' || p_query || '%' or p.location ilike '%' || p_query || '%' or
      p.type ilike '%' || p_query || '%' or p.description ilike '%' || p_query || '%' or
      p.province ilike '%' || p_query || '%'
    )
  order by p.created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.properties_in_radius(
  double precision, double precision, double precision, text, text, text[], text[],
  numeric, numeric, numeric, numeric, numeric, text, int, int
) to authenticated;

create or replace function public.properties_in_bounds(
  min_lat double precision,
  max_lat double precision,
  min_lng double precision,
  max_lng double precision,
  p_purpose text default null,
  p_type text default null,
  p_limit int default 500
)
returns table(id uuid)
language sql stable
as $$
  select p.id
  from public.properties p
  where p.lat is not null and p.lng is not null
    and p.closed_at is null
    and p.lat between min_lat and max_lat
    and p.lng between min_lng and max_lng
    and (p_purpose is null or p_purpose = 'all' or p.purpose = p_purpose)
    and (p_type is null or p_type = 'all' or p.type = p_type)
  order by p.created_at desc
  limit p_limit;
$$;

grant execute on function public.properties_in_bounds(
  double precision, double precision, double precision, double precision, text, text, int
) to authenticated;

-- التعليقات: سياساتها كانت تعتمد على «العقار ظاهر للمستخدم»، وبعد إظهار الإعلان المُغلق فى صفحة المعلن يجب أن تبقى
-- التعليقات الجديدة ممنوعة عليه، وقراءة تعليقاته لصاحبه فقط (نفس السلوك السابق).
drop policy if exists "comments readable when the reel is visible" on public.reel_comments;
create policy "comments readable when the reel is visible"
  on public.reel_comments for select
  to authenticated
  using (
    exists (
      select 1 from public.properties p
       where p.id = property_id
         and (p.closed_at is null or p.seller_id = auth.uid())
    )
  );

drop policy if exists "signed-in users can comment" on public.reel_comments;
create policy "signed-in users can comment"
  on public.reel_comments for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and exists (select 1 from public.properties p where p.id = property_id and p.closed_at is null)
  );

-- ---------------------------------------------------------------------
-- 7) حذف الحساب: الرسم المُؤكَّد سداده وبانتظار المراجعة يمنع الحذف أيضًا (نفس النسخة + 'submitted')
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
