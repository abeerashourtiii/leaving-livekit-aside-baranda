-- ---------------------------------------------------------------------
-- ملحق الفحص G1 / G2 / G4 / G5(خادم) / G7 / G9 — قابل لإعادة التشغيل. (لا يعدّل أى migration قديم.)
-- ---------------------------------------------------------------------

-- G1) أعمدة profiles المحمية. سياسة UPDATE كانت على مستوى الصف فقط (id = auth.uid()) فأى مستخدم يقدر يكتب
--     profiles.verified = true من عميله فتظهر له علامة التوثيق ✓ على إعلاناته وتعليقاته (profiles_public تعرض العمود).
--     الآن trigger (يستبدل profiles_validate_write من 20261110) يمنع غير الأدمن/الخدمة من تغيير: verified، phone_verified،
--     policies_accepted_at (يُختم بوقت الخادم عند تغيّر policies_version فقط). الدوال security definer التى تعمل بلا جلسة (handle_new_user)
--     وservice_role/لوحة Supabase (auth.uid() فارغ) غير مقيَّدة. account_type يبقى قابلًا للتعديل (يُعدَّل من شاشة تعديل الحساب)؛ قيده check الحالى.
create or replace function public.profiles_validate_write()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_priv boolean := auth.uid() is null or public.admin_has_permission('users');
begin
  new.full_name := left(new.full_name, 100);
  new.first_name := left(new.first_name, 60);
  new.last_name := left(new.last_name, 60);
  new.residence := left(new.residence, 100);

  if new.avatar_url is not null
     and (tg_op = 'INSERT' or new.avatar_url is distinct from old.avatar_url)
     and new.avatar_url !~ '^https://(lh[0-9]+\.googleusercontent\.com|res\.cloudinary\.com)/' then
    new.avatar_url := case when tg_op = 'INSERT' then null else old.avatar_url end;
  end if;

  if new.birth_date is not null and (tg_op = 'INSERT' or new.birth_date is distinct from old.birth_date) then
    if new.birth_date > current_date or new.birth_date < date '1900-01-01' then
      raise exception 'invalid_birth_date' using errcode = '22023';
    end if;
    if age(current_date, new.birth_date) < interval '18 years' then
      raise exception 'under_18' using errcode = '22023';
    end if;
  end if;

  if new.policies_version is not null and (tg_op = 'INSERT' or new.policies_version is distinct from old.policies_version) then
    if not exists (select 1 from public.policy_versions where version = new.policies_version) then
      if tg_op = 'INSERT' then
        new.policies_version := null;
        new.policies_accepted_at := null;
      else
        raise exception 'unknown_policies_version' using errcode = '22023';
      end if;
    end if;
  end if;

  if not v_priv then
    if tg_op = 'INSERT' then
      new.verified := false;
      new.phone_verified := false;
      if new.policies_version is not null then new.policies_accepted_at := now(); else new.policies_accepted_at := null; end if;
    else
      new.verified := old.verified;
      if new.phone_e164 is distinct from old.phone_e164 then
        new.phone_verified := false;
      else
        new.phone_verified := old.phone_verified;
      end if;
      if new.policies_version is distinct from old.policies_version and new.policies_version is not null then
        new.policies_accepted_at := now();
      else
        new.policies_accepted_at := old.policies_accepted_at;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- G2) lives: المضيف كان يحدّث أى عمود فى بثه (moderation_status/recording_url/…)، وإخفاء الأدمن (moderation_status='pending') لا يؤثر فى أى قراءة.
--     الآن trigger: غير الأدمن/الخدمة لا يغيّر إلا الأعمدة المسموحة لتدفّق التطبيق الحالى (العنوان/التثبيت/إخفاء التعليقات/النشر العام/
--     إنهاء البث/حالة التسجيل failed|processing|recording|none/egress_id/viewer_peak/duration_sec/poster_url) بقيم مقيّدة؛ أى عمود آخر
--     (moderation_status، recording_url، recording_filepath، rights_declared_at، host_id، room_name…) يرفضه الخادم (42501).
--     recording_url يكتبه الـ webhook (service role) فقط، فلا يستطيع المضيف توجيه شاشة الإعادة لرابط عشوائى.
create or replace function public.lives_guard_host_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  allowed text[] := array['title','pinned','pinned_at','comments_hidden','published_public','status','ended_at',
                          'recording_status','egress_id','viewer_peak','duration_sec','poster_url'];
