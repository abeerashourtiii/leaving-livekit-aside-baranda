-- supabase/migrations/20261121000100_media_fingerprints.sql
--
-- منع تكرار رفع نفس الصورة/الفيديو/الصوت على Cloudinary (يستهلك التخزين Storage والنقل Bandwidth دون داعٍ).
--   قبل كل رفع يحسب التطبيق «بصمة» الملف (MD5 على أندرويد/آيفون، SHA-256 على الويب) + حجمه، ويبحث هنا عن رفع سابق لنفس الملف
--   *من نفس المستخدم* ونفس النوع؛ فإن وُجد وما زال الملف حيًّا على Cloudinary أعاد استخدام رابطه بدل الرفع من جديد.
--   بعد كل رفع ناجح تُسجَّل البصمة فورًا (قبل أن يحفظ أى شاشة سجل الإعلان) فلو فشل الحفظ لاحقًا أو انقطع الاتصال لا يُرفع الملف ثانيةً عند إعادة المحاولة.
--
-- الخصوصية والأمان:
--   • الصف يخص مالكه وحده (RLS: owner_id = auth.uid()) — لا يرى مستخدم بصمات غيره ولا يعيد استخدام رابط غيره (لا مطابقة بين المستخدمين).
--   • لا يُخزَّن محتوى الملف، فقط البصمة والحجم والنوع ورابط Cloudinary العام الذى رفعه المستخدم نفسه وبياناته (أبعاد/مدة).
--   • تُحذف الصفوف تلقائيًا عند حذف الحساب (on delete cascade).
--   • التطبيق لا يستخدم overwrite=true إطلاقًا ولا يمرّر public_id من العميل، فلا يمكن لهذه الآلية استبدال ملف موجود.
create table if not exists public.media_fingerprints (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image', 'video', 'audio')),
  algo text not null check (algo in ('md5', 'sha256')),
  content_hash text not null check (char_length(content_hash) between 16 and 128),
  size_bytes bigint not null check (size_bytes > 0),
  url text not null check (url like 'https://res.cloudinary.com/%' and char_length(url) <= 2048),
  public_id text not null check (char_length(public_id) <= 512),
  thumbnail_url text check (thumbnail_url is null or (thumbnail_url like 'https://res.cloudinary.com/%' and char_length(thumbnail_url) <= 2048)),
  width integer,
  height integer,
  duration numeric,
  format text,
  bytes bigint,
  created_at timestamptz not null default now(),
  unique (owner_id, kind, algo, content_hash, size_bytes)
);

create index if not exists media_fingerprints_owner_idx on public.media_fingerprints (owner_id, created_at desc);

alter table public.media_fingerprints enable row level security;

drop policy if exists "owners read own media fingerprints" on public.media_fingerprints;
create policy "owners read own media fingerprints"
  on public.media_fingerprints for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists "owners insert own media fingerprints" on public.media_fingerprints;
create policy "owners insert own media fingerprints"
  on public.media_fingerprints for insert
  to authenticated
  with check (owner_id = auth.uid());

-- الحذف: يزيل المستخدم بصمة رابط ميت (حُذف من Cloudinary) ليُعاد رفع الملف عند الحاجة.
drop policy if exists "owners delete own media fingerprints" on public.media_fingerprints;
create policy "owners delete own media fingerprints"
  on public.media_fingerprints for delete
  to authenticated
  using (owner_id = auth.uid());

revoke all on public.media_fingerprints from anon, authenticated;
grant select, insert, delete on public.media_fingerprints to authenticated;
