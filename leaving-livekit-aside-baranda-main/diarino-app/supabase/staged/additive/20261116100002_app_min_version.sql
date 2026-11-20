-- حد أدنى لإصدار التطبيق (إضافى، خامل افتراضيًا: 0.0.0 ⇒ لا حجب). يُستخدم بعد نشر نسخة جديدة وقبل تطبيق migrations «التضييق»
-- (supabase/staged/tightening) التى تكسر النسخ القديمة. التطبيق (أندرويد/آيفون) يقرأ الصف الخاص بمنصته ويعرض شاشة «تحديث مطلوب»
-- إن كان إصداره الأصلى (versionName / CFBundleShortVersionString) أقل من min_version. الويب غير معنى.
-- التعديل من SQL Editor بمفتاح الخدمة/المالك فقط، مثال:
--   update public.app_version_requirements set min_version = '1.1.0', store_url = 'https://play.google.com/store/apps/details?id=com.diarino.app' where platform = 'android';
-- قابل لإعادة التشغيل.
create table if not exists public.app_version_requirements (
  platform text primary key check (platform in ('android', 'ios')),
  min_version text not null default '0.0.0' check (min_version ~ '^[0-9]+(\.[0-9]+){0,2}$'),
  store_url text check (store_url is null or store_url ~ '^https://'),
  message text check (message is null or char_length(message) <= 300),
  updated_at timestamptz not null default now()
);
alter table public.app_version_requirements enable row level security;
revoke all on public.app_version_requirements from public, anon, authenticated;
grant select on public.app_version_requirements to anon, authenticated;

drop policy if exists "app version requirements are public" on public.app_version_requirements;
create policy "app version requirements are public"
  on public.app_version_requirements for select
  to anon, authenticated
  using (true);

insert into public.app_version_requirements (platform) values ('android'), ('ios') on conflict do nothing;

notify pgrst, 'reload schema';
