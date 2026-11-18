-- supabase/migrations/20261025000000_admin_role_management.sql
--
-- إصلاح «تعذر تغيير الدور» عند ترقية مستخدم إلى أدمن (لوحة التحكم ← المستخدمون):
--  • كانت الترقية/الإلغاء بتتم بـ INSERT/DELETE مباشر على user_roles من التطبيق، وسياسات user_roles (20260807) بتسأل عن user_roles
--    جوه نفسها (self-referencing RLS) — وده بيعمل خطأ «infinite recursion detected in policy» أو بيرفض الكتابة حسب حالة قاعدة البيانات،
--    والتطبيق كان بيخفى سبب الخطأ فيظهر فقط «تعذر تغيير الدور».
--  • الحل: دالة SECURITY DEFINER واحدة admin_set_admin_role (للمشرف الأعلى فقط) بتتحقق وبترجّع أسباب واضحة (forbidden / user_not_found /
--    user_not_eligible / cannot_demote_super_admin)، وبدّلنا سياسات user_roles الذاتية المرجع بسياسات تعتمد على دوال is_super_admin_user()
--    و is_admin_user() (بدون تكرار ذاتى) فتشتغل القراءة والكتابة المباشرة كذلك.
--  • صلاحية الترقية تبقى للمشرف الأعلى فقط (نفس القاعدة السابقة) وتُسجَّل فى سجل النشاط تلقائيًا بالـ trigger الموجود.

create or replace function public.is_super_admin_user()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and is_super_admin = true);
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;

revoke all on function public.is_super_admin_user() from public;
revoke all on function public.is_admin_user() from public;
grant execute on function public.is_super_admin_user() to authenticated;
grant execute on function public.is_admin_user() to authenticated;

drop policy if exists "super admin can grant admin access" on public.user_roles;
create policy "super admin can grant admin access"
  on public.user_roles for insert to authenticated
  with check (public.is_super_admin_user());

drop policy if exists "super admin can update admin permissions" on public.user_roles;
create policy "super admin can update admin permissions"
  on public.user_roles for update to authenticated
  using (public.is_super_admin_user())
  with check (public.is_super_admin_user());

drop policy if exists "super admin can revoke admin access" on public.user_roles;
create policy "super admin can revoke admin access"
  on public.user_roles for delete to authenticated
  using (public.is_super_admin_user());

drop policy if exists "admins can read all admin role rows" on public.user_roles;
create policy "admins can read all admin role rows"
  on public.user_roles for select to authenticated
  using (public.is_admin_user());

create or replace function public.admin_set_admin_role(
  p_user_id uuid,
  p_make_admin boolean,
  p_full_access boolean default true,
  p_permissions text[] default '{}'
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_anon boolean;
begin
  if auth.uid() is null or not public.is_super_admin_user() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'user_not_found';
  end if;

  if p_make_admin then
    select coalesce(u.is_anonymous, false) into v_anon from auth.users u where u.id = p_user_id;
    if not found or not exists (select 1 from public.profiles where id = p_user_id) then
      raise exception 'user_not_found';
    end if;
    if v_anon then
      raise exception 'user_not_eligible';
    end if;
    if exists (select 1 from public.user_roles where user_id = p_user_id and role = 'admin') then
      return; -- أدمن بالفعل
    end if;
    insert into public.user_roles (user_id, role, is_super_admin, full_access, permissions)
    values (p_user_id, 'admin', false, coalesce(p_full_access, true), case when coalesce(p_full_access, true) then '{}' else coalesce(p_permissions, '{}') end);
  else
    if exists (select 1 from public.user_roles where user_id = p_user_id and is_super_admin = true) then
      raise exception 'cannot_demote_super_admin';
    end if;
    delete from public.user_roles where user_id = p_user_id and role = 'admin';
  end if;
end;
$$;

revoke all on function public.admin_set_admin_role(uuid, boolean, boolean, text[]) from public;
grant execute on function public.admin_set_admin_role(uuid, boolean, boolean, text[]) to authenticated;
