-- supabase/migrations/20261013000000_reel_comments.sql
--
-- تعليقات الريلز: تعليق على إعلان/ريل، رد على تعليق (مستوى واحد؛ الرد على رد يُربط بنفس التعليق الأصلى مع «الرد على فلان»)،
-- وإعجاب بالتعليق/الرد. الردود مخفية فى الواجهة حتى يضغط المستخدم على «عرض الردود».
--
--  • reel_comments       : التعليقات والردود (parent_id = null => تعليق، غير ذلك => رد).
--  • reel_comment_likes  : إعجابات التعليقات (like_count بيتحدّث بـ trigger).
--  • properties.comment_count : عدّاد التعليقات (تعليقات + ردود) يظهر بجانب أيقونة التعليقات.
--  • إشعارات: تعليق جديد → صاحب الريل | رد → صاحب التعليق المردود عليه (category = 'comment').
--  • بلاغات: reports تقبل target_type = 'comment'.
--
-- الأمان: التعليق مرتبط بسياسة رؤية العقار نفسها (من لا يرى العقار لا يرى تعليقاته)، والضيف (جلسة مجهولة) لا يكتب ولا يعجب،
-- وحد أقصى 6 تعليقات/دقيقة للمستخدم (trigger على الخادم)، والحذف لصاحب التعليق أو صاحب الريل أو الأدمن (صلاحية reels).

-- ---------------------------------------------------------------------
-- 1) الجداول
-- ---------------------------------------------------------------------
alter table public.properties
  add column if not exists comment_count integer not null default 0;

create table if not exists public.reel_comments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.reel_comments(id) on delete cascade,
  reply_to_user_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  like_count integer not null default 0,
  reply_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists reel_comments_property_idx
  on public.reel_comments (property_id, created_at desc) where parent_id is null;
create index if not exists reel_comments_parent_idx
  on public.reel_comments (parent_id, created_at);
create index if not exists reel_comments_user_idx
  on public.reel_comments (user_id, created_at desc);

create table if not exists public.reel_comment_likes (
  comment_id uuid not null references public.reel_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists reel_comment_likes_user_idx on public.reel_comment_likes (user_id);

-- ---------------------------------------------------------------------
-- 2) RLS
-- ---------------------------------------------------------------------
alter table public.reel_comments enable row level security;
alter table public.reel_comment_likes enable row level security;

-- القراءة: لو العقار ظاهر للمستخدم (سياسة properties نفسها) فتعليقاته ظاهرة.
drop policy if exists "comments readable when the reel is visible" on public.reel_comments;
create policy "comments readable when the reel is visible"
  on public.reel_comments for select
  to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id));

-- الكتابة: مستخدم مسجَّل (مش ضيف)، باسمه هو، على عقار ظاهر له.
drop policy if exists "signed-in users can comment" on public.reel_comments;
create policy "signed-in users can comment"
  on public.reel_comments for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and exists (select 1 from public.properties p where p.id = property_id)
  );

-- الحذف: صاحب التعليق، أو صاحب الريل (إدارة تعليقات ريله)، أو أدمن بصلاحية reels. لا يوجد تعديل للتعليق.
drop policy if exists "authors, reel owners and admins can delete comments" on public.reel_comments;
create policy "authors, reel owners and admins can delete comments"
  on public.reel_comments for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.admin_has_permission('reels')
    or exists (select 1 from public.properties p where p.id = property_id and p.seller_id = auth.uid())
  );

-- إعجابات التعليقات: كل مستخدم يرى ويدير إعجاباته فقط (العدّاد العام فى reel_comments.like_count).
drop policy if exists "users read their own comment likes" on public.reel_comment_likes;
create policy "users read their own comment likes"
  on public.reel_comment_likes for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "signed-in users like comments" on public.reel_comment_likes;
create policy "signed-in users like comments"
  on public.reel_comment_likes for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and exists (select 1 from public.reel_comments c where c.id = comment_id)
  );

