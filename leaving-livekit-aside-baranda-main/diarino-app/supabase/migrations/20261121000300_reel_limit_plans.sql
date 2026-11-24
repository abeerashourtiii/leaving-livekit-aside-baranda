-- supabase/migrations/20261121000300_reel_limit_plans.sql
--
-- ١) حذف الإعلان للمعلن فى أى وقت (إلغاء قيد الـ 24 ساعة للحذف؛ التعديل يبقى 24 ساعة).
-- ٢) الحد الأقصى لريلزات المعلن: 20 مجانًا، مع باقات شهرية تضيف مساحة:
--      • plan1: +30 ريل (إجمالى 50) بسعر 300 ج.م/شهر      • plan2: +100 ريل (إجمالى 120) بسعر 800 ج.م/شهر
--    الدفع بنفس آلية «اجعل الإعلان افتتاحي/مميز» والمساحة الإعلانية: فودافون كاش / اتصالات كاش / إنستاباي ثم مراجعة الأدمن وتفعيل الباقة.
--    فترة السماح: بعد انتهاء الشهر دون تجديد تبقى مساحة الباقة 30 يومًا (الريلز الإضافية تظل ظاهرة)، وبعدها يعود الحد إلى 20
--    فيُمنع نشر أى ريل جديد لحين التجديد أو حذف ما يكفى من ريلزاتك (لا يُحذف ولا يُخفى شيء من ريلزاته القائمة).
--    إشعارات: قبل الانتهاء بـ 7 أيام و3 أيام ويوم الانتهاء، وفى السماح قبل نهايتها بـ 7 أيام وعند نهايتها (process_reel_plan_lifecycle — جدولة يومية).
-- ٣) حذف ملفات Cloudinary فورًا بعد حذف الإعلان: الطابور يصير مستحقًا فورًا + owner_id + claim_cloudinary_cleanup_for (mode process_own).
--
-- «الريل المحتسب» = كل إعلانات المعلن غير المرفوضة (قيد المراجعة + المنشورة + المغلقة بصفقة) لأنها كلها تظهر فى صفحته وصفحة إدارة حسابه.
-- ⚠ من لديه الآن أكثر من 20 إعلانًا لا يُحذف له شيء، لكنه لا ينشر جديدًا قبل الحذف أو الاشتراك.
-- قابل لإعادة التشغيل.

-- ---------------------------------------------------------------------
-- ١) حذف الإعلان فى أى وقت
-- ---------------------------------------------------------------------
drop policy if exists "sellers can delete their own properties" on public.properties;
create policy "sellers can delete their own properties"
  on public.properties for delete
  to authenticated
  using (seller_id = auth.uid());

-- ---------------------------------------------------------------------
-- ٣) طابور Cloudinary: حذف فورى + معالجة طلبات المالك نفسه
-- ---------------------------------------------------------------------
alter table public.cloudinary_cleanup_queue add column if not exists owner_id uuid;
alter table public.cloudinary_cleanup_queue alter column due_at set default now();
create index if not exists cloudinary_cleanup_queue_owner_idx
  on public.cloudinary_cleanup_queue (owner_id, due_at) where done_at is null;

