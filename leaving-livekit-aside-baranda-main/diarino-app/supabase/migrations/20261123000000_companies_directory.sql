-- supabase/migrations/20261123000000_companies_directory.sql
--
-- قسم «الخدمات» — دليل الشركات والخدمات العقارية (صفحة القائمة).
--   • 5 تصنيفات: marketing (التسويق العقارى) / finishing (التشطيبات والديكور) / supplies (لوازم الكهرباء والسباكة والدهانات)
--     / development (التطوير العقارى) / moving (الونش ونقل الأثاث).
--   • شركة واحدة لكل حساب حقيقى (ليس زائرًا). التسجيل ← «قيد المراجعة» ← موافقة الأدمن ← تظهر للجمهور.
--   • فترة مجانية = 60 يومًا من تاريخ *موافقة الأدمن* لميزتين: إظهار أرقام الهاتف، وإظهار/إضافة صور الأعمال (حتى 6).
--     بعدها: اشتراك شهرى (30 يومًا) 100 ج.م للهاتف، 100 ج.م للصور، أو 200 ج.م للاثنين معًا (company_settings، يعدّلها المشرف الرئيسى).
--     بيانات الشركة الأساسية تبقى ظاهرة مجانًا دائمًا؛ يُخفى الهاتف والمعرض فقط.
--   • الإخفاء من جهة الخادم: الجدولان companies / company_images لا يقرؤهما إلا المالك والأدمن (RLS). الجمهور يقرأ فقط عبر
--     list_companies / get_company اللتين لا تُرجعان الهاتف ولا الصور إلا إذا كانت الميزة سارية.
--   • كل الكتابة عبر دوال SECURITY DEFINER تتحقق من المالك (لا سياسات كتابة مباشرة) فلا يعدّل الشركة إلا صاحبها.
--   • الدفع: نفس آلية باقات الريلز/المساحة الإعلانية (فودافون كاش / اتصالات كاش / إنستاباي ← مراجعة الأدمن ← تفعيل).
--   • صور الشركة (الشعار + الأعمال) تدخل طابور حذف Cloudinary عند الاستبدال/الحذف (cloudinary_enqueue_removed).
-- قابل لإعادة التشغيل. صلاحية الأدمن: 'deals' (نفس قسم «الصفقات والرسوم»).

-- ---------------------------------------------------------------------
-- ١) الإعدادات (صف واحد)
-- ---------------------------------------------------------------------
create table if not exists public.company_settings (
  id boolean primary key default true check (id),
  free_days integer not null default 60 check (free_days between 0 and 730),
  period_days integer not null default 30 check (period_days between 1 and 365),
  phone_price_egp numeric(10,2) not null default 100 check (phone_price_egp >= 0),
  photos_price_egp numeric(10,2) not null default 100 check (photos_price_egp >= 0),
  both_price_egp numeric(10,2) not null default 200 check (both_price_egp >= 0),
  max_photos integer not null default 6 check (max_photos between 1 and 20),
  updated_at timestamptz not null default now()
);
insert into public.company_settings (id) values (true) on conflict (id) do nothing;
alter table public.company_settings enable row level security;

drop policy if exists "company settings are readable" on public.company_settings;
create policy "company settings are readable"
  on public.company_settings for select to anon, authenticated using (true);

drop policy if exists "super admin can update company settings" on public.company_settings;
create policy "super admin can update company settings"
  on public.company_settings for update to authenticated
  using (public.is_super_admin_user())
  with check (public.is_super_admin_user());

-- ---------------------------------------------------------------------
-- ٢) الشركات + صور الأعمال
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('marketing', 'finishing', 'supplies', 'development', 'moving')),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text not null check (char_length(btrim(description)) between 10 and 2000),
  logo_url text not null check (logo_url ~ '^https://' and char_length(logo_url) <= 1000),
  province text not null check (char_length(btrim(province)) between 1 and 80),
  region text not null check (char_length(btrim(region)) between 1 and 120),
  manager_name text not null check (char_length(btrim(manager_name)) between 2 and 120),
  phone text not null check (char_length(regexp_replace(phone, '\D', '', 'g')) between 7 and 15 and char_length(phone) <= 30),
  phone2 text check (phone2 is null or (char_length(regexp_replace(phone2, '\D', '', 'g')) between 7 and 15 and char_length(phone2) <= 30)),
  building_no text check (building_no is null or char_length(building_no) <= 30),
  floor_no text check (floor_no is null or char_length(floor_no) <= 30),
  unit_no text check (unit_no is null or char_length(unit_no) <= 30),
  tax_card_no text check (tax_card_no is null or char_length(tax_card_no) <= 60),
  commercial_register_no text check (commercial_register_no is null or char_length(commercial_register_no) <= 60),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'hidden')),
  reject_reason text,
  admin_note text,
  approved_at timestamptz,
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- شركة واحدة لكل حساب.
create unique index if not exists companies_one_per_owner on public.companies (owner_id);
create index if not exists companies_listing_idx on public.companies (category, status, province, created_at desc);
create index if not exists companies_status_idx on public.companies (status, created_at desc);