drop policy if exists "users remove their own comment likes" on public.reel_comment_likes;
create policy "users remove their own comment likes"
  on public.reel_comment_likes for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3) قبل الإدراج: نظافة النص + عمق الردود + حد المعدل
-- ---------------------------------------------------------------------
create or replace function public.reel_comments_before_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_parent public.reel_comments%rowtype;
begin
  new.body := btrim(new.body);

  if new.parent_id is not null then
    select * into v_parent from public.reel_comments where id = new.parent_id;
    if not found then
      raise exception 'parent_not_found';
    end if;
    if v_parent.property_id <> new.property_id then
      raise exception 'parent_mismatch';
    end if;
    -- الرد على رد: يُربط بالتعليق الأصلى (مستوى واحد من الردود) ويُسجَّل «الرد على فلان».
    new.reply_to_user_id := v_parent.user_id;
    if v_parent.parent_id is not null then
      new.parent_id := v_parent.parent_id;
    end if;
  else
    new.reply_to_user_id := null;
  end if;

  -- حد المعدل: 6 تعليقات/ردود فى الدقيقة لكل مستخدم (يمنع السبام حتى لو العميل معدَّل).
  if (
    select count(*) from public.reel_comments
     where user_id = new.user_id and created_at > now() - interval '1 minute'
  ) >= 6 then
    raise exception 'rate_limited';
  end if;

  return new;
end;
$$;

drop trigger if exists reel_comments_before_insert on public.reel_comments;
create trigger reel_comments_before_insert
  before insert on public.reel_comments
  for each row execute function public.reel_comments_before_insert();

-- ---------------------------------------------------------------------
-- 4) بعد الإدراج/الحذف: العدّادات + الإشعارات
-- ---------------------------------------------------------------------
create or replace function public.handle_reel_comment_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_seller uuid;
begin
  if tg_op = 'INSERT' then
    update public.properties set comment_count = comment_count + 1 where id = new.property_id
      returning seller_id into v_seller;

    if new.parent_id is not null then
      update public.reel_comments set reply_count = reply_count + 1 where id = new.parent_id;
      -- رد: إشعار لصاحب التعليق المردود عليه.
      if new.reply_to_user_id is not null and new.reply_to_user_id <> new.user_id then
        insert into public.notifications (recipient_id, actor_id, category, text, property_id)
        values (new.reply_to_user_id, new.user_id, 'comment', 'ردّ على تعليقك: ' || left(new.body, 80), new.property_id);
      end if;
    elsif v_seller is not null and v_seller <> new.user_id then
      -- تعليق جديد: إشعار لصاحب الريل.
      insert into public.notifications (recipient_id, actor_id, category, text, property_id)
      values (v_seller, new.user_id, 'comment', 'علّق على إعلانك: ' || left(new.body, 80), new.property_id);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    update public.properties set comment_count = greatest(0, comment_count - 1) where id = old.property_id;
    if old.parent_id is not null then
      update public.reel_comments set reply_count = greatest(0, reply_count - 1) where id = old.parent_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists reel_comments_after_change on public.reel_comments;
create trigger reel_comments_after_change
  after insert or delete on public.reel_comments
  for each row execute function public.handle_reel_comment_change();

create or replace function public.handle_reel_comment_like_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.reel_comments set like_count = like_count + 1 where id = new.comment_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.reel_comments set like_count = greatest(0, like_count - 1) where id = old.comment_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists reel_comment_likes_after_change on public.reel_comment_likes;
create trigger reel_comment_likes_after_change
  after insert or delete on public.reel_comment_likes
  for each row execute function public.handle_reel_comment_like_change();

-- ---------------------------------------------------------------------
-- 5) تصنيف إشعار جديد + بلاغات التعليقات
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_category_check;
alter table public.notifications add constraint notifications_category_check
  check (category in ('like', 'save', 'follow', 'chat', 'new_match', 'price_drop', 'comment'));

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('property', 'live', 'request', 'comment'));
