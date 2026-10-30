-- supabase/migrations/20261011000000_music_library.sql
--
-- المكتبة الموسيقية للإعلانات (شاشة «انشر عقارك» + لوحة الأدمن):
-- جدول بيانات وصفية بس (الاسم، الوصف، الرابط، المدة) — الملفات الصوتية نفسها على Cloudinary فمبتاخدش مساحة
-- من Supabase Storage. الأدمن (صلاحية قسم «music») يضيف/يخفى/يحذف مقطع من لوحة التحكم.
-- المقاطع الخمسة المدمجة فى التطبيق (assets/music) بتتزرع كصفوف builtin_key (من غير url) عشان الأدمن يقدر
-- يخفيها/يحذفها من القائمة. property.music بيفضل نص = title المقطع (زى ما كان).

create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  description text,
  url text,
  public_id text,
  builtin_key text,
  duration_sec numeric,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint music_tracks_source_chk check (url is not null or builtin_key is not null)
);

alter table public.music_tracks enable row level security;

drop policy if exists "music tracks are readable" on public.music_tracks;
create policy "music tracks are readable"
  on public.music_tracks for select
  to authenticated
  using (active or public.admin_has_permission('music'));

drop policy if exists "admins can manage music tracks" on public.music_tracks;
create policy "admins can manage music tracks"
  on public.music_tracks for all
  to authenticated
  using (public.admin_has_permission('music'))
  with check (public.admin_has_permission('music'));

insert into public.music_tracks (title, description, builtin_key, sort_order) values
  ('Uplifting Corporate', 'موسيقى حماسية', 'Uplifting Corporate', 10),
  ('Chill Lounge', 'هادئة وعصرية', 'Chill Lounge', 20),
  ('Acoustic Morning', 'جيتار هادئ', 'Acoustic Morning', 30),
  ('Oriental Vibes', 'شرقية خفيفة', 'Oriental Vibes', 40),
  ('Modern Beat', 'إيقاع عصري', 'Modern Beat', 50)
on conflict (title) do nothing;
