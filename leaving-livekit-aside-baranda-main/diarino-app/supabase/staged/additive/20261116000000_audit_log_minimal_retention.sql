-- M1) سجل التدقيق: لقطة مصغّرة بدل الصف الكامل + تسجيل ما يفعله أدمن فقط + احتفاظ 12 شهرًا + إخفاء هوية حسابات محذوفة.
--  • audit_minimal_snapshot: إسقاط أعمدة مسموحة فقط (معرّف/عنوان/حالة/مالك…)، فلا يُحفظ نص رسائل الدعم ولا المقترحات ولا بيانات شخصية.
--  • trigger قبل الإدراج على admin_audit_log يطبّق الإسقاط على *كل* الكتّاب (الـ triggers ودوال الموافقة على حذف الحساب…).
--  • log_admin_change: لا يسجّل حذف المالك لإعلانه/بثه، ولا حذف الـ cascade لحذف الحساب، ولا عمليات الخدمة/المهام الدورية، ولا من ليس لديه صلاحية القسم.
--  • مهمة يومية (pg_cron): حذف ما يزيد عن 12 شهرًا، وإخفاء actor_name والمعرّفات العائدة لحسابات لم تعد موجودة.
-- قابل لإعادة التشغيل. لا يعدّل أى migration قديم.

-- 1) الإسقاط المسموح.
create or replace function public.audit_minimal_snapshot(p jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p is null then null
    else coalesce(
      (select jsonb_object_agg(e.key, e.value)
         from jsonb_each(p) as e(key, value)
        where e.key = any (array[
          'id', 'key', 'title', 'status', 'moderation_status',
          'seller_id', 'host_id', 'owner_id', 'user_id', 'payer_id',
          'active', 'enabled', 'action_type', 'size', 'sort_order',
          'placement', 'rotation_mode', 'duration_ms', 'target_type', 'target_id'
        ])),
      '{}'::jsonb)
  end;
$$;

create or replace function public.admin_audit_log_minimize()
returns trigger
language plpgsql
as $$
begin
  new.before := public.audit_minimal_snapshot(new.before);
  new.after := public.audit_minimal_snapshot(new.after);
  return new;
end;
$$;
drop trigger if exists admin_audit_log_minimize on public.admin_audit_log;
create trigger admin_audit_log_minimize
  before insert on public.admin_audit_log
  for each row execute function public.admin_audit_log_minimize();

-- تقليص السجلات الموجودة (نصوص رسائل/مقترحات/صفوف كاملة سابقة).
update public.admin_audit_log
   set before = public.audit_minimal_snapshot(before),
       after = public.audit_minimal_snapshot(after)
 where before is not null or after is not null;

-- 2) log_admin_change: تسجيل ما فعله أدمن فقط.
create or replace function public.log_admin_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_perm text;
  v_old jsonb;
  v_new jsonb;
  v_act text;
begin
  -- عمليات الخدمة/المهام الدورية/الـ cascade الناتج عن حذف حساب ليست إجراءً إداريًا.
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if coalesce(current_setting('app.account_deletion', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_perm := case tg_table_name
    when 'properties' then 'reels'
    when 'lives' then 'lives'
    when 'ad_banners' then 'ads'
    when 'sponsored_reels' then 'sponsoredReels'
    when 'menu_items' then 'menuItems'
    when 'suggestions' then 'reports'
    when 'support_messages' then 'reports'
    else null
  end;

  -- من ليس أدمن لهذا القسم (مثل المالك يحذف إعلانه) لا يُسجَّل.
  if v_perm is not null and not public.admin_has_permission(v_perm) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) else null end;

  -- حتى لو كان الفاعل أدمنًا: حذفه لإعلانه/بثه هو نفسه ليس إجراءً إداريًا.
  if tg_op = 'DELETE'
     and coalesce(v_old ->> 'seller_id', v_old ->> 'host_id') = auth.uid()::text then
    return old;
  end if;

  select id, full_name into v_actor, v_actor_name from public.profiles where id = auth.uid();

  v_act := tg_argv[0] || case tg_op when 'DELETE' then '_delete' when 'INSERT' then '_insert' else '_update' end;
  insert into public.admin_audit_log (actor_id, actor_name, action, target_table, target_id, before, after)
  values (v_actor, v_actor_name, v_act, tg_table_name,
          coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid), v_old, v_new);

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- نسخة بلا id (feature_flags / ad_carousel_settings): تخطّى عمليات الخدمة فقط (بياناتها إعدادات لا شخصية).
create or replace function public.log_admin_change_no_id()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_act text;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select id, full_name into v_actor, v_actor_name from public.profiles where id = auth.uid();
  if tg_op = 'DELETE' then
    v_act := tg_argv[0] || '_delete';
    insert into public.admin_audit_log (actor_id, actor_name, action, target_table, target_id, before, after)
    values (v_actor, v_actor_name, v_act, tg_table_name, null, to_jsonb(old), null);
    return old;
  else
    v_act := tg_argv[0] || '_update';
    insert into public.admin_audit_log (actor_id, actor_name, action, target_table, target_id, before, after)
    values (v_actor, v_actor_name, v_act, tg_table_name, null, to_jsonb(old), to_jsonb(new));
    return new;
  end if;
end;
$$;

-- 3) الاحتفاظ (12 شهرًا) + إخفاء هوية الحسابات المحذوفة.
create or replace function public.purge_old_admin_audit()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_deleted integer;
  k text;
begin
  delete from public.admin_audit_log where created_at < now() - interval '12 months';
  get diagnostics v_deleted = row_count;

  -- الفاعل حسابه محذوف (actor_id صار null بسبب on delete set null): نخفى الاسم.
  update public.admin_audit_log set actor_name = null where actor_id is null and actor_name is not null;

  -- معرّفات أصحاب الصفوف العائدة لحسابات لم تعد موجودة.
  foreach k in array array['seller_id', 'host_id', 'owner_id', 'user_id', 'payer_id'] loop
    update public.admin_audit_log a
       set before = case when a.before ? k and not exists (select 1 from public.profiles p where p.id::text = a.before ->> k) then a.before - k else a.before end,
           after = case when a.after ? k and not exists (select 1 from public.profiles p where p.id::text = a.after ->> k) then a.after - k else a.after end
     where (a.before ? k and not exists (select 1 from public.profiles p where p.id::text = a.before ->> k))
        or (a.after ? k and not exists (select 1 from public.profiles p where p.id::text = a.after ->> k));
  end loop;
  update public.admin_audit_log a
     set target_id = null
   where a.target_table = 'account_deletion_requests' and a.target_id is not null
     and not exists (select 1 from public.profiles p where p.id = a.target_id);

  -- سجل نشاط المستخدمين: اسم صاحب حساب محذوف.
  update public.user_activity_log set user_name = null where user_id is null and user_name is not null;

  return v_deleted;
end;
$$;
revoke all on function public.purge_old_admin_audit() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron with schema extensions;
  perform cron.schedule('purge-admin-audit', '17 3 * * *', $job$select public.purge_old_admin_audit()$job$);
exception when others then
  raise notice 'pg_cron غير متاح (%): شغّل select public.purge_old_admin_audit(); دوريًا يدويًا أو فعّل pg_cron من Dashboard → Extensions.', sqlerrm;
end $$;

notify pgrst, 'reload schema';
