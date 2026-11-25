-- supabase/migrations/20261125000000_services_admin.sql
-- ↔ قسم «الخدمات» قابل للإدارة الكاملة من لوحة الأدمن:
--   ١) جدول public.service_categories (الاسم + الصورة + الترتيب + التفعيل) هو مصدر كروت شريط «الخدمات» وقائمة «نشاط الشركة».
--      يقرؤه كل مستخدم مسجَّل (الزائر أيضًا)، ويكتبه الأدمن بصلاحية menuItems (نفس صلاحية «أيقونات القائمة»).
--   ٢) companies.category صار مرتبطًا به بمفتاح أجنبى (بدل CHECK بخمس قيم ثابتة) فيقبل أى تصنيف يضيفه الأدمن؛ والتصنيفات الخمسة الأصلية
--      تُزرع بنفس المفاتيح فلا تتأثر الشركات الموجودة.
--   ٣) save_my_company يتحقق من النشاط من الجدول بدل القائمة الثابتة.
--   ٤) صف «الخدمات» يُضاف إلى menu_items (action_value = '/services') ليصبح أيقونة رقم 11 فى لوحة «أيقونات صفحة القائمة»
--      بنفس أزرار الترتيب ↑/↓ والتفعيل والتعديل، ويوضع بين صف «انشر/اطلب/ابحث» وصف «احمي استثمارك».
--   ٥) زر كارت Repoo صار «للتواصل» (نص الصورة نفسه عُدِّل فى التطبيق) — لا تغيير فى القاعدة له.
-- الملف idempotent: تشغيله أكثر من مرة آمن.

-- ---------------------------------------------------------------------
-- ١) الجدول + الصلاحيات
-- ---------------------------------------------------------------------
create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (char_length(btrim(label)) between 2 and 80),
  image_url text check (image_url is null or (image_url ~ '^https://' and char_length(image_url) <= 1000)),
  sort_order integer not null default 0,
  active boolean not null default true,
  uses_property_photos boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists service_categories_order_idx on public.service_categories (sort_order);

alter table public.service_categories enable row level security;

drop policy if exists "service categories are readable" on public.service_categories;
create policy "service categories are readable"
  on public.service_categories for select
  to authenticated
  using (true);

drop policy if exists "admins can manage service categories" on public.service_categories;
create policy "admins can manage service categories"
  on public.service_categories for all
  to authenticated
  using (public.admin_has_permission('menuItems'))
  with check (public.admin_has_permission('menuItems'));

-- التصنيفات الخمسة الأصلية بالترتيب الجديد (الأول = أقصى اليمين): التطوير ← التسويق ← اللوازم ← التشطيبات ← الونش.
-- image_url = null يعنى استخدام الصورة المضمّنة فى التطبيق لنفس المفتاح.
insert into public.service_categories (key, label, sort_order, uses_property_photos) values
  ('development', 'شركات التطوير العقاري', 0, true),
  ('marketing', 'شركات التسويق العقاري', 1, true),
  ('supplies', 'شركات لوازم الكهرباء والسباكة والدهانات', 2, false),
  ('finishing', 'شركات التشطيبات والديكور', 3, false),
  ('moving', 'شركات الونش ونقل الأثاث', 4, false)
on conflict (key) do nothing;

-- إعادة الترقيم الذرّية (من لوحة الأدمن: أسهم ↑/↓).
create or replace function public.admin_reorder_service_categories(p_ids uuid[])
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.admin_has_permission('menuItems') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then return; end if;
  if (select count(distinct x) from unnest(p_ids) as x) <> array_length(p_ids, 1) then
    raise exception 'duplicate_ids' using errcode = '22023';
  end if;
  update public.service_categories c
     set sort_order = o.ord - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where c.id = o.id;
end;
$$;
revoke all on function public.admin_reorder_service_categories(uuid[]) from public, anon;
grant execute on function public.admin_reorder_service_categories(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) companies.category: من CHECK ثابت إلى مفتاح أجنبى
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.companies'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%category%'
       and pg_get_constraintdef(c.oid) ilike '%marketing%'
  loop
    execute format('alter table public.companies drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.companies drop constraint if exists companies_category_fkey;
alter table public.companies
  add constraint companies_category_fkey
  foreign key (category) references public.service_categories (key) on update restrict on delete restrict;

-- ---------------------------------------------------------------------
-- ٣) save_my_company: التحقق من النشاط من الجدول (باقى الدالة كما هى حرفيًا من 20261123000000_companies_directory.sql)
-- ---------------------------------------------------------------------
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

  -- ↔ النشاط = تصنيف موجود فى service_categories وفعّال (أو هو تصنيف الشركة الحالى لو الأدمن أخفاه لاحقًا فلا يُرفض تعديل بياناتها).
  if not exists (
       select 1 from public.service_categories sc
        where sc.key = v_cat
          and (sc.active or exists (select 1 from public.companies cc where cc.owner_id = v_uid and cc.category = v_cat))
     ) then
    raise exception 'bad_category';
  end if;
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

-- ---------------------------------------------------------------------
-- ٤) صف «الخدمات» فى أيقونات صفحة القائمة (menu_items)
-- ---------------------------------------------------------------------
do $$
declare
  v_pos integer;
begin
  if exists (select 1 from public.menu_items where action_type = 'route' and btrim(action_value) = '/services') then
    return;
  end if;

  -- موضعه: مكان كارت «احمي استثمارك» (فيُزاح هو وما بعده خطوة)، وإلا بعد أول ثلاثة عناصر (انشر/اطلب/ابحث).
  select m.sort_order into v_pos
    from public.menu_items m
   where regexp_replace(m.title, '[\u064B-\u065F\u0640]', '', 'g') in ('احمي استثمارك', 'احمى استثمارك', 'وكيلك القانوني')
   order by m.sort_order
   limit 1;
  if v_pos is null then v_pos := 3; end if;

  update public.menu_items set sort_order = sort_order + 1 where sort_order >= v_pos;

  insert into public.menu_items (title, subtitle, color, icon_key, size, action_type, action_value, sort_order)
  values ('الخدمات', null, '#1E5AA8', 'star', 'full', 'route', '/services', v_pos);
end $$;

notify pgrst, 'reload schema';