create table if not exists public.company_images (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  owner_id uuid not null,
  url text not null check (url ~ '^https://' and char_length(url) <= 1000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists company_images_company_idx on public.company_images (company_id, sort_order, created_at);

-- حدّ أقصى لصور الأعمال لكل شركة (company_settings.max_photos = 6) — حماية إضافية خلف الدالة.
create or replace function public.company_images_enforce_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_max integer;
begin
  select max_photos into v_max from public.company_settings where id = true;
  if (select count(*) from public.company_images where company_id = new.company_id) >= coalesce(v_max, 6) then
    raise exception 'too_many_images' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.company_images_enforce_limit() from public, anon, authenticated;

drop trigger if exists company_images_enforce_limit on public.company_images;
create trigger company_images_enforce_limit
  before insert on public.company_images
  for each row execute function public.company_images_enforce_limit();

-- ---------------------------------------------------------------------
-- ٣) طلبات الاشتراك (الهاتف / الصور / الاثنان) — نفس نمط reel_plan_orders
-- ---------------------------------------------------------------------
create table if not exists public.company_plan_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  company_name text,
  payer_name text,
  payer_phone text,
  payer_email text,
  plan text not null check (plan in ('phone', 'photos', 'both')),
  price_egp numeric(10,2) not null check (price_egp >= 0),
  period_days integer not null check (period_days > 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'submitted', 'active', 'rejected', 'cancelled', 'expired')),
  payment_method text check (payment_method in ('vodafone_cash', 'etisalat_cash', 'instapay')),
  payment_sender_name text,
  payment_contact_phone text,
  payment_submitted_at timestamptz,
  payment_ref text,
  admin_note text,
  payer_note text,
  paid_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  handled_by uuid,
  handled_at timestamptz
);

create index if not exists company_plan_orders_user_idx on public.company_plan_orders (user_id, created_at desc);
create index if not exists company_plan_orders_company_idx on public.company_plan_orders (company_id, status, ends_at);
create index if not exists company_plan_orders_status_idx on public.company_plan_orders (status, created_at desc);
-- طلب واحد مفتوح (بانتظار السداد/المراجعة) لكل مستخدم ونوع اشتراك.
create unique index if not exists company_plan_orders_one_open_per_plan
  on public.company_plan_orders (user_id, plan)
  where status in ('pending_payment', 'submitted') and user_id is not null;

create table if not exists public.company_notices (
  company_id uuid not null references public.companies(id) on delete cascade,
  milestone text not null,
  sent_at timestamptz not null default now(),
  primary key (company_id, milestone)
);

-- ---------------------------------------------------------------------
-- ٤) RLS وصلاحيات الأعمدة
-- ---------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.company_images enable row level security;
alter table public.company_plan_orders enable row level security;
alter table public.company_notices enable row level security;

-- المالك والأدمن فقط يقرأون الصفوف مباشرة. الجمهور يقرأ عبر list_companies/get_company (تُخفى الميزة غير السارية).
drop policy if exists "owner or admin reads company" on public.companies;
create policy "owner or admin reads company"
  on public.companies for select to authenticated
  using (owner_id = auth.uid() or public.admin_has_permission('deals'));

drop policy if exists "owner or admin reads company images" on public.company_images;
create policy "owner or admin reads company images"
  on public.company_images for select to authenticated
  using (owner_id = auth.uid() or public.admin_has_permission('deals'));

drop policy if exists "owners read own company orders, admins read all" on public.company_plan_orders;
create policy "owners read own company orders, admins read all"
  on public.company_plan_orders for select to authenticated
  using (user_id = auth.uid() or public.admin_has_permission('deals'));

-- لا سياسات إدراج/تعديل/حذف على أى جدول: كل الكتابة عبر الدوال (SECURITY DEFINER) التى تتحقق من المالك/الأدمن.
revoke all on public.companies from anon, authenticated;
revoke all on public.company_images from anon, authenticated;
revoke all on public.company_plan_orders from anon, authenticated;
revoke all on public.company_notices from anon, authenticated;

-- المالك لا يقرأ admin_note/handled_by/handled_at (ملاحظات الأدمن الداخلية).
grant select (
  id, owner_id, category, name, description, logo_url, province, region, manager_name, phone, phone2,
  building_no, floor_no, unit_no, tax_card_no, commercial_register_no, status, reject_reason, approved_at, created_at, updated_at
) on public.companies to authenticated;
grant select on public.company_images to authenticated;
grant select (
  id, company_id, user_id, company_name, plan, price_egp, period_days, status, payment_method, payment_sender_name,
  payment_contact_phone, payment_submitted_at, paid_at, starts_at, ends_at, created_at, payer_note
) on public.company_plan_orders to authenticated;

drop trigger if exists company_plan_orders_sync_payer_note on public.company_plan_orders;
create trigger company_plan_orders_sync_payer_note
  before update on public.company_plan_orders
  for each row execute function public.ad_orders_sync_payer_note();

-- ---------------------------------------------------------------------
-- ٥) حالة الميزتين (هاتف / صور): فترة مجانية من الموافقة + الاشتراكات المدفوعة
-- ---------------------------------------------------------------------
create or replace function public.company_feature_until(p_company uuid, p_feature text)
returns timestamptz
language sql stable
security definer set search_path = public
as $$
  select case
           when c.approved_at is null then null
           else greatest(
             c.approved_at + make_interval(days => s.free_days),
             coalesce((
               select max(o.ends_at) from public.company_plan_orders o
                where o.company_id = c.id and o.status = 'active' and o.starts_at is not null and o.starts_at <= now()
                  and (o.plan = 'both' or o.plan = p_feature)
             ), 'epoch'::timestamptz)
           )
         end
    from public.companies c
    cross join public.company_settings s
   where c.id = p_company and s.id = true;
