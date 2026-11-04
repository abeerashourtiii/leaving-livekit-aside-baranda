-- supabase/migrations/20261014000000_comment_filter_pin_owner_like.sql
--
-- ثلاث إضافات على تعليقات الريلز (بعد 20261013000000_reel_comments.sql):
--  1) حجب آلى على الخادم: أى تعليق/رد فيه رقم هاتف أو رابط أو بريد إلكترونى أو حساب تواصل يُرفض
--     (exception 'blocked_contact') — سياسة «التعليقات والردود» + سياسة البيع والرسوم (منع التحايل بنقل المتعامل خارج التطبيق).
--     نسخة مطابقة على العميل (lib/commentGuard.ts) لتنبيه المستخدم فورًا، لكن الخادم هو المرجع (العميل المعدَّل لا يتجاوزه).
--  2) تثبيت تعليق: صاحب الريل (أو الأدمن بصلاحية reels) يثبّت تعليقًا رئيسيًا واحدًا فى أعلى القائمة (pin_reel_comment).
--  3) «أعجب به صاحب الريل»: reel_comments.owner_liked بيتحدّث تلقائيًا من إعجاب صاحب الريل، مع إشعار لصاحب التعليق.

-- ---------------------------------------------------------------------
-- 1) أعمدة جديدة
-- ---------------------------------------------------------------------
alter table public.reel_comments
  add column if not exists pinned_at timestamptz,
  add column if not exists owner_liked boolean not null default false;

-- التثبيت للتعليقات الرئيسية فقط، وتعليق واحد مثبّت لكل ريل.
alter table public.reel_comments drop constraint if exists reel_comments_pin_top_level_only;
alter table public.reel_comments
  add constraint reel_comments_pin_top_level_only check (pinned_at is null or parent_id is null);

create unique index if not exists reel_comments_one_pinned_per_property
  on public.reel_comments (property_id) where pinned_at is not null;

-- تعبئة owner_liked للإعجابات الموجودة قبل هذه الإضافة.
update public.reel_comments c
   set owner_liked = true
 where exists (
   select 1
     from public.reel_comment_likes l
     join public.properties p on p.id = c.property_id
    where l.comment_id = c.id and l.user_id = p.seller_id
 );

