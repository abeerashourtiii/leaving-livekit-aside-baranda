-- supabase/migrations/20261012000000_property_deals_and_rights.sql
--
-- نظام «الصفقات والرسوم» (سياسة البيع والرسوم): رسم ثابت (افتراضيًا 1000 جنيه) عند إتمام صفقة بيع أو تأجير،
-- يتحمله البائع/المؤجّر — أو الوسيط وحده لو الإعلان منشور من وسيط — ولا يتحمله المشتري/المستأجر أبدًا.
--
--  1) deal_settings    : صف واحد (قيمة الرسم، مهل الإخطار والسداد، تعليمات الدفع) يعدّلها الأدمن من لوحة التحكم.
--  2) property_deals   : سجل الصفقة المُبلَّغ عنها + حالة الرسم (reported → invoiced → paid | disputed | waived).
--  3) properties       : closed_at / closed_type (الإعلان المُغلق بصفقة يختفى عن الجميع ما عدا صاحبه والأدمن)
--                        + rights_declared_at (وقت إقرار ملكية الوسائط عند النشر، دليل عند أى نزاع حقوق نشر).
--  4) RPCs             : report_property_deal (الناشر)، admin_list_deals / admin_update_deal (الأدمن، صلاحية قسم «deals»).
--  5) music_tracks     : license_note (مصدر/مرجع ترخيص كل مقطع موسيقى، للأدمن فقط يُسجَّل ويُراجع).
--
-- ملاحظة أمان: لا يوجد INSERT/UPDATE مباشر على property_deals من العميل — كل التعديلات عبر الدوال فقط. وعمودا
-- closed_at/closed_type محميان بـ trigger فلا يغيّرهما إلا الدوال أو الأدمن (صلاحية deals).

-- ---------------------------------------------------------------------
-- 1) الإعدادات
-- ---------------------------------------------------------------------
create table if not exists public.deal_settings (
  id boolean primary key default true check (id),
  fee_egp numeric(10,2) not null default 1000 check (fee_egp >= 0),
  protection_days integer not null default 90 check (protection_days >= 0),
  notify_days integer not null default 7 check (notify_days >= 0),
  pay_days integer not null default 7 check (pay_days >= 0),
  payment_instructions text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.deal_settings (id) values (true) on conflict (id) do nothing;

alter table public.deal_settings enable row level security;

drop policy if exists "deal settings are readable" on public.deal_settings;
create policy "deal settings are readable"
  on public.deal_settings for select
  to authenticated
  using (true);

drop policy if exists "admins can update deal settings" on public.deal_settings;
create policy "admins can update deal settings"
  on public.deal_settings for update
  to authenticated
  using (public.admin_has_permission('deals'))
  with check (public.admin_has_permission('deals'));

-- ---------------------------------------------------------------------
-- 2) أعمدة جديدة على properties
-- ---------------------------------------------------------------------
alter table public.properties
  add column if not exists closed_at timestamptz,
  add column if not exists closed_type text check (closed_type in ('sold', 'rented')),
  add column if not exists rights_declared_at timestamptz;

comment on column public.properties.closed_at is
  'وقت إغلاق الإعلان بصفقة (تم البيع / تم التأجير). المُغلق يختفى عن الجميع ما عدا صاحبه والأدمن (سياسة RLS تحت).';
comment on column public.properties.rights_declared_at is
  'وقت إقرار الناشر عند النشر بأنه مالك حقوق الصور/الفيديو أو مرخَّص له وأنه لا توجد موسيقى/مقاطع مقتبسة (سياسة حقوق النشر).';

-- الإعلان المُغلق بصفقة لا يظهر لغير صاحبه والأدمن (يشمل البحث والخريطة لأن دوال البحث بصلاحية المستخدم).
drop policy if exists "approved properties are public, own listings always visible" on public.properties;
create policy "approved properties are public, own listings always visible"
  on public.properties for select
  to authenticated
  using (
    (moderation_status = 'approved' and closed_at is null)
    or seller_id = auth.uid()
    or public.admin_has_permission('reels')
    or public.admin_has_permission('deals')
  );

-- ---------------------------------------------------------------------
-- 3) سجل الصفقات
-- ---------------------------------------------------------------------
create table if not exists public.property_deals (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  -- نسخة من بيانات الإعلان وقت الإبلاغ (تبقى حتى لو حُذف الإعلان).
  property_title text not null default '',
  property_province text,
  payer_id uuid not null references public.profiles(id),
  payer_account_type text,
  deal_type text not null check (deal_type in ('sale', 'rent')),
  fee_egp numeric(10,2) not null,
  status text not null default 'reported'
    check (status in ('reported', 'invoiced', 'paid', 'disputed', 'waived')),
  reported_at timestamptz not null default now(),
  due_at timestamptz,
  paid_at timestamptz,
  payment_ref text,
  note text,
  admin_note text,
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz
);