$$;

create or replace function public.company_feature_active(p_company uuid, p_feature text)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select coalesce(now() < public.company_feature_until(p_company, p_feature), false);
$$;

revoke all on function public.company_feature_until(uuid, text) from public, anon, authenticated;
revoke all on function public.company_feature_active(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- ٦) الجمهور: قائمة الشركات وتفاصيل شركة (الهاتف والمعرض فقط لو الميزة سارية)
-- ---------------------------------------------------------------------
create or replace function public.list_companies(
  p_category text default null,
  p_province text default null,
  p_region text default null,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid, category text, name text, logo_url text, province text, region text, description text, created_at timestamptz
)
language plpgsql stable
security definer set search_path = public
as $$
declare
  v_cat text := nullif(btrim(coalesce(p_category, '')), '');
  v_prov text := nullif(btrim(coalesce(p_province, '')), '');
  v_reg text := nullif(btrim(coalesce(p_region, '')), '');
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if v_q is not null then
    v_q := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
    select c.id, c.category, c.name, c.logo_url, c.province, c.region, left(c.description, 200), c.created_at
      from public.companies c
     where c.status = 'approved'
       and (v_cat is null or c.category = v_cat)
       and (v_prov is null or c.province = v_prov)
       and (v_reg is null or c.region = v_reg)
       and (v_q is null or c.name ilike v_q)
     order by c.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.list_companies(text, text, text, text, integer, integer) from public;
grant execute on function public.list_companies(text, text, text, text, integer, integer) to anon, authenticated;

create or replace function public.get_company(p_id uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public
as $$
declare
  c public.companies%rowtype;
  v_uid uuid := auth.uid();
  v_admin boolean := public.admin_has_permission('deals');
  v_phone boolean;
  v_photos boolean;
begin
  select * into c from public.companies where id = p_id;
  if not found then
    return null;
  end if;
  -- الشركة غير المعتمدة لا يراها إلا صاحبها أو الأدمن (معاينة).
  if c.status <> 'approved' and not v_admin and (v_uid is null or c.owner_id <> v_uid) then
    return null;
  end if;

  v_phone := public.company_feature_active(c.id, 'phone') or v_admin;
  v_photos := public.company_feature_active(c.id, 'photos') or v_admin;

  return jsonb_build_object(
    'id', c.id,
    'category', c.category,
    'name', c.name,
    'description', c.description,
    'logo_url', c.logo_url,
    'province', c.province,
    'region', c.region,
    'building_no', c.building_no,
    'floor_no', c.floor_no,
    'unit_no', c.unit_no,
    'status', c.status,
    'phone_visible', v_phone,
    'photos_visible', v_photos,
    'phone', case when v_phone then c.phone else null end,
    'phone2', case when v_phone then c.phone2 else null end,
    'images', case when v_photos then coalesce((
        select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url) order by i.sort_order, i.created_at)
          from public.company_images i where i.company_id = c.id
      ), '[]'::jsonb) else '[]'::jsonb end,
    'created_at', c.created_at
  );
end;
$$;
revoke all on function public.get_company(uuid) from public;
grant execute on function public.get_company(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- ٧) المالك: شركتى + حفظ/تعديل + حذف
-- ---------------------------------------------------------------------
create or replace function public.get_my_company()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c public.companies%rowtype;
  s public.company_settings%rowtype;
begin
  if v_uid is null then
    return null;
  end if;
  perform public.company_emit_notices(v_uid);

  select * into c from public.companies where owner_id = v_uid;
  if not found then
    return null;
  end if;
  select * into s from public.company_settings where id = true;

  return jsonb_build_object(
    'id', c.id,
    'category', c.category,
    'name', c.name,
    'description', c.description,
    'logo_url', c.logo_url,
    'province', c.province,
    'region', c.region,
    'manager_name', c.manager_name,
    'phone', c.phone,
    'phone2', c.phone2,
    'building_no', c.building_no,
    'floor_no', c.floor_no,
    'unit_no', c.unit_no,
    'tax_card_no', c.tax_card_no,
    'commercial_register_no', c.commercial_register_no,
    'status', c.status,
    'reject_reason', c.reject_reason,
    'approved_at', c.approved_at,
    'created_at', c.created_at,
    'images', coalesce((
        select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url) order by i.sort_order, i.created_at)
          from public.company_images i where i.company_id = c.id
      ), '[]'::jsonb),
    'free_until', case when c.approved_at is null then null else c.approved_at + make_interval(days => s.free_days) end,
    'phone_until', public.company_feature_until(c.id, 'phone'),
    'photos_until', public.company_feature_until(c.id, 'photos'),
    'phone_active', public.company_feature_active(c.id, 'phone'),
    'photos_active', public.company_feature_active(c.id, 'photos'),
    'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', o.id, 'plan', o.plan, 'price_egp', o.price_egp, 'status', o.status, 'period_days', o.period_days,
                 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'payer_note', o.payer_note, 'created_at', o.created_at,
                 'payment_method', o.payment_method, 'payment_sender_name', o.payment_sender_name,
                 'payment_contact_phone', o.payment_contact_phone
               ) order by o.created_at desc)
          from (select * from public.company_plan_orders x where x.company_id = c.id order by x.created_at desc limit 12) o
      ), '[]'::jsonb),
    'settings', jsonb_build_object(
      'free_days', s.free_days, 'period_days', s.period_days, 'phone_price_egp', s.phone_price_egp,
      'photos_price_egp', s.photos_price_egp, 'both_price_egp', s.both_price_egp, 'max_photos', s.max_photos
    )
  );