begin
  if auth.uid() is null then return new; end if;
  if public.admin_has_permission('lives') then return new; end if;

  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'live_column_not_writable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (old.status = 'live' and new.status = 'ended') then
    raise exception 'live_status_transition_forbidden' using errcode = '42501';
  end if;
  if new.recording_status is distinct from old.recording_status
     and new.recording_status not in ('none', 'recording', 'processing', 'failed') then
    raise exception 'live_recording_status_forbidden' using errcode = '42501';
  end if;
  if new.viewer_peak is distinct from old.viewer_peak and (new.viewer_peak < 0 or new.viewer_peak > 50000) then
    raise exception 'live_viewer_peak_out_of_range' using errcode = '22023';
  end if;
  if new.duration_sec is distinct from old.duration_sec and (new.duration_sec < 0 or new.duration_sec > 86400) then
    raise exception 'live_duration_out_of_range' using errcode = '22023';
  end if;
  if new.poster_url is distinct from old.poster_url and new.poster_url is not null and new.poster_url !~ '^https://' then
    raise exception 'live_poster_url_forbidden' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists lives_guard_host_update on public.lives;
create trigger lives_guard_host_update
  before update on public.lives
  for each row execute function public.lives_guard_host_update();

-- قراءة البث: «إخفاء» الأدمن (moderation_status <> 'approved') يخفيه عن الجميع ما عدا المضيف والأدمن (كان لا يؤثر فى أى سياسة/استعلام).
drop policy if exists "public lives visible to all, private recordings to host + admin" on public.lives;
drop policy if exists "approved lives visible to all, hidden ones to host + admin" on public.lives;
create policy "approved lives visible to all, hidden ones to host + admin"
  on public.lives for select
  to authenticated
  using (
    host_id = auth.uid()
    or public.admin_has_permission('lives')
    or (moderation_status = 'approved' and (status = 'live' or published_public = true))
  );

-- G4) تنبيهات البحث المحفوظة + إشعارات «نشر إعلانًا جديدًا» + انخفاض السعر:
--     كانت AFTER INSERT على properties بلا نظر لـ moderation_status (إعلان قيد المراجعة/المرفوض يصل إشعارًا به)، ولا تُعاد عند الاعتماد،
--     ونص الإشعار يحوى عنوان الإعلان حرًّا (قناة سبام/أرقام تواصل). الآن: تعمل عند الإدراج المعتمد وعند الانتقال إلى approved فقط، لإعلان
--     غير مُغلق، بلا تكرار لنفس (مستلم، إعلان)، وبعنوان مقصوص ومفلتر بنفس قواعد تعليقات الريلز (وإلا نص عام بلا عنوان).
create or replace function public.safe_notification_title(t text)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case
    when t is null or btrim(t) = '' then ''
    when public.reel_comment_blocked_reason(t) is not null then ''
    else left(regexp_replace(t, '\s+', ' ', 'g'), 80)
  end;
$$;

create or replace function public.handle_new_listing_match()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_title text := public.safe_notification_title(new.title);
begin
  if new.moderation_status is distinct from 'approved' or new.closed_at is not null then
    return new;
  end if;
  insert into public.notifications (recipient_id, actor_id, category, text, property_id)
  select a.user_id, new.seller_id, 'new_match',
         case when v_title = '' then 'عقار جديد يطابق تنبيهك' else 'عقار جديد يطابق تنبيهك: ' || v_title end, new.id
  from public.saved_search_alerts a
  where a.active = true
    and a.user_id <> new.seller_id
    and (a.province is null or a.province = new.province)
    and (a.type is null or a.type = new.type)
    and (a.price_max is null or new.price <= a.price_max)
    and (a.finish_type is null or a.finish_type = new.finish_type)
    and not exists (
      select 1 from public.notifications n
       where n.recipient_id = a.user_id and n.category = 'new_match' and n.property_id = new.id
    );
  return new;
