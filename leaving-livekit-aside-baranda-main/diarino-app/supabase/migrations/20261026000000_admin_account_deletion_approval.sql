-- supabase/migrations/20261026000000_admin_account_deletion_approval.sql
--
-- حذف حساب أى مشرف (أدمن) لا يتم إلا بموافقة المشرف الأعلى (السوبر أدمن):
--  • المشرف العادى لا يستطيع حذف حسابه مباشرة: delete_my_account() ترفض بخطأ admin_requires_super_admin_approval،
--    ويرسل بدلها «طلب حذف» عبر request_admin_account_deletion() فيظهر للسوبر أدمن (لوحة التحكم ← المشرفون).
--  • السوبر أدمن فقط يوافق admin_approve_account_deletion() (فيُحذف الحساب فعليًا) أو يرفض admin_reject_account_deletion().
--  • المشرف يستطيع سحب طلبه المعلّق cancel_admin_account_deletion_request().
--  • حساب السوبر أدمن نفسه ما زال لا يُحذف قبل نقل الصلاحية (super_admin_cannot_delete — كما كان).
--  • الموافقة تُسجَّل فى سجل تدقيق الأدمن admin_audit_log، وتُراجَع الرسوم المستحقة وقت الموافقة أيضًا (has_open_fees).

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_name text,
  user_email text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decision_note text
);

-- طلب معلّق واحد فقط لكل مستخدم.
create unique index if not exists account_deletion_requests_one_pending_idx
  on public.account_deletion_requests(user_id) where status = 'pending';
create index if not exists account_deletion_requests_status_idx
  on public.account_deletion_requests(status, requested_at desc);

alter table public.account_deletion_requests enable row level security;

drop policy if exists "owner or super admin reads deletion requests" on public.account_deletion_requests;
create policy "owner or super admin reads deletion requests"
  on public.account_deletion_requests for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin_user());

-- لا سياسات كتابة للعملاء عن قصد: الكتابة فقط من الدوال SECURITY DEFINER أدناه.
revoke insert, update, delete on public.account_deletion_requests from anon, authenticated;

-- ---------------------------------------------------------------------
-- 1) delete_my_account: ترفض المشرفين (يلزم طلب موافقة السوبر أدمن)
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

  -- المشرف الأعلى: لازم ينقل الصلاحية أولًا.
  if exists (select 1 from public.user_roles where user_id = v_uid and is_super_admin) then
    raise exception 'super_admin_cannot_delete';
  end if;

  -- أى مشرف آخر: لا حذف مباشر — يلزم طلب وموافقة السوبر أدمن.
  if exists (select 1 from public.user_roles where user_id = v_uid and role = 'admin') then
    raise exception 'admin_requires_super_admin_approval';
  end if;

  -- رسوم مستحقة لم تُسدَّد: لا حذف قبل التسوية (سياسة البيع والرسوم).
  if exists (
    select 1 from public.property_deals
     where payer_id = v_uid and status in ('reported', 'invoiced', 'disputed')
  ) then
    raise exception 'has_open_fees';
  end if;

  perform set_config('app.account_deletion', 'on', true);
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------
-- 2) طلب حذف حساب مشرف
-- ---------------------------------------------------------------------
create or replace function public.request_admin_account_deletion()
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_email text;
  v_id uuid;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_roles where user_id = v_uid and is_super_admin) then
    raise exception 'super_admin_cannot_delete';
  end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'admin') then
    raise exception 'not_admin';
  end if;
  if exists (
    select 1 from public.property_deals
     where payer_id = v_uid and status in ('reported', 'invoiced', 'disputed')
  ) then
    raise exception 'has_open_fees';
  end if;

  select id into v_id from public.account_deletion_requests where user_id = v_uid and status = 'pending';
  if found then
    return v_id; -- طلب معلّق بالفعل
  end if;

  select p.full_name, u.email::text into v_name, v_email
    from public.profiles p left join auth.users u on u.id = p.id
   where p.id = v_uid;

  insert into public.account_deletion_requests (user_id, user_name, user_email)
  values (v_uid, v_name, v_email)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.request_admin_account_deletion() from public;
grant execute on function public.request_admin_account_deletion() to authenticated;

create or replace function public.cancel_admin_account_deletion_request()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  update public.account_deletion_requests
     set status = 'cancelled', decided_at = now()
   where user_id = auth.uid() and status = 'pending';
end;
$$;

revoke all on function public.cancel_admin_account_deletion_request() from public;
grant execute on function public.cancel_admin_account_deletion_request() to authenticated;

-- ---------------------------------------------------------------------
-- 3) موافقة / رفض السوبر أدمن
-- ---------------------------------------------------------------------
create or replace function public.admin_approve_account_deletion(p_request_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_req public.account_deletion_requests%rowtype;
  v_actor_name text;
begin
  if auth.uid() is null or not public.is_super_admin_user() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_req from public.account_deletion_requests where id = p_request_id for update;
  if not found or v_req.status <> 'pending' or v_req.user_id is null then
    raise exception 'request_not_found';
  end if;

  if exists (select 1 from public.user_roles where user_id = v_req.user_id and is_super_admin) then
    raise exception 'super_admin_cannot_delete';
  end if;
  if exists (
    select 1 from public.property_deals
     where payer_id = v_req.user_id and status in ('reported', 'invoiced', 'disputed')
  ) then
    raise exception 'has_open_fees';
  end if;

  select full_name into v_actor_name from public.profiles where id = auth.uid();

  update public.account_deletion_requests
     set status = 'approved', decided_at = now(), decided_by = auth.uid()
   where id = v_req.id;

  insert into public.admin_audit_log (actor_id, actor_name, action, target_table, target_id, before, after)
  values (auth.uid(), v_actor_name, 'admin_account_deletion_approved', 'account_deletion_requests', v_req.user_id,
          to_jsonb(v_req), jsonb_build_object('status', 'approved'));

  perform set_config('app.account_deletion', 'on', true);
  delete from auth.users where id = v_req.user_id;
end;
$$;

revoke all on function public.admin_approve_account_deletion(uuid) from public;
grant execute on function public.admin_approve_account_deletion(uuid) to authenticated;

create or replace function public.admin_reject_account_deletion(p_request_id uuid, p_note text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_req public.account_deletion_requests%rowtype;
  v_actor_name text;
begin
  if auth.uid() is null or not public.is_super_admin_user() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_req from public.account_deletion_requests where id = p_request_id for update;
  if not found or v_req.status <> 'pending' then
    raise exception 'request_not_found';
  end if;

  select full_name into v_actor_name from public.profiles where id = auth.uid();

  update public.account_deletion_requests
     set status = 'rejected', decided_at = now(), decided_by = auth.uid(),
         decision_note = nullif(left(coalesce(p_note, ''), 500), '')
   where id = v_req.id;

  insert into public.admin_audit_log (actor_id, actor_name, action, target_table, target_id, before, after)
  values (auth.uid(), v_actor_name, 'admin_account_deletion_rejected', 'account_deletion_requests', v_req.user_id,
          to_jsonb(v_req), jsonb_build_object('status', 'rejected'));
end;
$$;

revoke all on function public.admin_reject_account_deletion(uuid, text) from public;
grant execute on function public.admin_reject_account_deletion(uuid, text) to authenticated;
