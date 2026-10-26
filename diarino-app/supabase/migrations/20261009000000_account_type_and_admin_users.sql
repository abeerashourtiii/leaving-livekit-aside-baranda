-- supabase/migrations/20261009000000_account_type_and_admin_users.sql
--
-- 1) نوع الحساب (فرد / مطور عقارى / بروكر): إجبارى بعد أول تسجيل دخول بجوجل (app/edit-profile.tsx).
--    السياسة الحالية "users can update their own profile" بتغطى العمود الجديد من غير تعديل.
-- 2) نوع الحساب يظهر للزوار على صفحة المعلن: بنضيفه لآخر عمود فى الفيو profiles_public
--    (CREATE OR REPLACE VIEW بيقبل الأعمدة الجديدة فى الآخر بس).
-- 3) admin_list_users(): قائمة المستخدمين الكاملة لشاشة الأدمن (المستخدمون) — بريد/طريقة التسجيل/آخر دخول من
--    auth.users + بيانات البروفايل + إحصائيات الإعلانات. security definer ومقصورة على من عنده صلاحية قسم
--    «المستخدمون» (admin_has_permission('users'))؛ لغيرهم بترجّع صفر صفوف.

alter table public.profiles
  add column if not exists account_type text
  check (account_type in ('individual', 'developer', 'broker'));

create or replace view public.profiles_public as
  select
    id, full_name, avatar_url, verified, is_public,
    chat_on_properties, chat_on_requests, show_whatsapp, show_call_button,
    bio,
    account_type
  from public.profiles;

grant select on public.profiles_public to authenticated;

create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  provider text,
  is_anonymous boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  full_name text,
  username text,
  first_name text,
  last_name text,
  avatar_url text,
  phone_e164 text,
  birth_date date,
  gender text,
  nationality text,
  residence text,
  account_type text,
  verified boolean,
  is_public boolean,
  bio text,
  listings_count bigint,
  requests_count bigint,
  total_views bigint,
  total_likes bigint,
  followers_count bigint,
  is_admin boolean
)
language sql
stable
security definer set search_path = public, auth
as $$
  select
    u.id,
    u.email::text,
    coalesce(u.raw_app_meta_data->>'provider', 'email'),
    coalesce(u.is_anonymous, false),
    u.created_at,
    u.last_sign_in_at,
    p.full_name,
    p.username,
    p.first_name,
    p.last_name,
    p.avatar_url,
    p.phone_e164,
    p.birth_date,
    p.gender,
    p.nationality,
    p.residence,
    p.account_type,
    coalesce(p.verified, false),
    coalesce(p.is_public, true),
    p.bio,
    (select count(*) from public.properties x where x.seller_id = u.id),
    (select count(*) from public.requests r where r.requester_id = u.id),
    (select coalesce(sum(x.views), 0) from public.properties x where x.seller_id = u.id),
    (select coalesce(sum(x.likes), 0) from public.properties x where x.seller_id = u.id),
    (select count(*) from public.follows f where f.followee_id = u.id),
    exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role = 'admin')
  from auth.users u
  left join public.profiles p on p.id = u.id
  where public.admin_has_permission('users')
  order by u.created_at desc;
$$;

revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;
