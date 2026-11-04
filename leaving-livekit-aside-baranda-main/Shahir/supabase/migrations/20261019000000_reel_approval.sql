-- supabase/migrations/20261019000000_reel_approval.sql
--
-- موافقة الأدمن على الريلز/الإعلانات **قبل** نشرها للعامة (مع إمكانية تعطيل ذلك من لوحة الأدمن):
--
--  1) moderation_settings.require_reel_approval : مفتاح التشغيل/التعطيل (الافتراضى: مفعَّل). الأدمن بصلاحية «reels» يغيّره.
--  2) trigger قبل الإدراج : الإعلان الجديد = 'pending' لو الموافقة مطلوبة (وصاحبه مش أدمن)، وإلا 'approved' فورًا.
--                            الخادم هو اللى يحدد (العميل ما بيقدرش يبعت approved لنفسه).
--  3) trigger قبل التعديل : غير الأدمن لا يغيّر moderation_status/السبب (يمنع اعتماد إعلانك بنفسك). وتعديل المالك لمحتوى إعلان
--                            معتمد (عنوان/وصف/وسائط/موسيقى) يرجّعه 'pending' لو الموافقة مفعَّلة، وتعديله لإعلان مرفوض يرجّعه 'pending' دائمًا.
--  4) إشعار للمعلن عند قرار الأدمن (category = 'approval'): تمت الموافقة / تم الرفض (+ السبب).
--  5) admin_delete_reel() : حذف الأدمن لإعلان غير مناسب مع سبب اختيارى وإشعار للمعلن (الإشعار بدون property_id لأن الإعلان بيتحذف).
--
-- الإخفاء عن العامة منفَّذ أصلًا فى سياسة RLS (approved أو صاحبه أو الأدمن) — لم تتغير. وسياسات الأدمن للتعديل والحذف موجودة
-- (admins can update/delete any property).

-- ---------------------------------------------------------------------
-- 1) الإعدادات
-- ---------------------------------------------------------------------
create table if not exists public.moderation_settings (
  id boolean primary key default true check (id),
  require_reel_approval boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.moderation_settings (id) values (true) on conflict (id) do nothing;

alter table public.moderation_settings enable row level security;

drop policy if exists "moderation settings are readable" on public.moderation_settings;
create policy "moderation settings are readable"
  on public.moderation_settings for select
  to authenticated
  using (true);

drop policy if exists "reel admins update moderation settings" on public.moderation_settings;
create policy "reel admins update moderation settings"
  on public.moderation_settings for update
  to authenticated
  using (public.admin_has_permission('reels'))
  with check (public.admin_has_permission('reels'));

-- ---------------------------------------------------------------------
-- 2) أعمدة جديدة
-- ---------------------------------------------------------------------
alter table public.properties
  add column if not exists moderation_reason text,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by uuid references auth.users(id) on delete set null;

comment on column public.properties.moderation_reason is 'سبب الرفض (يكتبه الأدمن) ويظهر للمعلن على كارت إعلانه.';

-- تصنيف إشعار جديد: قرارات المراجعة
alter table public.notifications drop constraint if exists notifications_category_check;
alter table public.notifications add constraint notifications_category_check
  check (category in ('like', 'save', 'follow', 'chat', 'new_match', 'price_drop', 'comment', 'offer', 'approval'));

-- ---------------------------------------------------------------------
-- 3) قبل الإدراج: الخادم يحدد حالة الإعلان الجديد
-- ---------------------------------------------------------------------
create or replace function public.properties_moderation_before_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_required boolean;
begin
  select require_reel_approval into v_required from public.moderation_settings where id = true;

  -- بدون مستخدم (service role / سكربتات / seed) أو أدمن بصلاحية reels: ينشر فورًا. غير كده: حسب الإعداد.
  if auth.uid() is null or public.admin_has_permission('reels') or not coalesce(v_required, true) then
    new.moderation_status := 'approved';
  else
    new.moderation_status := 'pending';
  end if;
  new.moderation_reason := null;
  new.moderated_at := null;
  new.moderated_by := null;
  return new;
end;
$$;

