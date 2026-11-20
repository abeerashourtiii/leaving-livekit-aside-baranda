-- ملف اهتمامات المستخدم لنظام التوصية («لك») فى الريلز الرئيسية: جدول واحد صف لكل مستخدم يحتوى ملخصًا مُجمّعًا
-- (أوزان خصائص مثل النوع/المحافظة/المعلن + قائمة ما شاهده مؤخرًا) وليس سجلًا تفصيليًا لكل حركة. يُحفظ لتبقى
-- التوصيات متّسقة بين أجهزة نفس الحساب، ويقدر المستخدم يمسحه أو يوقف التخصيص من الإعدادات.
-- كل مستخدم يقرأ/يكتب/يحذف صفّه فقط (RLS)، وحذف الحساب يحذفه تلقائيًا (cascade).
create table if not exists public.user_interest_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  profile    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_interest_profiles_size check (pg_column_size(profile) <= 65536)
);

alter table public.user_interest_profiles enable row level security;

drop policy if exists "own interest profile select" on public.user_interest_profiles;
create policy "own interest profile select" on public.user_interest_profiles
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "own interest profile insert" on public.user_interest_profiles;
create policy "own interest profile insert" on public.user_interest_profiles
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "own interest profile update" on public.user_interest_profiles;
create policy "own interest profile update" on public.user_interest_profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own interest profile delete" on public.user_interest_profiles;
create policy "own interest profile delete" on public.user_interest_profiles
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.user_interest_profiles from anon;
grant select, insert, update, delete on public.user_interest_profiles to authenticated;