create or replace function public.cloudinary_safe_uuid(p text)
returns uuid
language plpgsql immutable
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.cloudinary_enqueue_removed(
  p_old text[], p_new text[], p_table text, p_source text, p_reason text, p_owner uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  keep text[];
  u text;
  r record;
begin
  select coalesce(array_agg(distinct p.public_id), '{}') into keep
    from unnest(coalesce(p_new, '{}')) n cross join lateral public.cloudinary_parse_url(n) p;
  for u in select distinct unnest(coalesce(p_old, '{}')) loop
    for r in select * from public.cloudinary_parse_url(u) loop
      if r.public_id = any (keep) then continue; end if;
      insert into public.cloudinary_cleanup_queue (cloud_name, resource_type, public_id, source_table, source_id, reason, owner_id, due_at)
      values (r.cloud_name, r.resource_type, r.public_id, p_table, p_source, p_reason, p_owner, now())
      on conflict (cloud_name, resource_type, public_id) where done_at is null do nothing;
    end loop;
  end loop;
end;
$$;

create or replace function public.trg_cloudinary_enqueue()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  j jsonb := to_jsonb(OLD);
  v_owner uuid;
begin
  begin
    v_owner := coalesce(
      public.cloudinary_safe_uuid(j ->> 'seller_id'), public.cloudinary_safe_uuid(j ->> 'owner_id'),
      public.cloudinary_safe_uuid(j ->> 'user_id'), public.cloudinary_safe_uuid(j ->> 'payer_id'),
      public.cloudinary_safe_uuid(j ->> 'sender_id'),
      case when TG_TABLE_NAME = 'profiles' then public.cloudinary_safe_uuid(j ->> 'id') end
    );
    if TG_OP = 'DELETE' then
      perform public.cloudinary_enqueue_removed(
        public.cloudinary_urls_in(j), '{}', TG_TABLE_NAME, j ->> 'id', 'deleted', v_owner);
    else
      perform public.cloudinary_enqueue_removed(
        public.cloudinary_urls_in(j), public.cloudinary_urls_in(to_jsonb(NEW)),
        TG_TABLE_NAME, j ->> 'id', 'replaced', v_owner);
    end if;
  exception when others then
    raise warning 'cloudinary cleanup enqueue failed for %: %', TG_TABLE_NAME, sqlerrm;
  end;
  return null;
end;
$$;

create or replace function public.claim_cloudinary_cleanup_for(p_owner uuid, p_limit integer default 25)
returns setof public.cloudinary_cleanup_queue
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with c as (
    select id from public.cloudinary_cleanup_queue
     where done_at is null and owner_id = p_owner and due_at <= now() and next_attempt_at <= now() and attempts < 8
     order by due_at
     limit greatest(1, least(coalesce(p_limit, 25), 50))
     for update skip locked
  )
  update public.cloudinary_cleanup_queue q
     set attempts = q.attempts + 1,
         next_attempt_at = now() + interval '10 minutes'
    from c
   where q.id = c.id
  returning q.*;
end;
$$;

revoke all on function public.cloudinary_safe_uuid(text) from public, anon, authenticated;
revoke all on function public.cloudinary_enqueue_removed(text[], text[], text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.claim_cloudinary_cleanup_for(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_cloudinary_cleanup_for(uuid, integer) to service_role;

-- ---------------------------------------------------------------------
-- ٢) الحد الأقصى والباقات
-- ---------------------------------------------------------------------
create table if not exists public.reel_plan_settings (
  id boolean primary key default true check (id),
  free_limit integer not null default 20 check (free_limit between 1 and 1000),
  plan1_extra integer not null default 30 check (plan1_extra between 1 and 5000),
  plan1_price_egp numeric(10,2) not null default 300 check (plan1_price_egp >= 0),
  plan2_extra integer not null default 100 check (plan2_extra between 1 and 5000),
  plan2_price_egp numeric(10,2) not null default 800 check (plan2_price_egp >= 0),
  period_days integer not null default 30 check (period_days between 1 and 365),
  grace_days integer not null default 30 check (grace_days between 0 and 365),
  updated_at timestamptz not null default now()
);
insert into public.reel_plan_settings (id) values (true) on conflict (id) do nothing;
alter table public.reel_plan_settings enable row level security;

drop policy if exists "reel plan settings are readable" on public.reel_plan_settings;
create policy "reel plan settings are readable"
  on public.reel_plan_settings for select to authenticated using (true);

-- تغيير الأسعار والحدود: المشرف الرئيسى فقط (كإعدادات رسوم الصفقات).
drop policy if exists "super admin can update reel plan settings" on public.reel_plan_settings;
create policy "super admin can update reel plan settings"
  on public.reel_plan_settings for update to authenticated
  using (public.is_super_admin_user())
  with check (public.is_super_admin_user());

create table if not exists public.reel_plan_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  payer_name text,
  payer_phone text,
  payer_email text,
  plan text not null check (plan in ('plan1', 'plan2')),
  extra_reels integer not null check (extra_reels > 0),
  price_egp numeric(10,2) not null check (price_egp >= 0),
  period_days integer not null check (period_days > 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'submitted', 'active', 'rejected', 'cancelled', 'expired')),
  payment_method text check (payment_method in ('vodafone_cash', 'etisalat_cash', 'instapay')),
  payment_sender_name text,
  payment_contact_phone text,
  payment_submitted_at timestamptz,
  payment_ref text,
  admin_note text,
  payer_note text,
  paid_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  grace_ends_at timestamptz,
  created_at timestamptz not null default now(),
  handled_by uuid,
  handled_at timestamptz
);