end;
$$;
revoke all on function public.get_my_company() from public, anon;
grant execute on function public.get_my_company() to authenticated;

-- إنشاء/تعديل شركة المستخدم. p = { category, name, description, logo_url, province, region, manager_name, phone, phone2?,
--   building_no?, floor_no?, unit_no?, tax_card_no?, commercial_register_no?, images?: [url,...] }
-- • الحساب لازم يكون حقيقيًا (Google/بريد) لا زائر.   • الشركة الجديدة تبدأ «قيد المراجعة»؛ المرفوضة تعود «قيد المراجعة» عند إعادة الإرسال.
-- • الشركة المعتمدة تبقى معتمدة بعد التعديل (للأدمن الإخفاء/الحذف فى أى وقت).
-- • إضافة صور جديدة تتطلب ميزة الصور سارية (أو أن الشركة لم تُعتمد بعد)؛ حذف الصور مسموح دائمًا.
create or replace function public.save_my_company(p jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s public.company_settings%rowtype;
  c public.companies%rowtype;
  v_new boolean;
  v_cat text := btrim(coalesce(p ->> 'category', ''));
  v_name text := regexp_replace(btrim(coalesce(p ->> 'name', '')), '\s+', ' ', 'g');
  v_desc text := btrim(coalesce(p ->> 'description', ''));
  v_logo text := btrim(coalesce(p ->> 'logo_url', ''));
  v_prov text := btrim(coalesce(p ->> 'province', ''));
  v_reg text := btrim(coalesce(p ->> 'region', ''));
  v_mgr text := regexp_replace(btrim(coalesce(p ->> 'manager_name', '')), '\s+', ' ', 'g');
  v_phone text := btrim(coalesce(p ->> 'phone', ''));
  v_phone2 text := nullif(btrim(coalesce(p ->> 'phone2', '')), '');
  v_bld text := nullif(btrim(coalesce(p ->> 'building_no', '')), '');
  v_flr text := nullif(btrim(coalesce(p ->> 'floor_no', '')), '');
  v_unit text := nullif(btrim(coalesce(p ->> 'unit_no', '')), '');
  v_tax text := nullif(btrim(coalesce(p ->> 'tax_card_no', '')), '');
  v_reg_no text := nullif(btrim(coalesce(p ->> 'commercial_register_no', '')), '');
  v_has_images boolean := jsonb_typeof(p -> 'images') = 'array';
  v_urls text[] := '{}';
  v_existing text[];
  i integer;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into s from public.company_settings where id = true;

  if v_cat not in ('marketing', 'finishing', 'supplies', 'development', 'moving') then raise exception 'bad_category'; end if;
  if char_length(v_name) not between 2 and 120 then raise exception 'bad_name'; end if;
  if char_length(v_desc) not between 10 and 2000 then raise exception 'bad_description'; end if;
  if v_logo !~ '^https://' or char_length(v_logo) > 1000 then raise exception 'bad_logo'; end if;
  if char_length(v_prov) not between 1 and 80 then raise exception 'bad_province'; end if;
  if char_length(v_reg) not between 1 and 120 then raise exception 'bad_region'; end if;
  if char_length(v_mgr) not between 2 and 120 then raise exception 'bad_manager'; end if;
  if char_length(regexp_replace(v_phone, '\D', '', 'g')) not between 7 and 15 or char_length(v_phone) > 30 then
    raise exception 'bad_phone';
  end if;
  if v_phone2 is not null and (char_length(regexp_replace(v_phone2, '\D', '', 'g')) not between 7 and 15 or char_length(v_phone2) > 30) then
    raise exception 'bad_phone2';
  end if;
  if char_length(coalesce(v_bld, '')) > 30 or char_length(coalesce(v_flr, '')) > 30 or char_length(coalesce(v_unit, '')) > 30
     or char_length(coalesce(v_tax, '')) > 60 or char_length(coalesce(v_reg_no, '')) > 60 then
    raise exception 'bad_text';
  end if;

  if v_has_images then
    select coalesce(array_agg(q.u order by q.ord), '{}') into v_urls
      from (
        select btrim(t.x) as u, min(t.ord) as ord
          from jsonb_array_elements_text(p -> 'images') with ordinality as t(x, ord)
         where btrim(t.x) ~ '^https://' and char_length(btrim(t.x)) <= 1000
         group by btrim(t.x)
      ) q;
    if coalesce(array_length(v_urls, 1), 0) > s.max_photos then
      raise exception 'too_many_images';
    end if;
  end if;

  select * into c from public.companies where owner_id = v_uid for update;
  v_new := not found;

  if v_new then
    insert into public.companies (
      owner_id, category, name, description, logo_url, province, region, manager_name, phone, phone2,
      building_no, floor_no, unit_no, tax_card_no, commercial_register_no
    ) values (
      v_uid, v_cat, v_name, v_desc, v_logo, v_prov, v_reg, v_mgr, v_phone, v_phone2,
      v_bld, v_flr, v_unit, v_tax, v_reg_no
    ) returning * into c;
  else
    update public.companies
       set category = v_cat, name = v_name, description = v_desc, logo_url = v_logo, province = v_prov, region = v_reg,
           manager_name = v_mgr, phone = v_phone, phone2 = v_phone2, building_no = v_bld, floor_no = v_flr, unit_no = v_unit,
           tax_card_no = v_tax, commercial_register_no = v_reg_no,
           status = case when status = 'rejected' then 'pending' else status end,
           reject_reason = case when status = 'rejected' then null else reject_reason end,
           updated_at = now()
     where id = c.id
     returning * into c;
  end if;

  if v_has_images then
    select coalesce(array_agg(url), '{}') into v_existing from public.company_images where company_id = c.id;
    -- صور جديدة؟ تتطلب ميزة الصور سارية (أو شركة لم تُعتمد بعد: الفترة المجانية لم تبدأ).
    if exists (select 1 from unnest(v_urls) u where not (u = any (v_existing)))
       and c.approved_at is not null
       and not public.company_feature_active(c.id, 'photos') then
      raise exception 'photos_inactive';
    end if;

    delete from public.company_images where company_id = c.id and not (url = any (v_urls));
    for i in 1 .. coalesce(array_length(v_urls, 1), 0) loop
      update public.company_images set sort_order = i where company_id = c.id and url = v_urls[i];
      if not found then
        insert into public.company_images (company_id, owner_id, url, sort_order) values (c.id, v_uid, v_urls[i], i);
      end if;
    end loop;
  end if;

  return public.get_my_company();
end;
$$;
revoke all on function public.save_my_company(jsonb) from public, anon;
grant execute on function public.save_my_company(jsonb) to authenticated;

-- حذف شركتى (يحذف صورها من Cloudinary عبر الطابور). ممنوع لو فى تأكيد سداد قيد المراجعة.
create or replace function public.delete_my_company()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select id into v_id from public.companies where owner_id = v_uid;
  if not found then
    raise exception 'no_company';
  end if;
  if exists (select 1 from public.company_plan_orders where company_id = v_id and status = 'submitted') then
    raise exception 'has_open_fees';
  end if;
  update public.company_plan_orders set status = 'cancelled' where company_id = v_id and status = 'pending_payment';
  delete from public.companies where id = v_id;
end;
$$;
revoke all on function public.delete_my_company() from public, anon;
grant execute on function public.delete_my_company() to authenticated;

-- ---------------------------------------------------------------------
-- ٨) الاشتراكات: إنشاء طلب ← تأكيد السداد ← إلغاء
-- ---------------------------------------------------------------------
create or replace function public.create_company_plan_order(p_plan text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s public.company_settings%rowtype;
  c public.companies%rowtype;
  v_price numeric;
  v_name text;
  v_phone text;
  v_email text;
  v_row public.company_plan_orders%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_plan not in ('phone', 'photos', 'both') then
    raise exception 'bad_plan';
  end if;
  select * into c from public.companies where owner_id = v_uid;
  if not found then
    raise exception 'no_company';
  end if;
  if c.status <> 'approved' then
    raise exception 'company_not_approved';
  end if;

  select * into v_row from public.company_plan_orders
   where user_id = v_uid and plan = p_plan and status in ('pending_payment', 'submitted')
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('id', v_row.id, 'plan', v_row.plan, 'price_egp', v_row.price_egp,
                              'period_days', v_row.period_days, 'status', v_row.status, 'company_name', v_row.company_name);
  end if;

  select * into s from public.company_settings where id = true;
  v_price := case p_plan when 'phone' then s.phone_price_egp when 'photos' then s.photos_price_egp else s.both_price_egp end;

  select p.full_name, p.phone_e164, u.email::text into v_name, v_phone, v_email
    from public.profiles p left join auth.users u on u.id = p.id where p.id = v_uid;

  insert into public.company_plan_orders (company_id, user_id, company_name, payer_name, payer_phone, payer_email, plan, price_egp, period_days)
  values (c.id, v_uid, c.name, v_name, v_phone, v_email, p_plan, v_price, s.period_days)
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'plan', v_row.plan, 'price_egp', v_row.price_egp,
                            'period_days', v_row.period_days, 'status', v_row.status, 'company_name', v_row.company_name);