end;
$$;

drop trigger if exists properties_after_insert_match_alerts on public.properties;
create trigger properties_after_insert_match_alerts
  after insert on public.properties
  for each row
  when (new.moderation_status = 'approved' and new.closed_at is null)
  execute function public.handle_new_listing_match();

drop trigger if exists properties_after_approve_match_alerts on public.properties;
create trigger properties_after_approve_match_alerts
  after update of moderation_status on public.properties
  for each row
  when (new.moderation_status = 'approved' and old.moderation_status is distinct from 'approved' and new.closed_at is null)
  execute function public.handle_new_listing_match();

create or replace function public.handle_new_listing_notify()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_title text := public.safe_notification_title(new.title);
begin
  if new.moderation_status is distinct from 'approved' or new.closed_at is not null then
    return new;
  end if;
  insert into public.notifications (recipient_id, actor_id, category, text, property_id)
  select s.user_id, new.seller_id, 'follow',
         case when v_title = '' then 'نشر إعلانًا جديدًا' else 'نشر إعلانًا جديدًا: ' || v_title end, new.id
  from public.seller_notification_subscriptions s
  join public.profiles p on p.id = s.user_id
  where s.seller_id = new.seller_id
    and coalesce(p.notify_follows, true) = true
    and not exists (
      select 1 from public.notifications n
       where n.recipient_id = s.user_id and n.category = 'follow' and n.property_id = new.id and n.actor_id = new.seller_id
    );
  return new;
end;
$$;

drop trigger if exists properties_after_insert_notify on public.properties;
create trigger properties_after_insert_notify
  after insert on public.properties
  for each row
  when (new.moderation_status = 'approved' and new.closed_at is null)
  execute function public.handle_new_listing_notify();

drop trigger if exists properties_after_approve_notify on public.properties;
create trigger properties_after_approve_notify
  after update of moderation_status on public.properties
  for each row
  when (new.moderation_status = 'approved' and old.moderation_status is distinct from 'approved' and new.closed_at is null)
  execute function public.handle_new_listing_notify();

create or replace function public.handle_price_drop()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_title text := public.safe_notification_title(new.title);
begin
  if new.price < old.price and new.moderation_status = 'approved' and new.closed_at is null then
    insert into public.notifications (recipient_id, actor_id, category, text, property_id)
    select f.user_id, new.seller_id, 'price_drop',
           case when v_title = '' then 'انخفض سعر عقار محفوظ لديك' else 'انخفض سعر عقار محفوظ لديك: ' || v_title end, new.id
    from public.favorites f
    where f.property_id = new.id and f.user_id <> new.seller_id;
  end if;
  return new;
end;
$$;

-- تنبيهات البحث المحفوظة: مسجّل غير ضيف فقط (كانت لأى authenticated بما فيها الضيف) وبحد أقصى 20 لكل مستخدم.
drop policy if exists "users manage their own saved alerts" on public.saved_search_alerts;
drop policy if exists "users read own saved alerts" on public.saved_search_alerts;
drop policy if exists "users update own saved alerts" on public.saved_search_alerts;
drop policy if exists "users delete own saved alerts" on public.saved_search_alerts;
drop policy if exists "registered users create own saved alerts" on public.saved_search_alerts;
create policy "users read own saved alerts" on public.saved_search_alerts
  for select to authenticated using (user_id = auth.uid());
create policy "users update own saved alerts" on public.saved_search_alerts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users delete own saved alerts" on public.saved_search_alerts
  for delete to authenticated using (user_id = auth.uid());
create policy "registered users create own saved alerts" on public.saved_search_alerts
  for insert to authenticated
  with check (user_id = auth.uid() and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));