create index if not exists reel_plan_orders_user_idx on public.reel_plan_orders (user_id, created_at desc);
create index if not exists reel_plan_orders_status_idx on public.reel_plan_orders (status, ends_at);
-- طلب واحد مفتوح (بانتظار السداد/المراجعة) لكل مستخدم وباقة.
create unique index if not exists reel_plan_orders_one_open_per_plan
  on public.reel_plan_orders (user_id, plan)
  where status in ('pending_payment', 'submitted') and user_id is not null;

alter table public.reel_plan_orders enable row level security;
drop policy if exists "owners read own reel plan orders, admins read all" on public.reel_plan_orders;
create policy "owners read own reel plan orders, admins read all"
  on public.reel_plan_orders for select to authenticated
  using (user_id = auth.uid() or public.admin_has_permission('deals'));
-- لا سياسات إدراج/تعديل/حذف: كل الكتابة عبر الدوال (SECURITY DEFINER).

-- المعلن لا يقرأ أعمدة إدارية (admin_note/payment_ref/handled_*/بيانات payer_*) — كما فى ad_promotions.
revoke all on public.reel_plan_orders from anon, authenticated;
grant select (
  id, user_id, plan, extra_reels, price_egp, period_days, status, payment_method, payment_sender_name,
  payment_contact_phone, payment_submitted_at, paid_at, starts_at, ends_at, grace_ends_at, created_at, payer_note
) on public.reel_plan_orders to authenticated;

drop trigger if exists reel_plan_orders_sync_payer_note on public.reel_plan_orders;
create trigger reel_plan_orders_sync_payer_note
  before update on public.reel_plan_orders
  for each row execute function public.ad_orders_sync_payer_note();

create table if not exists public.reel_plan_notices (
  order_id uuid not null references public.reel_plan_orders(id) on delete cascade,
  milestone text not null,
  sent_at timestamptz not null default now(),
  primary key (order_id, milestone)
);
alter table public.reel_plan_notices enable row level security;
revoke all on public.reel_plan_notices from anon, authenticated;