end;
$$;
revoke all on function public.create_company_plan_order(text) from public, anon;
grant execute on function public.create_company_plan_order(text) to authenticated;

create or replace function public.confirm_company_plan_payment(
  p_id uuid, p_method text, p_sender_name text, p_contact_phone text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.company_plan_orders%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_sender_name, '')), '\s+', ' ', 'g');
  v_phone text := btrim(coalesce(p_contact_phone, ''));
  v_row public.company_plan_orders%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_order from public.company_plan_orders where id = p_id for update;
  if not found or v_order.user_id is distinct from v_uid then
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

  update public.company_plan_orders
     set status = 'submitted', payment_method = p_method, payment_sender_name = v_name,
         payment_contact_phone = v_phone, payment_submitted_at = now()
   where id = p_id
   returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'payment_method', v_row.payment_method,
                            'payment_sender_name', v_row.payment_sender_name, 'payment_contact_phone', v_row.payment_contact_phone,
                            'payment_submitted_at', v_row.payment_submitted_at);
end;
$$;
revoke all on function public.confirm_company_plan_payment(uuid, text, text, text) from public, anon;
grant execute on function public.confirm_company_plan_payment(uuid, text, text, text) to authenticated;

create or replace function public.cancel_company_plan_order(p_id uuid)
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
  update public.company_plan_orders set status = 'cancelled'
   where id = p_id and user_id = v_uid and status = 'pending_payment';
  if not found then
    raise exception 'cannot_cancel';
  end if;