drop trigger if exists properties_moderation_before_insert on public.properties;
create trigger properties_moderation_before_insert
  before insert on public.properties
  for each row execute function public.properties_moderation_before_insert();

-- ---------------------------------------------------------------------
-- 4) قبل التعديل: حماية الحالة + إعادة المراجعة عند تعديل المحتوى
-- ---------------------------------------------------------------------
create or replace function public.properties_moderation_before_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_required boolean;
  v_admin boolean := public.admin_has_permission('reels');
  v_owner boolean := auth.uid() is not null and auth.uid() = old.seller_id;
begin
  if auth.uid() is not null and not v_admin then
    -- مستخدم عادى: لا يغيّر الحالة ولا السبب يدويًا.
    new.moderation_status := old.moderation_status;
    new.moderation_reason := old.moderation_reason;
    new.moderated_at := old.moderated_at;
    new.moderated_by := old.moderated_by;

    -- تعديل المالك لمحتوى الإعلان يعيده للمراجعة (لو الموافقة مفعَّلة) أو لو كان مرفوضًا.
    if v_owner and (new.title, new.short_title, new.description, new.media, new.cover_image, new.music)
                   is distinct from (old.title, old.short_title, old.description, old.media, old.cover_image, old.music) then
      select require_reel_approval into v_required from public.moderation_settings where id = true;
      if old.moderation_status = 'rejected'
         or (old.moderation_status = 'approved' and coalesce(v_required, true)) then
        new.moderation_status := 'pending';
        new.moderation_reason := null;
      end if;
    end if;
  elsif new.moderation_status is distinct from old.moderation_status then
    -- قرار أدمن
    new.moderated_at := now();
    new.moderated_by := auth.uid();
    if new.moderation_status = 'approved' then
      new.moderation_reason := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists properties_moderation_before_update on public.properties;
create trigger properties_moderation_before_update
  before update on public.properties
  for each row execute function public.properties_moderation_before_update();

-- ---------------------------------------------------------------------
-- 5) إشعار المعلن بقرار الأدمن
-- ---------------------------------------------------------------------
create or replace function public.properties_moderation_notify()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.moderation_status is distinct from old.moderation_status
     and auth.uid() is not null and auth.uid() <> new.seller_id then
    if new.moderation_status = 'approved' then
      insert into public.notifications (recipient_id, actor_id, category, text, property_id)
      values (new.seller_id, null, 'approval',
              'تمت الموافقة على إعلانك ونُشر للجميع: ' || coalesce(new.short_title, new.title, ''), new.id);
    elsif new.moderation_status = 'rejected' then
      insert into public.notifications (recipient_id, actor_id, category, text, property_id)
      values (new.seller_id, null, 'approval',
              'تم رفض إعلانك: ' || coalesce(new.short_title, new.title, '')
              || case when nullif(btrim(coalesce(new.moderation_reason, '')), '') is not null
                      then ' — السبب: ' || btrim(new.moderation_reason) else '' end,
              new.id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists properties_moderation_notify on public.properties;
create trigger properties_moderation_notify
  after update of moderation_status on public.properties
  for each row execute function public.properties_moderation_notify();

-- ---------------------------------------------------------------------
-- 6) حذف الأدمن لإعلان غير مناسب (مع إشعار وسبب)
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_reel(p_property_id uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_seller uuid;
  v_title text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.admin_has_permission('reels') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select seller_id, coalesce(short_title, title, '') into v_seller, v_title
    from public.properties where id = p_property_id;
  if not found then
    raise exception 'reel_not_found';
  end if;

  -- بدون property_id: الإشعار لازم يبقى بعد حذف الإعلان (العلاقة cascade).
  if v_seller is not null and v_seller <> auth.uid() then
    insert into public.notifications (recipient_id, actor_id, category, text, property_id)
    values (v_seller, null, 'approval',
            'تم حذف إعلانك: ' || v_title || case when v_reason is not null then ' — السبب: ' || v_reason else ' لمخالفته سياسات المحتوى' end,
            null);
  end if;

  delete from public.properties where id = p_property_id;
end;
$$;

revoke all on function public.admin_delete_reel(uuid, text) from public;
grant execute on function public.admin_delete_reel(uuid, text) to authenticated;
