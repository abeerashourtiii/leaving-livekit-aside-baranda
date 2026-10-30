-- supabase/migrations/20261021000000_edit_delete_windows.sql
--
-- نافذة الـ 24 ساعة لصاحب الإعلان/الطلب:
--
--  • الإعلان: يقدر صاحبه **يعدّل ويحذف خلال 24 ساعة من موافقة الأدمن ونشره** (published_at). بعدها لا تعديل ولا حذف من صاحبه،
--    والحذف يصبح من حق المشرفين (admin_delete_reel / سياسة حذف الأدمن). الإعلان اللى لسه «قيد المراجعة» أو «مرفوض» (ما اتنشرش)
--    يفضل صاحبه يعدّله ويحذفه بدون مدة. نقطة البداية = أول نشر؛ وإعادة الموافقة بعد تعديل لا تفتح نافذة جديدة.
--  • الطلب: يقدر صاحبه **يحذفه خلال 24 ساعة من وقت عرضه** (created_at). بعدها الحذف من حق المشرفين (admin_delete_request).
--
-- التنفيذ على الخادم (مش بس الواجهة): سياسات RLS للحذف + trigger يمنع تعديل محتوى الإعلان بعد المدة.
-- أعمدة النظام (pinned/closed/عدّادات/الإشراف) لا تُعدّ «تعديل» فتظل تعمل بعد المدة (تثبيت، «تم البيع»، المشاهدات...).

create or replace function public.owner_window()
returns interval
language sql
immutable
as $$ select interval '24 hours' $$;

-- ---------------------------------------------------------------------
-- 1) تاريخ النشر (أول موافقة)
-- ---------------------------------------------------------------------
alter table public.properties add column if not exists published_at timestamptz;

comment on column public.properties.published_at is
  'وقت أول نشر للإعلان (أول موافقة). بداية نافذة الـ 24 ساعة للتعديل والحذف من صاحب الإعلان. null = لم يُنشر بعد.';

-- الإعلانات المنشورة قبل هذه الإضافة: نعتبر وقت الإنشاء هو وقت النشر.
update public.properties
   set published_at = created_at
 where moderation_status = 'approved' and published_at is null;

-- ---------------------------------------------------------------------
-- 2) triggers الإشراف: نفس منطق 20261019000000 + published_at
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

  if auth.uid() is null or public.admin_has_permission('reels') or not coalesce(v_required, true) then
    new.moderation_status := 'approved';
  else
    new.moderation_status := 'pending';
  end if;
  new.moderation_reason := null;
  new.moderated_at := null;
  new.moderated_by := null;
  -- النشر الفورى = بداية نافذة الـ 24 ساعة. قيد المراجعة: لسه ما اتنشرش.
  new.published_at := case when new.moderation_status = 'approved' then now() else null end;
  return new;
end;
$$;

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
  -- تاريخ النشر لا يغيّره مستخدم يدويًا (مالك أو أدمن): بيتحدد تحت فقط عند أول موافقة. الجلسات الداخلية (service role / migrations)
  -- بدون مستخدم (auth.uid() = null) مسموح لها بضبطه (مثلًا التعبئة الرجعية).
  if auth.uid() is not null then
    new.published_at := old.published_at;
  end if;

  if auth.uid() is not null and not v_admin then
    new.moderation_status := old.moderation_status;
    new.moderation_reason := old.moderation_reason;
    new.moderated_at := old.moderated_at;
    new.moderated_by := old.moderated_by;

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
    new.moderated_at := now();
    new.moderated_by := auth.uid();
    if new.moderation_status = 'approved' then
      new.moderation_reason := null;
    end if;
  end if;

  -- أول موافقة => بداية النافذة (إعادة الموافقة بعد تعديل لا تغيّرها).
  if new.moderation_status = 'approved' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) منع تعديل محتوى الإعلان بعد انتهاء المدة (من صاحبه فقط؛ الأدمن والخدمات الداخلية غير مقيَّدين)
-- ---------------------------------------------------------------------
create or replace function public.properties_edit_window_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_system text[] := array[
    'id', 'seller_id', 'created_at', 'updated_at', 'published_at',
    'moderation_status', 'moderation_reason', 'moderated_at', 'moderated_by',
    'pinned', 'pinned_at', 'likes', 'saves', 'views', 'chats', 'wa_clicks', 'comment_count',
    'closed_at', 'closed_type', 'rights_declared_at', 'captions_ar', 'captions_en'
  ];
begin
  if auth.uid() is not null
     and auth.uid() = old.seller_id
     and not public.admin_has_permission('reels')
     and old.published_at is not null
     and now() > old.published_at + public.owner_window()
     and (to_jsonb(new) - v_system) is distinct from (to_jsonb(old) - v_system) then
    raise exception 'edit_window_closed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists properties_edit_window_guard on public.properties;
create trigger properties_edit_window_guard
  before update on public.properties
  for each row execute function public.properties_edit_window_guard();

-- ---------------------------------------------------------------------
-- 4) الحذف: صاحب الإعلان داخل المدة فقط (أو قبل النشر)، والأدمن دائمًا (سياسته الحالية)
-- ---------------------------------------------------------------------
drop policy if exists "sellers can delete their own properties" on public.properties;
create policy "sellers can delete their own properties"
  on public.properties for delete
  to authenticated
  using (
    seller_id = auth.uid()
    and (published_at is null or now() <= published_at + public.owner_window())
  );

-- الطلبات: صاحب الطلب يحذف خلال 24 ساعة من عرضه فقط؛ وبعدها للمشرفين (صلاحية reports أو requests).
drop policy if exists "requesters can delete their own requests" on public.requests;
create policy "requesters can delete their own requests"
  on public.requests for delete
  to authenticated
  using (requester_id = auth.uid() and now() <= created_at + public.owner_window());

drop policy if exists "admins can delete any request" on public.requests;
create policy "admins can delete any request"
  on public.requests for delete
  to authenticated
  using (public.admin_has_permission('reports') or public.admin_has_permission('requests'));

-- ---------------------------------------------------------------------
-- 5) حذف المشرف لطلب قديم/غير فعّال (مع سبب اختيارى وإشعار لصاحب الطلب)
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_request(p_request_id uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not (public.admin_has_permission('requests') or public.admin_has_permission('reports')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select requester_id, coalesce(type, '') || ' - ' || coalesce(location, '') into v_owner, v_title
    from public.requests where id = p_request_id;
  if not found then
    raise exception 'request_not_found';
  end if;

  if v_owner is not null and v_owner <> auth.uid() then
    insert into public.notifications (recipient_id, actor_id, category, text, property_id)
    values (v_owner, null, 'approval',
            'تم حذف طلبك: ' || v_title || case when v_reason is not null then ' — السبب: ' || v_reason else ' من قبل الإدارة' end,
            null);
  end if;

  delete from public.requests where id = p_request_id;
end;
$$;

revoke all on function public.admin_delete_request(uuid, text) from public;
grant execute on function public.admin_delete_request(uuid, text) to authenticated;
