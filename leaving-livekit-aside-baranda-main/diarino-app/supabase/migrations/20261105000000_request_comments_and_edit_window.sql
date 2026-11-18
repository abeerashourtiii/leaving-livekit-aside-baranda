-- supabase/migrations/20261105000000_request_comments_and_edit_window.sql
--
-- 1) تعليقات على الطلبات (صفحة «الطلبات»): نفس تعليقات الريلز — تعليق، رد (مستوى واحد)، إعجاب 👍، تثبيت من صاحب الطلب،
--    «أعجب به صاحب الطلب»، حجب آلى للأرقام/الروابط، حد معدل 6/دقيقة، وإشعارات (تعليق جديد → صاحب الطلب | رد → صاحب التعليق).
-- 2) تعديل الطلب لصاحبه **خلال 24 ساعة من عرضه** (created_at) — مثل نافذة الحذف الموجودة (20261021000000_edit_delete_windows.sql)،
--    مطبَّق على الخادم (سياسة RLS + trigger)، والأدمن (صلاحية requests) غير مقيَّد.

-- ---------------------------------------------------------------------
-- 1) الجداول والأعمدة
-- ---------------------------------------------------------------------
alter table public.requests add column if not exists comment_count integer not null default 0;
alter table public.notifications add column if not exists request_id uuid references public.requests(id) on delete cascade;

create table if not exists public.request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.request_comments(id) on delete cascade,
  reply_to_user_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  like_count integer not null default 0,
  reply_count integer not null default 0,
  pinned_at timestamptz,
  owner_liked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint request_comments_pin_top_level_only check (pinned_at is null or parent_id is null)
);

create index if not exists request_comments_request_idx on public.request_comments (request_id, created_at desc) where parent_id is null;
create index if not exists request_comments_parent_idx on public.request_comments (parent_id, created_at);
create index if not exists request_comments_user_idx on public.request_comments (user_id, created_at desc);
create unique index if not exists request_comments_one_pinned_per_request on public.request_comments (request_id) where pinned_at is not null;

create table if not exists public.request_comment_likes (
  comment_id uuid not null references public.request_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists request_comment_likes_user_idx on public.request_comment_likes (user_id);

-- ---------------------------------------------------------------------
-- 2) RLS
-- ---------------------------------------------------------------------
alter table public.request_comments enable row level security;
alter table public.request_comment_likes enable row level security;

drop policy if exists "request comments readable" on public.request_comments;
create policy "request comments readable" on public.request_comments for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id));

drop policy if exists "signed-in users can comment on requests" on public.request_comments;
create policy "signed-in users can comment on requests" on public.request_comments for insert to authenticated
  with check (
    user_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and exists (select 1 from public.requests r where r.id = request_id)
  );

drop policy if exists "authors, request owners and admins can delete request comments" on public.request_comments;
create policy "authors, request owners and admins can delete request comments" on public.request_comments for delete to authenticated
  using (
    user_id = auth.uid()
    or public.admin_has_permission('requests')
    or public.admin_has_permission('reports')
    or exists (select 1 from public.requests r where r.id = request_id and r.requester_id = auth.uid())
  );

drop policy if exists "users read their own request comment likes" on public.request_comment_likes;
create policy "users read their own request comment likes" on public.request_comment_likes for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "signed-in users like request comments" on public.request_comment_likes;
create policy "signed-in users like request comments" on public.request_comment_likes for insert to authenticated
  with check (
    user_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and exists (select 1 from public.request_comments c where c.id = comment_id)
  );

drop policy if exists "users remove their own request comment likes" on public.request_comment_likes;
create policy "users remove their own request comment likes" on public.request_comment_likes for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3) قبل الإدراج: نظافة + عمق الردود + الحجب الآلى + حد المعدل
-- ---------------------------------------------------------------------
create or replace function public.request_comments_before_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_parent public.request_comments%rowtype;
begin
  new.body := btrim(new.body);

  if public.reel_comment_blocked_reason(new.body) is not null then
    raise exception 'blocked_contact';
  end if;

  if new.parent_id is not null then
    select * into v_parent from public.request_comments where id = new.parent_id;
    if not found then
      raise exception 'parent_not_found';
    end if;
    if v_parent.request_id <> new.request_id then
      raise exception 'parent_mismatch';
    end if;
    new.reply_to_user_id := v_parent.user_id;
    if v_parent.parent_id is not null then
      new.parent_id := v_parent.parent_id;
    end if;
  else
    new.reply_to_user_id := null;
  end if;

  new.pinned_at := null;
  new.owner_liked := false;
  new.like_count := 0;
  new.reply_count := 0;

  if (
    select count(*) from public.request_comments
     where user_id = new.user_id and created_at > now() - interval '1 minute'
  ) >= 6 then
    raise exception 'rate_limited';
  end if;

  return new;
end;
$$;

drop trigger if exists request_comments_before_insert on public.request_comments;
create trigger request_comments_before_insert
  before insert on public.request_comments
  for each row execute function public.request_comments_before_insert();

