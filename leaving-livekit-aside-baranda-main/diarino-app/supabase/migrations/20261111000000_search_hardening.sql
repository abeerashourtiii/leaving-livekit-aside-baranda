-- ---------------------------------------------------------------------
-- B8 / B9: البحث النصى والمضلع — قابل لإعادة التشغيل.
-- ---------------------------------------------------------------------

-- 1) تهريب محارف LIKE (\ % _) فى نص بحث المستخدم ليُطابَق حرفيًا (كان p_query يدخل فى ilike '%…%' كما هو فتعمل % و_ كرموز بحث).
create or replace function public.escape_like(t text)
returns text
language sql
immutable
parallel safe
as $$
  select replace(replace(replace(coalesce(t, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- 2) فهارس pg_trgm (GIN) للأعمدة المستخدمة فى ilike '%q%' (كان مسحًا كاملًا للجدول). نكتشف مخطّط الامتداد (Supabase يضعه عادة فى extensions).
do $$
declare
  ext_schema text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    begin
      create extension pg_trgm with schema extensions;
    exception when others then
      create extension if not exists pg_trgm;
    end;
  end if;
  select n.nspname into ext_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if ext_schema is null then return; end if;
  execute format('create index if not exists properties_title_trgm_idx on public.properties using gin (title %I.gin_trgm_ops)', ext_schema);
  execute format('create index if not exists properties_location_trgm_idx on public.properties using gin (location %I.gin_trgm_ops)', ext_schema);
  execute format('create index if not exists properties_type_trgm_idx on public.properties using gin (type %I.gin_trgm_ops)', ext_schema);
  execute format('create index if not exists properties_province_trgm_idx on public.properties using gin (province %I.gin_trgm_ops)', ext_schema);
  execute format('create index if not exists properties_description_trgm_idx on public.properties using gin (description %I.gin_trgm_ops)', ext_schema);
end;
$$;

-- 3) properties_in_radius: نفس النسخة السابقة (20261022) لكن البحث النصى بنص مُهرَّب + سقف للحد (security invoker: RLS كما هى).
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
      p.title ilike '%' || public.escape_like(left(p_query, 100)) || '%' or
      p.location ilike '%' || public.escape_like(left(p_query, 100)) || '%' or
      p.type ilike '%' || public.escape_like(left(p_query, 100)) || '%' or
      p.description ilike '%' || public.escape_like(left(p_query, 100)) || '%' or
      p.province ilike '%' || public.escape_like(left(p_query, 100)) || '%'
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;

grant execute on function public.properties_in_radius(
  double precision, double precision, double precision, text, text, text[], text[],
  numeric, numeric, numeric, numeric, numeric, text, int, int
) to authenticated;

-- 4) properties_in_bounds: كل فلاتر البحث (محافظات/مناطق/سعر/مساحة/غرف/نص) بدل purpose وtype فقط (B9). نحذف الإصدار القديم أولًا لتفادى
--    التباس التحميل الزائد فى PostgREST (الجديد يقبل نفس معاملات القديم بقيم افتراضية فالعملاء القدماء يعملون كما كانوا).
drop function if exists public.properties_in_bounds(double precision, double precision, double precision, double precision, text, text, int);

create or replace function public.properties_in_bounds(
  min_lat double precision,
  max_lat double precision,
  min_lng double precision,
  max_lng double precision,
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
    and (p_provinces is null or p.province = any(p_provinces))
    and (p_regions is null or p.location = any(p_regions))
    and (p_price_min is null or p.price >= p_price_min)
    and (p_price_max is null or p.price <= p_price_max)
    and (p_area_min is null or p.area >= p_area_min)
    and (p_area_max is null or p.area <= p_area_max)
    and (p_min_rooms is null or p.rooms >= p_min_rooms)
    and (
      p_query is null or p_query = '' or
      p.title ilike '%' || public.escape_like(left(p_query, 100)) || '%' or
      p.location ilike '%' || public.escape_like(left(p_query, 100)) || '%' or
      p.type ilike '%' || public.escape_like(left(p_query, 100)) || '%' or
      p.description ilike '%' || public.escape_like(left(p_query, 100)) || '%' or
      p.province ilike '%' || public.escape_like(left(p_query, 100)) || '%'
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(p_limit, 1), 1000);
$$;

grant execute on function public.properties_in_bounds(
  double precision, double precision, double precision, double precision, text, text, text[], text[],
  numeric, numeric, numeric, numeric, numeric, text, int
) to authenticated;

notify pgrst, 'reload schema';
