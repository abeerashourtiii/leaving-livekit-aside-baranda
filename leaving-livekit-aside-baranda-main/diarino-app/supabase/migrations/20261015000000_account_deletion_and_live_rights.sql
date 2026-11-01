-- supabase/migrations/20261015000000_account_deletion_and_live_rights.sql
--
--  1) حذف الحساب من داخل التطبيق (شرط App Store 5.1.1(v) وGoogle Play): الدالة public.delete_my_account().
--     • تحذف المستخدم من auth.users فتنتشر الحذفات (cascade) إلى كل بياناته: الملف الشخصى، الإعلانات، التعليقات، المفضلة،
--       المحادثات، الإشعارات، رموز الإشعارات... (تم فحص كل علاقات المفاتيح الأجنبية: الوحيدة التى كانت تمنع الحذف
--       property_deals.payer_id، وتُصلَح هنا).
--     • تُرفض (exception) لو عليه رسوم مستحقة (has_open_fees) أو كان المشرف الأعلى (super_admin_cannot_delete).
--  2) سجل الصفقات يبقى بعد حذف الحساب لأغراض المحاسبة/النزاعات (سياسة الخصوصية: «ما يلزم الاحتفاظ به قانونًا»):
--     payer_id يصبح on delete set null، ونسخة من الاسم/الهاتف/البريد وقت الإبلاغ (payer_name/phone/email).
--  3) إقرار ملكية الحقوق للبث المباشر: lives.rights_declared_at.
--  4) إصلاح log_admin_change كى لا يمنع حذف الحساب (انظر القسم 4).

-- ---------------------------------------------------------------------
-- 1) property_deals: لا تمنع حذف الحساب + نسخة بيانات الدافع
-- ---------------------------------------------------------------------
alter table public.property_deals
  add column if not exists payer_name text,
  add column if not exists payer_phone text,
  add column if not exists payer_email text;

update public.property_deals d
   set payer_name = coalesce(d.payer_name, p.full_name),
       payer_phone = coalesce(d.payer_phone, p.phone_e164),
       payer_email = coalesce(d.payer_email, u.email::text)
  from public.profiles p
  left join auth.users u on u.id = p.id
 where p.id = d.payer_id
   and (d.payer_name is null or d.payer_phone is null or d.payer_email is null);

alter table public.property_deals alter column payer_id drop not null;
alter table public.property_deals drop constraint if exists property_deals_payer_id_fkey;
alter table public.property_deals
  add constraint property_deals_payer_id_fkey
  foreign key (payer_id) references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2) report_property_deal: يسجّل نسخة بيانات الدافع (نفس منطق 20261012000000 + النسخة)
-- ---------------------------------------------------------------------
create or replace function public.report_property_deal(
  p_property_id uuid,
  p_deal_type text,
  p_note text default null
)
returns public.property_deals
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prop public.properties%rowtype;
  v_set public.deal_settings%rowtype;
  v_type text;
  v_name text;
  v_phone text;
  v_email text;
  v_row public.property_deals%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_prop from public.properties where id = p_property_id for update;
  if not found or v_prop.seller_id <> v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if p_deal_type not in ('sale', 'rent') or p_deal_type <> v_prop.purpose then
    raise exception 'type_mismatch';
  end if;

  if exists (
    select 1 from public.property_deals
    where property_id = p_property_id and status <> 'waived'
  ) then
    raise exception 'already_reported';
  end if;

  select * into v_set from public.deal_settings where id = true;
  select p.account_type, p.full_name, p.phone_e164, u.email::text
    into v_type, v_name, v_phone, v_email
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = v_uid;

  insert into public.property_deals (
    property_id, property_title, property_province, payer_id, payer_account_type,
    payer_name, payer_phone, payer_email,
    deal_type, fee_egp, due_at, note
  )
  values (
    p_property_id, coalesce(v_prop.short_title, v_prop.title, ''), v_prop.province, v_uid, v_type,
    v_name, v_phone, v_email,
    p_deal_type, coalesce(v_set.fee_egp, 1000),
    now() + make_interval(days => coalesce(v_set.pay_days, 7)),
    nullif(left(coalesce(p_note, ''), 500), '')
  )
  returning * into v_row;

  perform set_config('app.deal_rpc', 'on', true);
  update public.properties
     set closed_at = now(),
         closed_type = case when p_deal_type = 'sale' then 'sold' else 'rented' end,
         pinned = false,
         pinned_at = null
   where id = p_property_id;

  return v_row;