-- ───────── الحساب ─────────
create or replace function public.count_kept_reels(p_uid uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::integer from public.properties where seller_id = p_uid and moderation_status <> 'rejected';
$$;

-- أفضل باقة سارية الآن (مدفوعة وفى شهرها أو فى فترة السماح).
create or replace function public.reel_plan_best(p_uid uuid)
returns table (order_id uuid, plan text, extra_reels integer, ends_at timestamptz, grace_ends_at timestamptz, state text)
language sql stable security definer set search_path = public
as $$
  select o.id, o.plan, o.extra_reels, o.ends_at, o.grace_ends_at,
         case when now() < o.ends_at then 'active' else 'grace' end
    from public.reel_plan_orders o
   where o.user_id = p_uid and o.status = 'active'
     and o.starts_at is not null and o.starts_at <= now()
     and o.grace_ends_at is not null and now() < o.grace_ends_at
   order by o.extra_reels desc, o.ends_at desc
   limit 1;
$$;

create or replace function public.reel_cap_for(p_uid uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select s.free_limit + coalesce((select b.extra_reels from public.reel_plan_best(p_uid) b), 0)
    from public.reel_plan_settings s where s.id = true;
$$;

-- منع نشر ريل جديد عند بلوغ الحد (من المعلن نفسه؛ الأدمن وخدمات النظام غير مقيَّدين).
create or replace function public.properties_enforce_reel_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> new.seller_id or public.admin_has_permission('reels') then
    return new;
  end if;
  if public.count_kept_reels(new.seller_id) >= public.reel_cap_for(new.seller_id) then
    raise exception 'reel_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists properties_enforce_reel_limit on public.properties;
create trigger properties_enforce_reel_limit
  before insert on public.properties
  for each row execute function public.properties_enforce_reel_limit();

-- ───────── الإشعارات ودورة الحياة ─────────
create or replace function public.reel_plan_emit_notices(p_uid uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.reel_plan_orders%rowtype;
  s public.reel_plan_settings%rowtype;
  v_milestone text;
  v_text text;
  v_end text;
  v_grace text;
  v_label text;
begin
  select * into s from public.reel_plan_settings where id = true;
  for r in
    select * from public.reel_plan_orders o
     where o.status = 'active' and o.user_id is not null and o.ends_at is not null and o.grace_ends_at is not null
       and (p_uid is null or o.user_id = p_uid)
  loop
    -- باقة جُدِّدت بطلب لاحق لنفس الباقة: لا نذكّر بالقديمة.
    if exists (
      select 1 from public.reel_plan_orders x
       where x.user_id = r.user_id and x.status = 'active' and x.id <> r.id and x.plan = r.plan and x.ends_at > r.ends_at
    ) then
      continue;
    end if;

    v_milestone := case
      when now() >= r.grace_ends_at then 'grace_end'
      when now() >= greatest(r.ends_at, r.grace_ends_at - interval '7 days') and now() >= r.ends_at and r.grace_ends_at > r.ends_at + interval '7 days' then 'grace7'
      when now() >= r.ends_at then 'end'
      when now() >= r.ends_at - interval '3 days' then 'pre3'
      when now() >= r.ends_at - interval '7 days' then 'pre7'
      else null
    end;
    continue when v_milestone is null;

    insert into public.reel_plan_notices (order_id, milestone) values (r.id, v_milestone)
    on conflict (order_id, milestone) do nothing;
    continue when not found;

    v_end := to_char(r.ends_at at time zone 'Africa/Cairo', 'YYYY-MM-DD');
    v_grace := to_char(r.grace_ends_at at time zone 'Africa/Cairo', 'YYYY-MM-DD');
    v_label := 'باقة الريلز (+' || r.extra_reels || ' ريل)';
    v_text := case v_milestone
      when 'pre7' then 'ينتهي اشتراك ' || v_label || ' بعد 7 أيام (' || v_end || '). جدّد الآن لضمان استمرار ظهور ريلزك الإضافية.'
      when 'pre3' then 'ينتهي اشتراك ' || v_label || ' بعد 3 أيام (' || v_end || '). جدّد الآن لضمان استمرار ظهور ريلزك الإضافية.'
      when 'end' then 'انتهى اليوم اشتراك ' || v_label || '. لديك فترة سماح حتى ' || v_grace || ' تستمر خلالها ريلزك الإضافية في الظهور — جدّد قبلها لتفادي إيقاف النشر.'
      when 'grace7' then 'تنتهي فترة سماح ' || v_label || ' بعد 7 أيام (' || v_grace || '). جدّد الآن حتى لا يُمنع نشر ريلز جديدة.'
      else 'انتهت فترة سماح ' || v_label || ': عاد حد الريلز إلى ' || s.free_limit || '، ولن تتمكن من نشر ريلز جديدة حتى تجدد الاشتراك أو تحذف ما يكفي من ريلزك. لم يُحذف أي ريل من ريلزك الحالية.'
    end;

    begin
      insert into public.notifications (recipient_id, actor_id, category, text)
      values (r.user_id, null, 'approval', v_text);
    exception when others then
      raise warning 'reel plan notice failed: %', sqlerrm;
    end;
  end loop;

  update public.reel_plan_orders
     set status = 'expired'
   where status = 'active' and grace_ends_at < now() and (p_uid is null or user_id = p_uid);
end;
$$;

create or replace function public.process_reel_plan_lifecycle()
returns void
language sql security definer set search_path = public
as $$ select public.reel_plan_emit_notices(null); $$;

revoke all on function public.reel_plan_emit_notices(uuid) from public, anon, authenticated;
revoke all on function public.process_reel_plan_lifecycle() from public, anon, authenticated;
grant execute on function public.process_reel_plan_lifecycle() to service_role;
revoke all on function public.count_kept_reels(uuid) from public, anon, authenticated;
revoke all on function public.reel_plan_best(uuid) from public, anon, authenticated;
revoke all on function public.reel_cap_for(uuid) from public, anon, authenticated;

-- ───────── للمعلن ─────────
create or replace function public.get_my_reel_quota()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s public.reel_plan_settings%rowtype;
  b record;
  v_used integer;
  v_extra integer;
  v_state text;
  v_pending record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  perform public.reel_plan_emit_notices(v_uid);

  select * into s from public.reel_plan_settings where id = true;
  select * into b from public.reel_plan_best(v_uid);
  v_used := public.count_kept_reels(v_uid);
  v_extra := coalesce(b.extra_reels, 0);
  v_state := case
    when b.order_id is not null then b.state
    when exists (select 1 from public.reel_plan_orders where user_id = v_uid and status in ('active', 'expired')) then 'lapsed'
    else 'none'
  end;
  select o.id, o.plan, o.status into v_pending
    from public.reel_plan_orders o
   where o.user_id = v_uid and o.status in ('pending_payment', 'submitted')
   order by o.created_at desc limit 1;

  return jsonb_build_object(
    'used', v_used,
    'free_limit', s.free_limit,
    'extra', v_extra,
    'cap', s.free_limit + v_extra,
    'can_publish', v_used < s.free_limit + v_extra,
    'state', v_state,
    'plan', b.plan,
    'ends_at', b.ends_at,
    'grace_ends_at', b.grace_ends_at,
    'pending_order', case when v_pending.id is null then null
                          else jsonb_build_object('id', v_pending.id, 'plan', v_pending.plan, 'status', v_pending.status) end
  );
end;
$$;
revoke all on function public.get_my_reel_quota() from public, anon;
grant execute on function public.get_my_reel_quota() to authenticated;

create or replace function public.create_reel_plan_order(p_plan text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s public.reel_plan_settings%rowtype;
  v_extra integer;
  v_price numeric;
  v_name text;
  v_phone text;
  v_email text;
  v_row public.reel_plan_orders%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_plan not in ('plan1', 'plan2') then
    raise exception 'bad_plan';
  end if;

  -- طلب مفتوح لنفس الباقة: نعيده (لا نكرّر).
  select * into v_row from public.reel_plan_orders
   where user_id = v_uid and plan = p_plan and status in ('pending_payment', 'submitted')
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('id', v_row.id, 'plan', v_row.plan, 'extra_reels', v_row.extra_reels,
                              'price_egp', v_row.price_egp, 'period_days', v_row.period_days, 'status', v_row.status);
  end if;

  select * into s from public.reel_plan_settings where id = true;
  if p_plan = 'plan1' then v_extra := s.plan1_extra; v_price := s.plan1_price_egp;
  else v_extra := s.plan2_extra; v_price := s.plan2_price_egp; end if;

  select p.full_name, p.phone_e164, u.email::text into v_name, v_phone, v_email
    from public.profiles p left join auth.users u on u.id = p.id where p.id = v_uid;

  insert into public.reel_plan_orders (user_id, payer_name, payer_phone, payer_email, plan, extra_reels, price_egp, period_days)
  values (v_uid, v_name, v_phone, v_email, p_plan, v_extra, v_price, s.period_days)
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'plan', v_row.plan, 'extra_reels', v_row.extra_reels,
                            'price_egp', v_row.price_egp, 'period_days', v_row.period_days, 'status', v_row.status);
end;
$$;
revoke all on function public.create_reel_plan_order(text) from public, anon;
grant execute on function public.create_reel_plan_order(text) to authenticated;

create or replace function public.confirm_reel_plan_payment(
  p_id uuid, p_method text, p_sender_name text, p_contact_phone text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.reel_plan_orders%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_sender_name, '')), '\s+', ' ', 'g');
  v_phone text := btrim(coalesce(p_contact_phone, ''));
  v_row public.reel_plan_orders%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_order from public.reel_plan_orders where id = p_id for update;
  if not found or v_order.user_id is distinct from v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_order.status not in ('pending_payment', 'submitted', 'rejected') then
    raise exception 'order_closed';
  end if;
  if p_method not in ('vodafone_cash', 'etisalat_cash', 'instapay') then
    raise exception 'bad_method';
  end if;
  if char_length(v_name) > 120 or coalesce(array_length(regexp_split_to_array(v_name, ' '), 1), 0) < 3 then
    raise exception 'bad_sender_name';
  end if;
  if char_length(regexp_replace(v_phone, '\D', '', 'g')) not between 7 and 15 or char_length(v_phone) > 30 then
    raise exception 'bad_contact_phone';
  end if;

  update public.reel_plan_orders
     set status = 'submitted', payment_method = p_method, payment_sender_name = v_name,
         payment_contact_phone = v_phone, payment_submitted_at = now()
   where id = p_id
   returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'payment_method', v_row.payment_method,
                            'payment_sender_name', v_row.payment_sender_name, 'payment_contact_phone', v_row.payment_contact_phone,
                            'payment_submitted_at', v_row.payment_submitted_at);