-- صفقة واحدة فعّالة لكل إعلان (الملغاة waived لا تُحتسب، فيمكن إعادة الإبلاغ بعد إلغائها).
create unique index if not exists property_deals_one_active_per_property
  on public.property_deals (property_id)
  where property_id is not null and status <> 'waived';

create index if not exists property_deals_payer_idx on public.property_deals (payer_id);
create index if not exists property_deals_status_idx on public.property_deals (status, reported_at desc);

alter table public.property_deals enable row level security;

-- القراءة فقط: الناشر يرى صفقاته، والأدمن (deals) يرى الكل. لا سياسات INSERT/UPDATE/DELETE عن قصد.
drop policy if exists "payers read own deals, admins read all" on public.property_deals;
create policy "payers read own deals, admins read all"
  on public.property_deals for select
  to authenticated
  using (payer_id = auth.uid() or public.admin_has_permission('deals'));

-- ---------------------------------------------------------------------
-- 4) حماية عمودى الإغلاق من التعديل المباشر
-- ---------------------------------------------------------------------
create or replace function public.guard_property_closed_columns()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.closed_at is distinct from old.closed_at or new.closed_type is distinct from old.closed_type)
     and coalesce(current_setting('app.deal_rpc', true), '') <> 'on'
     and not public.admin_has_permission('deals') then
    raise exception 'closed_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists properties_guard_closed on public.properties;
create trigger properties_guard_closed
  before update of closed_at, closed_type on public.properties
  for each row execute function public.guard_property_closed_columns();

-- ---------------------------------------------------------------------
-- 5) الناشر: «تم البيع / تم التأجير»
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
  select account_type into v_type from public.profiles where id = v_uid;

  insert into public.property_deals (
    property_id, property_title, property_province, payer_id, payer_account_type,
    deal_type, fee_egp, due_at, note
  )
  values (
    p_property_id, coalesce(v_prop.short_title, v_prop.title, ''), v_prop.province, v_uid, v_type,
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
-- 6) الأدمن: قائمة الصفقات (مع بيانات التواصل للتحصيل) وتحديث الحالة
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
           d.payer_id, p.full_name, p.phone_e164, u.email::text, coalesce(d.payer_account_type, p.account_type)
      from public.property_deals d
      left join public.profiles p on p.id = d.payer_id
      left join auth.users u on u.id = d.payer_id
     order by d.reported_at desc;
end;
$$;

revoke all on function public.admin_list_deals() from public;
grant execute on function public.admin_list_deals() to authenticated;

create or replace function public.admin_update_deal(
  p_id uuid,
  p_status text,
  p_payment_ref text default null,
  p_admin_note text default null,
  p_reopen boolean default false
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_deal public.property_deals%rowtype;
  v_pay_days integer;
begin
  if not public.admin_has_permission('deals') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('reported', 'invoiced', 'paid', 'disputed', 'waived') then
    raise exception 'bad_status';
  end if;

  select * into v_deal from public.property_deals where id = p_id for update;
  if not found then
    raise exception 'deal_not_found';
  end if;
  select coalesce(pay_days, 7) into v_pay_days from public.deal_settings where id = true;

  update public.property_deals
     set status = p_status,
         paid_at = case when p_status = 'paid' then coalesce(paid_at, now()) else null end,
         due_at = case when p_status = 'invoiced' then now() + make_interval(days => coalesce(v_pay_days, 7)) else due_at end,
         payment_ref = coalesce(nullif(p_payment_ref, ''), payment_ref),
         admin_note = coalesce(nullif(p_admin_note, ''), admin_note),
         handled_by = auth.uid(),
         handled_at = now()
   where id = p_id;

  -- إلغاء الصفقة (مثلًا أُبلغ عنها بالخطأ) مع إعادة فتح الإعلان.
  if p_status = 'waived' and p_reopen and v_deal.property_id is not null then
    perform set_config('app.deal_rpc', 'on', true);
    update public.properties set closed_at = null, closed_type = null where id = v_deal.property_id;
  end if;
end;
$$;

revoke all on function public.admin_update_deal(uuid, text, text, text, boolean) from public;
grant execute on function public.admin_update_deal(uuid, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 7) ترخيص الموسيقى: مصدر/مرجع الترخيص لكل مقطع (يُسجِّله الأدمن عند الإضافة)
-- ---------------------------------------------------------------------
alter table public.music_tracks
  add column if not exists license_note text;

comment on column public.music_tracks.license_note is
  'مصدر الموسيقى ومرجع إثبات الترخيص (مثلًا: Stable Audio — خطة Pro — تاريخ التوليد — اسم ملف الإثبات فى docs/licenses). مطلوب لكل مقطع غير مدمج.';