-- ---------------------------------------------------------------------
-- 4) بعد الإدراج/الحذف: العدّادات + الإشعارات
-- ---------------------------------------------------------------------
create or replace function public.handle_request_comment_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_owner uuid;
begin
  if tg_op = 'INSERT' then
    update public.requests set comment_count = comment_count + 1 where id = new.request_id
      returning requester_id into v_owner;

    if new.parent_id is not null then
      update public.request_comments set reply_count = reply_count + 1 where id = new.parent_id;
      if new.reply_to_user_id is not null and new.reply_to_user_id <> new.user_id then
        insert into public.notifications (recipient_id, actor_id, category, text, request_id)
        values (new.reply_to_user_id, new.user_id, 'comment', 'ردّ على تعليقك على طلب: ' || left(new.body, 80), new.request_id);
      end if;
    elsif v_owner is not null and v_owner <> new.user_id then
      insert into public.notifications (recipient_id, actor_id, category, text, request_id)
      values (v_owner, new.user_id, 'comment', 'علّق على طلبك: ' || left(new.body, 80), new.request_id);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    update public.requests set comment_count = greatest(0, comment_count - 1) where id = old.request_id;
    if old.parent_id is not null then
      update public.request_comments set reply_count = greatest(0, reply_count - 1) where id = old.parent_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists request_comments_after_change on public.request_comments;
create trigger request_comments_after_change
  after insert or delete on public.request_comments
  for each row execute function public.handle_request_comment_change();

create or replace function public.handle_request_comment_like_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_author uuid;
  v_request uuid;
  v_owner uuid;
begin
  if tg_op = 'INSERT' then
    update public.request_comments set like_count = like_count + 1 where id = new.comment_id
      returning user_id, request_id into v_author, v_request;
    select requester_id into v_owner from public.requests where id = v_request;
    if v_owner is not null and new.user_id = v_owner then
      update public.request_comments set owner_liked = true where id = new.comment_id;
      if v_author is not null and v_author <> new.user_id then
        insert into public.notifications (recipient_id, actor_id, category, text, request_id)
        values (v_author, new.user_id, 'comment', 'أعجب صاحب الطلب بتعليقك', v_request);
      end if;
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    update public.request_comments set like_count = greatest(0, like_count - 1) where id = old.comment_id
      returning request_id into v_request;
    select requester_id into v_owner from public.requests where id = v_request;
    if v_owner is not null and old.user_id = v_owner then
      update public.request_comments set owner_liked = false where id = old.comment_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists request_comment_likes_after_change on public.request_comment_likes;
create trigger request_comment_likes_after_change
  after insert or delete on public.request_comment_likes
  for each row execute function public.handle_request_comment_like_change();

-- ---------------------------------------------------------------------
-- 5) تثبيت تعليق (صاحب الطلب أو الأدمن)
-- ---------------------------------------------------------------------
create or replace function public.pin_request_comment(p_comment_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_c public.request_comments%rowtype;
  v_owner uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_c from public.request_comments where id = p_comment_id for update;
  if not found then raise exception 'comment_not_found'; end if;
  select requester_id into v_owner from public.requests where id = v_c.request_id;
  if v_owner is distinct from auth.uid() and not public.admin_has_permission('requests') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_c.parent_id is not null then raise exception 'reply_not_pinnable'; end if;
  if p_pinned then
    update public.request_comments set pinned_at = null where request_id = v_c.request_id and pinned_at is not null and id <> p_comment_id;
    update public.request_comments set pinned_at = now() where id = p_comment_id;
  else
    update public.request_comments set pinned_at = null where id = p_comment_id;
  end if;
end;
$$;

revoke all on function public.pin_request_comment(uuid, boolean) from public;
grant execute on function public.pin_request_comment(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 6) تعديل الطلب: 24 ساعة من العرض (RLS + trigger)
-- ---------------------------------------------------------------------
drop policy if exists "requesters can update their own requests" on public.requests;
create policy "requesters can update their own requests"
  on public.requests for update
  to authenticated
  using (requester_id = auth.uid() and now() <= created_at + public.owner_window())
  with check (requester_id = auth.uid());

-- الأدمن (صلاحية requests) يعدّل بلا قيد زمنى.
drop policy if exists "admins can update any request" on public.requests;
create policy "admins can update any request"
  on public.requests for update
  to authenticated
  using (public.admin_has_permission('requests'))
  with check (public.admin_has_permission('requests'));

-- عدّادات النظام (offers_count/comment_count) بتتحدّث من دوال/triggers الخادم وليست «تعديلًا» للمحتوى؛ أما تغيير محتوى الطلب
-- (النوع/الغرض/المحافظة/المنطقة/السعر/المساحة/الغرف/الحمامات/الوصف/الاسم) فمسموح لصاحبه فقط خلال النافذة.
create or replace function public.requests_edit_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.admin_has_permission('requests') then
    return new;
  end if;
  -- هوية الطلب لا تتغيّر أبدًا من العميل.
  new.requester_id := old.requester_id;
  new.created_at := old.created_at;

  if (new.purpose, new.type, new.province, new.location, new.price_max, new.area, new.rooms, new.baths, new.description, new.requester_name)
     is distinct from
     (old.purpose, old.type, old.province, old.location, old.price_max, old.area, old.rooms, old.baths, old.description, old.requester_name) then
    if old.requester_id is distinct from auth.uid() or now() > old.created_at + public.owner_window() then
      raise exception 'edit_window_closed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists requests_edit_guard on public.requests;
create trigger requests_edit_guard
  before update on public.requests
  for each row execute function public.requests_edit_guard();