end;
$$;
revoke all on function public.confirm_reel_plan_payment(uuid, text, text, text) from public, anon;
grant execute on function public.confirm_reel_plan_payment(uuid, text, text, text) to authenticated;

create or replace function public.cancel_reel_plan_order(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.reel_plan_orders set status = 'cancelled'
   where id = p_id and user_id = v_uid and status = 'pending_payment';
  if not found then
    raise exception 'cannot_cancel';
  end if;
end;
$$;
revoke all on function public.cancel_reel_plan_order(uuid) from public, anon;
grant execute on function public.cancel_reel_plan_order(uuid) to authenticated;

-- ───────── الأدمن (صلاحية deals) ─────────
create or replace function public.admin_list_reel_plan_orders()
returns table (
  id uuid, user_id uuid, plan text, extra_reels integer, price_egp numeric, period_days integer, status text,
  payment_method text, payment_sender_name text, payment_contact_phone text, payment_submitted_at timestamptz,
  payment_ref text, admin_note text, paid_at timestamptz, starts_at timestamptz, ends_at timestamptz,
  grace_ends_at timestamptz, created_at timestamptz, payer_name text, payer_phone text, payer_email text, kept_reels integer
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.reel_plan_emit_notices(null);
  return query
    select o.id, o.user_id, o.plan, o.extra_reels, o.price_egp, o.period_days, o.status,
           o.payment_method, o.payment_sender_name, o.payment_contact_phone, o.payment_submitted_at,
           o.payment_ref, o.admin_note, o.paid_at, o.starts_at, o.ends_at, o.grace_ends_at, o.created_at,
           coalesce(p.full_name, o.payer_name), coalesce(p.phone_e164, o.payer_phone), coalesce(u.email::text, o.payer_email),
           case when o.user_id is null then 0 else public.count_kept_reels(o.user_id) end
      from public.reel_plan_orders o
      left join public.profiles p on p.id = o.user_id
      left join auth.users u on u.id = o.user_id
     order by o.created_at desc;
end;
$$;
revoke all on function public.admin_list_reel_plan_orders() from public, anon;
grant execute on function public.admin_list_reel_plan_orders() to authenticated;

-- «active» = تأكيد السداد وتفعيل الباقة لشهر (من الآن، أو من نهاية باقة سارية لنفس النوع عند التجديد)، ثم فترة السماح.
create or replace function public.admin_update_reel_plan_order(
  p_id uuid, p_status text, p_payment_ref text default null, p_admin_note text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.reel_plan_orders%rowtype;
  s public.reel_plan_settings%rowtype;
  v_prev_end timestamptz;
  v_start timestamptz;
  v_end timestamptz;
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('pending_payment', 'submitted', 'active', 'rejected', 'cancelled') then
    raise exception 'bad_status';
  end if;
  select * into v_order from public.reel_plan_orders where id = p_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  if p_status = 'active' then
    if v_order.user_id is null then
      raise exception 'user_unavailable';
    end if;
    if v_order.status = 'active' then
      update public.reel_plan_orders
         set payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
             admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
             handled_by = auth.uid(), handled_at = now()
       where id = p_id;
      return;
    end if;
    select * into s from public.reel_plan_settings where id = true;
    select max(x.ends_at) into v_prev_end from public.reel_plan_orders x
     where x.user_id = v_order.user_id and x.plan = v_order.plan and x.status = 'active' and x.ends_at > now() and x.id <> p_id;
    v_start := coalesce(v_prev_end, now());
    v_end := v_start + make_interval(days => v_order.period_days);
    update public.reel_plan_orders
       set status = 'active', paid_at = coalesce(paid_at, now()),
           starts_at = v_start, ends_at = v_end, grace_ends_at = v_end + make_interval(days => s.grace_days),
           payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
           admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
           handled_by = auth.uid(), handled_at = now()
     where id = p_id;
  else
    update public.reel_plan_orders
       set status = p_status,
           payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
           admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
           handled_by = auth.uid(), handled_at = now()
     where id = p_id;
  end if;
end;
$$;
revoke all on function public.admin_update_reel_plan_order(uuid, text, text, text) from public, anon;
grant execute on function public.admin_update_reel_plan_order(uuid, text, text, text) to authenticated;

-- إشعار المعلن عند تفعيل باقته.
create or replace function public.notify_reel_plan_activation()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  s public.reel_plan_settings%rowtype;
begin
  if NEW.status is distinct from 'active' or NEW.user_id is null then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.status is not distinct from 'active' then return NEW; end if;
  select * into s from public.reel_plan_settings where id = true;
  insert into public.notifications (recipient_id, actor_id, category, text)
  values (NEW.user_id, null, 'approval',
          'تم تفعيل باقة الريلز (+' || NEW.extra_reels || ' ريل) حتى ' || to_char(NEW.ends_at at time zone 'Africa/Cairo', 'YYYY-MM-DD')
          || '. أصبح حد ريلزك ' || (s.free_limit + NEW.extra_reels) || '.');
  return NEW;
exception when others then
  return NEW;
end;
$$;
revoke all on function public.notify_reel_plan_activation() from public, anon, authenticated;

drop trigger if exists trg_notify_reel_plan_activation on public.reel_plan_orders;
create trigger trg_notify_reel_plan_activation
  after update of status on public.reel_plan_orders
  for each row execute function public.notify_reel_plan_activation();

-- ---------------------------------------------------------------------
-- جدولة يومية (اختيارى — تتطلب امتداد pg_cron):
--   select cron.schedule('reel-plan-lifecycle', '0 8 * * *', $$ select public.process_reel_plan_lifecycle(); $$);
-- ---------------------------------------------------------------------