-- ---------------------------------------------------------------------
-- 2) كاشف الأرقام والروابط (immutable — بيرجع سبب الحجب أو null)
-- ---------------------------------------------------------------------
create or replace function public.reel_comment_blocked_reason(p_body text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
  v_words integer;
begin
  -- تطبيع: الأرقام العربية/الفارسية → لاتينية، وحذف المحارف غير المرئية والتطويل (ـ) اللى بتُستخدم للتهرّب.
  v := translate(coalesce(p_body, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  v := regexp_replace(v, '[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u0640]', '', 'g');

  -- بريد إلكترونى
  if v ~* '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}' then
    return 'email';
  end if;

  -- حساب تواصل (@username)
  if v ~* '(^|\s)@[a-z0-9_.]{3,}' then
    return 'handle';
  end if;

  -- روابط ونطاقات ومنصات تواصل
  if v ~* '(https?://|www\.)'
     or v ~* '(^|[^a-z0-9])[a-z0-9-]{2,}\.(com|net|org|io|me|app|co|eg|info|xyz|link|ly|gl|ae|sa|tv|online|site|shop|store|biz|cc|ws|us|uk)([^a-z0-9]|$)'
     or v ~* '(^|[^a-z0-9])(t\.me|wa\.me|bit\.ly|goo\.gl|tinyurl\.com)'
     or v ~* '(instagram|facebook|tiktok|snapchat|telegram|whatsapp)\.[a-z]'
     or v ~ '(دوت|نقطة)\s*(كوم|نت|اورج|أورج)' then
    return 'link';
  end if;

  -- رقم هاتف: 10 أرقام أو أكتر حتى لو مفصولة بمسافات/نقط/شرطات/أقواس، أو رقم دولى (+ أو 00).
  -- (الأسعار بالفواصل "12,000,000" والمساحات "120 م" والغرف "3 غرف" مش بتتأثر.)
  if v ~ '\d([\s.\-()]*\d){9,}' or v ~ '(\+|00)\s*\d{8,}' then
    return 'phone';
  end if;

  -- أرقام مكتوبة بالحروف ("صفر واحد صفر واحد ...") — 7 كلمات أرقام أو أكتر.
  select count(*) into v_words
    from regexp_matches(
      lower(v),
      '(صفر|واحد|واحدة|اثنين|اتنين|اثنان|ثلاثة|ثلاث|تلاتة|تلات|اربعة|أربعة|أربع|اربع|خمسة|خمس|ستة|سبعة|سبع|ثمانية|تمانية|ثماني|تسعة|تسع|zero|one|two|three|four|five|six|seven|eight|nine)',
      'g'
    );
  if v_words >= 7 then
    return 'phone';
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) قبل الإدراج: نفس منطق 20261013000000 + الحجب الآلى
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

  if public.reel_comment_blocked_reason(new.body) is not null then
    raise exception 'blocked_contact';
  end if;

  if new.parent_id is not null then
    select * into v_parent from public.reel_comments where id = new.parent_id;
    if not found then
      raise exception 'parent_not_found';
    end if;
    if v_parent.property_id <> new.property_id then
      raise exception 'parent_mismatch';
    end if;
    new.reply_to_user_id := v_parent.user_id;
    if v_parent.parent_id is not null then
      new.parent_id := v_parent.parent_id;
    end if;
  else
    new.reply_to_user_id := null;
  end if;

  -- الحقول التى لا يحددها العميل.
  new.pinned_at := null;
  new.owner_liked := false;
  new.like_count := 0;
  new.reply_count := 0;

  if (
    select count(*) from public.reel_comments
     where user_id = new.user_id and created_at > now() - interval '1 minute'
  ) >= 6 then
    raise exception 'rate_limited';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) تثبيت / إلغاء تثبيت تعليق
-- ---------------------------------------------------------------------
create or replace function public.pin_reel_comment(p_comment_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_c public.reel_comments%rowtype;
  v_seller uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_c from public.reel_comments where id = p_comment_id for update;
  if not found then
    raise exception 'comment_not_found';
  end if;

  select seller_id into v_seller from public.properties where id = v_c.property_id;
  if v_seller is distinct from auth.uid() and not public.admin_has_permission('reels') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_c.parent_id is not null then
    raise exception 'reply_not_pinnable';
  end if;

  if p_pinned then
    update public.reel_comments set pinned_at = null
     where property_id = v_c.property_id and pinned_at is not null and id <> p_comment_id;
    update public.reel_comments set pinned_at = now() where id = p_comment_id;
  else
    update public.reel_comments set pinned_at = null where id = p_comment_id;
  end if;
end;
$$;

revoke all on function public.pin_reel_comment(uuid, boolean) from public;
grant execute on function public.pin_reel_comment(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5) إعجاب التعليق: العدّاد + «أعجب به صاحب الريل» + إشعار لصاحب التعليق
-- ---------------------------------------------------------------------
create or replace function public.handle_reel_comment_like_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_author uuid;
  v_property uuid;
  v_seller uuid;
begin
  if tg_op = 'INSERT' then
    update public.reel_comments set like_count = like_count + 1 where id = new.comment_id
      returning user_id, property_id into v_author, v_property;
    select seller_id into v_seller from public.properties where id = v_property;
    if v_seller is not null and new.user_id = v_seller then
      update public.reel_comments set owner_liked = true where id = new.comment_id;
      if v_author is not null and v_author <> new.user_id then
        insert into public.notifications (recipient_id, actor_id, category, text, property_id)
        values (v_author, new.user_id, 'comment', 'أعجب صاحب الريل بتعليقك', v_property);
      end if;
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    update public.reel_comments set like_count = greatest(0, like_count - 1) where id = old.comment_id
      returning property_id into v_property;
    select seller_id into v_seller from public.properties where id = v_property;
    if v_seller is not null and old.user_id = v_seller then
      update public.reel_comments set owner_liked = false where id = old.comment_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;