end;
$$;
revoke all on function public.cancel_company_plan_order(uuid) from public, anon;
grant execute on function public.cancel_company_plan_order(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٩) إشعارات قرب انتهاء الفترة المجانية/الاشتراك (تُرسل مرة لكل مرحلة) + إنهاء الاشتراكات المنتهية
-- ---------------------------------------------------------------------
create or replace function public.company_emit_notices(p_uid uuid default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.companies%rowtype;
  s public.company_settings%rowtype;
  f text;
  v_until timestamptz;
  v_free_end timestamptz;
  v_stage text;
  v_key text;
  v_label text;
  v_end text;
  v_text text;
begin
  select * into s from public.company_settings where id = true;

  for c in
    select * from public.companies
     where status = 'approved' and approved_at is not null and (p_uid is null or owner_id = p_uid)
  loop
    v_free_end := c.approved_at + make_interval(days => s.free_days);
    foreach f in array array['phone', 'photos'] loop
      v_until := public.company_feature_until(c.id, f);
      continue when v_until is null;

      v_stage := case
        when now() >= v_until and now() < v_until + interval '30 days' then 'end'
        when now() < v_until and now() >= v_until - interval '3 days' then 'pre3'
        when now() < v_until and now() >= v_until - interval '7 days' then 'pre7'
        else null
      end;
      continue when v_stage is null;

      v_key := f || ':' || to_char(v_until at time zone 'UTC', 'YYYYMMDD') || ':' || v_stage;
      insert into public.company_notices (company_id, milestone) values (c.id, v_key)
      on conflict (company_id, milestone) do nothing;
      continue when not found;

      v_label := case when f = 'phone' then 'إظهار رقم هاتف شركتك' else 'معرض صور أعمال شركتك' end;
      v_end := to_char(v_until at time zone 'Africa/Cairo', 'YYYY-MM-DD');
      v_text := case
        when v_stage = 'end' and v_until <= v_free_end then
          'انتهت الفترة المجانية لـ' || v_label || ' «' || c.name || '». تم إخفاؤه عن الزوار — فعّل الاشتراك من «إدارة شركتي» ليعود للظهور.'
        when v_stage = 'end' then
          'انتهى اشتراك ' || v_label || ' «' || c.name || '». تم إخفاؤه عن الزوار — جدّد الاشتراك من «إدارة شركتي».'
        when v_until <= v_free_end then
          'تنتهي الفترة المجانية لـ' || v_label || ' «' || c.name || '» بتاريخ ' || v_end || '. فعّل الاشتراك من «إدارة شركتي» لاستمرار الظهور.'
        else
          'ينتهي اشتراك ' || v_label || ' «' || c.name || '» بتاريخ ' || v_end || '. جدّد الاشتراك من «إدارة شركتي».'
      end;

      begin
        insert into public.notifications (recipient_id, actor_id, category, text)
        values (c.owner_id, null, 'approval', v_text);
      exception when others then
        raise warning 'company notice failed: %', sqlerrm;
      end;
    end loop;
  end loop;

  update public.company_plan_orders
     set status = 'expired'
   where status = 'active' and ends_at < now() and (p_uid is null or user_id = p_uid);
end;
$$;
revoke all on function public.company_emit_notices(uuid) from public, anon, authenticated;

create or replace function public.process_company_lifecycle()
returns void
language sql
security definer set search_path = public
as $$ select public.company_emit_notices(null); $$;
revoke all on function public.process_company_lifecycle() from public, anon, authenticated;
grant execute on function public.process_company_lifecycle() to service_role;

-- ---------------------------------------------------------------------
-- ١٠) الأدمن (صلاحية deals)
-- ---------------------------------------------------------------------
create or replace function public.admin_list_companies()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.company_settings%rowtype;
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into s from public.company_settings where id = true;
  perform public.company_emit_notices(null);
  return coalesce((
    select jsonb_agg(q.x order by q.created_at desc)
      from (
        select c.created_at,
               jsonb_build_object(
                 'id', c.id, 'owner_id', c.owner_id, 'category', c.category, 'name', c.name, 'description', c.description,
                 'logo_url', c.logo_url, 'province', c.province, 'region', c.region, 'manager_name', c.manager_name,
                 'phone', c.phone, 'phone2', c.phone2, 'building_no', c.building_no, 'floor_no', c.floor_no, 'unit_no', c.unit_no,
                 'tax_card_no', c.tax_card_no, 'commercial_register_no', c.commercial_register_no,
                 'status', c.status, 'reject_reason', c.reject_reason, 'admin_note', c.admin_note,
                 'approved_at', c.approved_at, 'created_at', c.created_at,
                 'owner_name', p.full_name, 'owner_phone', p.phone_e164, 'owner_email', u.email::text,
                 'free_until', case when c.approved_at is null then null else c.approved_at + make_interval(days => s.free_days) end,
                 'phone_until', public.company_feature_until(c.id, 'phone'),
                 'photos_until', public.company_feature_until(c.id, 'photos'),
                 'images', coalesce((
                     select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url) order by i.sort_order, i.created_at)
                       from public.company_images i where i.company_id = c.id
                   ), '[]'::jsonb)
               ) as x
          from public.companies c
          left join public.profiles p on p.id = c.owner_id
          left join auth.users u on u.id = c.owner_id
      ) q
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_companies() from public, anon;
grant execute on function public.admin_list_companies() to authenticated;