create or replace function public.saved_search_alerts_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.province := left(new.province, 60);
  new.type := left(new.type, 60);
  new.finish_type := left(new.finish_type, 60);
  if (select count(*) from public.saved_search_alerts where user_id = new.user_id) >= 20 then
    raise exception 'too_many_saved_alerts' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists saved_search_alerts_limit on public.saved_search_alerts;
create trigger saved_search_alerts_limit
  before insert on public.saved_search_alerts
  for each row execute function public.saved_search_alerts_limit();

-- G5 (خادم) روابط البانرات وعناصر القائمة: https/tel/mailto فقط. NOT VALID: يُفرض على الكتابات الجديدة ولا يفشل بسبب صفوف قديمة.
alter table public.ad_banners drop constraint if exists ad_banners_link_url_scheme;
alter table public.ad_banners
  add constraint ad_banners_link_url_scheme
  check (link_url is null or link_url ~* '^(https://|tel:|mailto:)') not valid;
alter table public.menu_items drop constraint if exists menu_items_url_scheme;
alter table public.menu_items
  add constraint menu_items_url_scheme
  check (action_type <> 'url' or action_value ~* '^(https://|tel:|mailto:)') not valid;

-- G7) الإشعارات الفورية بعد تسجيل الخروج: تسجيل التوكن يبقى فى push_tokens فيستمر الجهاز فى استلام إشعارات المستخدم السابق.
--     unregister_push_token تُستدعى قبل signOut وقبل حذف الحساب. وreassign_push_token ترفض الجلسات المجهولة وتتحقق من شكل التوكن.
create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null or p_token is null then return; end if;
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
end;
$$;
revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

create or replace function public.reassign_push_token(p_token text, p_device_type text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return;
  end if;
  if p_token is null or char_length(p_token) > 200 or p_token !~ '^Expo(nent)?PushToken\[.+\]$' then
    return;
  end if;
  delete from public.push_tokens where token = p_token and user_id <> auth.uid();
  insert into public.push_tokens (user_id, token, device_type, updated_at)
  values (auth.uid(), p_token, left(p_device_type, 20), now())
  on conflict (user_id, token) do update set device_type = excluded.device_type, updated_at = now();
end;
$$;
revoke all on function public.reassign_push_token(text, text) from public, anon;
grant execute on function public.reassign_push_token(text, text) to authenticated;

-- G9) ترتيب عناصر القائمة ذرّيًا: كان تبديل موضعين/إعادة الترقيم طلبات متتالية (فشل منتصفها يترك ترتيبًا مكررًا). دالة واحدة فى معاملة واحدة.
create or replace function public.admin_reorder_menu_items(p_ids uuid[])
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.admin_has_permission('menuItems') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then return; end if;
  if (select count(distinct x) from unnest(p_ids) as x) <> array_length(p_ids, 1) then
    raise exception 'duplicate_ids' using errcode = '22023';
  end if;
  update public.menu_items m
     set sort_order = o.ord - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where m.id = o.id;
end;
$$;
revoke all on function public.admin_reorder_menu_items(uuid[]) from public, anon;
grant execute on function public.admin_reorder_menu_items(uuid[]) to authenticated;

-- تبديل موضعى عنصرين ذرّيًا (كان تحديثين منفصلين: فشل الثانى يترك ترتيبًا مكررًا).
create or replace function public.admin_swap_menu_items(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_a int;
  v_b int;
begin
  if not public.admin_has_permission('menuItems') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select sort_order into v_a from public.menu_items where id = p_a for update;
  select sort_order into v_b from public.menu_items where id = p_b for update;
  if v_a is null or v_b is null then
    raise exception 'menu_item_not_found' using errcode = '22023';
  end if;
  update public.menu_items set sort_order = case when id = p_a then v_b else v_a end where id in (p_a, p_b);
end;
$$;
revoke all on function public.admin_swap_menu_items(uuid, uuid) from public, anon;
grant execute on function public.admin_swap_menu_items(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