end;
$$;

revoke all on function public.report_property_deal(uuid, text, text) from public;
grant execute on function public.report_property_deal(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3) admin_list_deals: يعتمد على النسخة (يعمل حتى بعد حذف حساب الدافع)
-- ---------------------------------------------------------------------
create or replace function public.admin_list_deals()
returns table (
  id uuid,
  property_id uuid,
  property_title text,
  property_province text,
  deal_type text,
  fee_egp numeric,
  status text,
  reported_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  payment_ref text,
  note text,
  admin_note text,
  payer_id uuid,
  payer_name text,
  payer_phone text,
  payer_email text,
  payer_account_type text
)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select d.id, d.property_id, d.property_title, d.property_province, d.deal_type, d.fee_egp, d.status,
           d.reported_at, d.due_at, d.paid_at, d.payment_ref, d.note, d.admin_note,
           d.payer_id,
           coalesce(p.full_name, d.payer_name),
           coalesce(p.phone_e164, d.payer_phone),
           coalesce(u.email::text, d.payer_email),
           coalesce(d.payer_account_type, p.account_type)
      from public.property_deals d
      left join public.profiles p on p.id = d.payer_id
      left join auth.users u on u.id = d.payer_id
     order by d.reported_at desc;
end;
$$;

revoke all on function public.admin_list_deals() from public;
grant execute on function public.admin_list_deals() to authenticated;

-- ---------------------------------------------------------------------
-- 4) سجل التدقيق لا يمنع حذف الحساب
--    كان trigger log_admin_change (حذف العقارات/البثوث/...) يكتب actor_id = المستخدم الجارى حذفه، وصف الملف الشخصى يكون
--    اتحذف فى نفس الـ cascade فيفشل الحذف بخطأ FK. الإصلاح: (أ) لا نسجّل حذفات الـ cascade الناتجة عن حذف الحساب لأنها ليست
--    إجراءً إداريًا، (ب) لو الملف الشخصى للفاعل غير موجود نسجّل actor_id = null بدل الفشل. باقى سلوك الدالة كما هو.
-- ---------------------------------------------------------------------
create or replace function public.log_admin_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  actor_name text;
  actor uuid;
  act text;
begin
  if coalesce(current_setting('app.account_deletion', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select id, full_name into actor, actor_name from public.profiles where id = auth.uid();

  if tg_op = 'DELETE' then
    act := tg_argv[0] || '_delete';
    insert into public.admin_audit_log (actor_id, actor_name, action, target_table, target_id, before, after)
    values (actor, actor_name, act, tg_table_name, old.id, to_jsonb(old), null);
    return old;
  else
    act := tg_argv[0] || '_update';
    insert into public.admin_audit_log (actor_id, actor_name, action, target_table, target_id, before, after)
    values (actor, actor_name, act, tg_table_name, new.id, to_jsonb(old), to_jsonb(new));
    return new;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) حذف الحساب
-- ---------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- رسوم مستحقة لم تُسدَّد: لا حذف قبل التسوية (سياسة البيع والرسوم).
  if exists (
    select 1 from public.property_deals
     where payer_id = v_uid and status in ('reported', 'invoiced', 'disputed')
  ) then
    raise exception 'has_open_fees';
  end if;

  -- المشرف الأعلى الوحيد: حذفه يقفل لوحة الإدارة. لازم تُنقل الصلاحية أولًا.
  if exists (select 1 from public.user_roles where user_id = v_uid and is_super_admin) then
    raise exception 'super_admin_cannot_delete';
  end if;

  -- الحذف من auth.users ينتشر (cascade) إلى profiles وكل جداول المستخدم (ومعه نتجاوز سجل التدقيق — راجع log_admin_change).
  perform set_config('app.account_deletion', 'on', true);
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------
-- 6) إقرار الحقوق للبث المباشر
-- ---------------------------------------------------------------------
alter table public.lives
  add column if not exists rights_declared_at timestamptz;

comment on column public.lives.rights_declared_at is
  'وقت إقرار المذيع قبل البث بأنه مالك/مرخَّص له بكل ما سيبثّه (موسيقى/فيديو) وأنه أبلغ الحاضرين بالتسجيل (سياسة حقوق النشر).';