-- الموافقة: تبدأ الفترة المجانية (60 يومًا) من أول موافقة. الرفض يتطلب سببًا يصل لصاحب الشركة.
create or replace function public.admin_set_company_status(
  p_id uuid, p_status text, p_reason text default null, p_note text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'approved', 'rejected', 'hidden') then
    raise exception 'bad_status';
  end if;
  if p_status = 'rejected' and v_reason is null then
    raise exception 'reason_required';
  end if;
  update public.companies
     set status = p_status,
         approved_at = case when p_status = 'approved' then coalesce(approved_at, now()) else approved_at end,
         reject_reason = case when p_status = 'rejected' then v_reason else null end,
         admin_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), admin_note),
         handled_by = auth.uid(), handled_at = now(), updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'company_not_found';
  end if;
end;
$$;
revoke all on function public.admin_set_company_status(uuid, text, text, text) from public, anon;
grant execute on function public.admin_set_company_status(uuid, text, text, text) to authenticated;

create or replace function public.admin_delete_company(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.company_plan_orders set status = 'cancelled' where company_id = p_id and status = 'pending_payment';
  delete from public.companies where id = p_id;
  if not found then
    raise exception 'company_not_found';
  end if;
end;
$$;
revoke all on function public.admin_delete_company(uuid) from public, anon;
grant execute on function public.admin_delete_company(uuid) to authenticated;

create or replace function public.admin_list_company_orders()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.company_emit_notices(null);
  return coalesce((
    select jsonb_agg(q.x order by q.created_at desc)
      from (
        select o.created_at,
               jsonb_build_object(
                 'id', o.id, 'company_id', o.company_id, 'company_name', coalesce(c.name, o.company_name),
                 'plan', o.plan, 'price_egp', o.price_egp, 'period_days', o.period_days, 'status', o.status,
                 'payment_method', o.payment_method, 'payment_sender_name', o.payment_sender_name,
                 'payment_contact_phone', o.payment_contact_phone, 'payment_submitted_at', o.payment_submitted_at,
                 'payment_ref', o.payment_ref, 'admin_note', o.admin_note, 'paid_at', o.paid_at,
                 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'created_at', o.created_at,
                 'payer_name', coalesce(p.full_name, o.payer_name), 'payer_phone', coalesce(p.phone_e164, o.payer_phone),
                 'payer_email', coalesce(u.email::text, o.payer_email)
               ) as x
          from public.company_plan_orders o
          left join public.companies c on c.id = o.company_id
          left join public.profiles p on p.id = o.user_id
          left join auth.users u on u.id = o.user_id
      ) q
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_company_orders() from public, anon;
grant execute on function public.admin_list_company_orders() to authenticated;

-- «active» = تأكيد السداد وتفعيل الاشتراك لـ period_days: يبدأ من آخر نهاية بين (الآن، نهاية الفترة المجانية، نهاية اشتراك سارٍ لنفس النوع)
-- فلا يضيع على الشركة أى وقت مدفوع.
create or replace function public.admin_update_company_order(
  p_id uuid, p_status text, p_payment_ref text default null, p_admin_note text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_order public.company_plan_orders%rowtype;
  c public.companies%rowtype;
  s public.company_settings%rowtype;
  v_prev_end timestamptz;
  v_start timestamptz;
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('pending_payment', 'submitted', 'active', 'rejected', 'cancelled') then
    raise exception 'bad_status';
  end if;
  select * into v_order from public.company_plan_orders where id = p_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  if p_status = 'active' then
    if v_order.status = 'active' then
      update public.company_plan_orders
         set payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
             admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
             handled_by = auth.uid(), handled_at = now()
       where id = p_id;
      return;
    end if;
    select * into c from public.companies where id = v_order.company_id;
    if not found then
      raise exception 'company_unavailable';
    end if;
    if c.approved_at is null then
      raise exception 'company_not_approved';
    end if;
    select * into s from public.company_settings where id = true;
    select max(x.ends_at) into v_prev_end from public.company_plan_orders x
     where x.company_id = c.id and x.plan = v_order.plan and x.status = 'active' and x.ends_at > now() and x.id <> p_id;
    v_start := greatest(now(), c.approved_at + make_interval(days => s.free_days), coalesce(v_prev_end, now()));
    update public.company_plan_orders
       set status = 'active', paid_at = coalesce(paid_at, now()),
           starts_at = v_start, ends_at = v_start + make_interval(days => v_order.period_days),
           payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
           admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
           handled_by = auth.uid(), handled_at = now()
     where id = p_id;
  else
    update public.company_plan_orders
       set status = p_status,
           payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
           admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
           handled_by = auth.uid(), handled_at = now()
     where id = p_id;
  end if;
end;
$$;
revoke all on function public.admin_update_company_order(uuid, text, text, text) from public, anon;
grant execute on function public.admin_update_company_order(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- ١١) إشعارات صاحب الشركة: الموافقة / الرفض / الإخفاء / تفعيل الاشتراك
-- ---------------------------------------------------------------------
create or replace function public.notify_company_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  s public.company_settings%rowtype;
  v_text text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  select * into s from public.company_settings where id = true;
  v_text := case new.status
    when 'approved' then
      'تمت الموافقة على شركتك «' || new.name || '» وأصبحت ظاهرة فى قسم «الخدمات». أمامك فترة مجانية حتى '
      || to_char((new.approved_at + make_interval(days => s.free_days)) at time zone 'Africa/Cairo', 'YYYY-MM-DD')
      || ' لإظهار رقم الهاتف وصور الأعمال.'
    when 'rejected' then
      'تم رفض تسجيل شركتك «' || new.name || '»' || coalesce(': ' || new.reject_reason, '') || '. يمكنك تعديل البيانات وإعادة الإرسال من «إدارة شركتي».'
    when 'hidden' then
      'تم إخفاء شركتك «' || new.name || '» من قسم «الخدمات» بقرار الإدارة.'
    else null
  end;
  if v_text is not null then
    insert into public.notifications (recipient_id, actor_id, category, text)
    values (new.owner_id, null, 'approval', v_text);
  end if;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.notify_company_status() from public, anon, authenticated;

drop trigger if exists trg_notify_company_status on public.companies;
create trigger trg_notify_company_status
  after update of status on public.companies
  for each row execute function public.notify_company_status();

create or replace function public.notify_company_plan_activation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_what text;
begin
  if new.status is distinct from 'active' or new.user_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'active' then return new; end if;
  v_what := case new.plan
    when 'phone' then 'إظهار رقم الهاتف'
    when 'photos' then 'معرض صور الأعمال'
    else 'إظهار الهاتف ومعرض الصور'
  end;
  insert into public.notifications (recipient_id, actor_id, category, text)
  values (new.user_id, null, 'approval',
          'تم تفعيل اشتراك ' || v_what || ' لشركتك «' || coalesce(new.company_name, '') || '» من '
          || to_char(new.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') || ' حتى '
          || to_char(new.ends_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') || '.');
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.notify_company_plan_activation() from public, anon, authenticated;

drop trigger if exists trg_notify_company_plan_activation on public.company_plan_orders;
create trigger trg_notify_company_plan_activation
  after update of status on public.company_plan_orders
  for each row execute function public.notify_company_plan_activation();

-- ---------------------------------------------------------------------
-- ١٢) علامة الأدمن الحمراء لصفحة «الشركات»: شركات قيد المراجعة + تأكيدات سداد اشتراكات الشركات.
--     نفس نسخة 20261116000001_support_soft_dismiss.sql + عمود companies_pending (تغيير شكل المُرجَع يتطلب drop أولًا).
-- ---------------------------------------------------------------------
drop function if exists public.admin_pending_counts();
create or replace function public.admin_pending_counts()
returns table (reels_pending integer, support_pending integer, deals_pending integer, companies_pending integer)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_reels integer := 0;
  v_support integer := 0;
  v_deals integer := 0;
  v_companies integer := 0;
begin
  if auth.uid() is null then
    return query select 0, 0, 0, 0;
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
    select (
      (select count(*) from public.companies where status = 'pending')
      + (select count(*) from public.company_plan_orders where status = 'submitted')
    )::integer into v_companies;
  end if;

  return query select v_reels, v_support, v_deals, v_companies;
end;
$$;
revoke all on function public.admin_pending_counts() from public;
grant execute on function public.admin_pending_counts() to authenticated;

-- ---------------------------------------------------------------------
-- ١٣) حذف ملفات Cloudinary: شعار الشركة وصور أعمالها (استبدال/حذف) + حماية من فحص اليتامى
--     (نفس نسخة 20261121000200_cloudinary_cleanup_queue.sql + companies / company_images.)
-- ---------------------------------------------------------------------
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
    or exists (select 1 from public.chat_messages where strpos(array_to_string(images, ' '), needle) > 0)
    or exists (select 1 from public.companies where strpos(coalesce(logo_url, ''), needle) > 0)
    or exists (select 1 from public.company_images where strpos(coalesce(url, ''), needle) > 0);
end;
$$;
revoke all on function public.cloudinary_asset_in_use(text) from public, anon, authenticated;
grant execute on function public.cloudinary_asset_in_use(text) to service_role;

drop trigger if exists cloudinary_cleanup_on_delete on public.companies;
create trigger cloudinary_cleanup_on_delete
  after delete on public.companies
  for each row execute function public.trg_cloudinary_enqueue();
drop trigger if exists cloudinary_cleanup_on_update on public.companies;
create trigger cloudinary_cleanup_on_update
  after update of logo_url on public.companies
  for each row when (OLD.logo_url is distinct from NEW.logo_url)
  execute function public.trg_cloudinary_enqueue();

drop trigger if exists cloudinary_cleanup_on_delete on public.company_images;
create trigger cloudinary_cleanup_on_delete
  after delete on public.company_images
  for each row execute function public.trg_cloudinary_enqueue();
drop trigger if exists cloudinary_cleanup_on_update on public.company_images;
create trigger cloudinary_cleanup_on_update
  after update of url on public.company_images
  for each row when (OLD.url is distinct from NEW.url)
  execute function public.trg_cloudinary_enqueue();

-- ---------------------------------------------------------------------
-- جدولة يومية (اختيارى — تتطلب امتداد pg_cron):
--   select cron.schedule('company-lifecycle', '0 8 * * *', $$ select public.process_company_lifecycle(); $$);
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
