-- ---------------------------------------------------------------------
-- متابعة تقرير الفحص (S3, S5, S6, S7) — قابل لإعادة التشغيل.
-- ---------------------------------------------------------------------

-- S3) increment_sponsored_reach: رفض الجلسات المجهولة (ضيف) كما يطلب التقرير.
--     (التكرار اليومى لكل مستخدم + صلاحية الحملة كانت فى 20261108000000 — هنا فقط شرط «غير ضيف».)
create or replace function public.increment_sponsored_reach(sponsored_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new integer;
begin
  if v_uid is null or sponsored_id is null then return; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then return; end if;
  if not exists (
    select 1 from public.sponsored_reels s
     where s.id = increment_sponsored_reach.sponsored_id
       and s.active = true
       and s.start_date <= current_date
       and (s.end_date is null or s.end_date >= current_date)
       and (s.reach_goal is null or s.current_reach < s.reach_goal)
  ) then
    return;
  end if;
  insert into public.sponsored_reach_log (sponsored_id, user_id)
  values (increment_sponsored_reach.sponsored_id, v_uid)
  on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new > 0 then
    update public.sponsored_reels s
       set current_reach = s.current_reach + 1
     where s.id = increment_sponsored_reach.sponsored_id
       and (s.reach_goal is null or s.current_reach < s.reach_goal);
  end if;
  if random() < 0.01 then
    delete from public.sponsored_reach_log where day < ((now() at time zone 'utc')::date - 2);
  end if;
exception when foreign_key_violation then
  return;
end;
$$;
revoke all on function public.increment_sponsored_reach(uuid) from public, anon;
grant execute on function public.increment_sponsored_reach(uuid) to authenticated;

-- S5) report_property_deal: كانت ترجع الصف كاملًا (property_deals). الآن ترجع jsonb بالأعمدة اللازمة للناشر فقط
--     (التطبيق يقرأ منها due_at فقط). نفس منطق النسخة السابقة (20261022000000) بدون أى تغيير فى السلوك.
drop function if exists public.report_property_deal(uuid, text, text);
create or replace function public.report_property_deal(
  p_property_id uuid,
  p_deal_type text,
  p_note text default null
)
returns jsonb
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
  v_fee numeric;
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
  v_fee := case when p_deal_type = 'rent' then coalesce(v_set.fee_rent_egp, 500) else coalesce(v_set.fee_egp, 1000) end;

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
    p_deal_type, v_fee,
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

  return jsonb_build_object(
    'id', v_row.id, 'property_id', v_row.property_id, 'deal_type', v_row.deal_type,
    'fee_egp', v_row.fee_egp, 'status', v_row.status,
    'reported_at', v_row.reported_at, 'due_at', v_row.due_at
  );
end;
$$;
revoke all on function public.report_property_deal(uuid, text, text) from public, anon;
grant execute on function public.report_property_deal(uuid, text, text) to authenticated;

-- S6) live_bans: المضيف يقرأ ويضيف الحظر لغرفته مباشرة (RLS) — بجانب الكتابة بمفتاح الخدمة من livekit-moderate.
--     (التصميم: المفتاح live_id → lives.id (الذى فيه room_name الفريد) بدل تكرار room_name؛ يُحذف الحظر تلقائيًا بحذف البث.)
grant select, insert on public.live_bans to authenticated;
drop policy if exists "hosts read bans of their lives" on public.live_bans;
create policy "hosts read bans of their lives"
  on public.live_bans for select
  to authenticated
  using (exists (select 1 from public.lives l where l.id = live_bans.live_id and l.host_id = auth.uid()));
drop policy if exists "hosts add bans to their lives" on public.live_bans;
create policy "hosts add bans to their lives"
  on public.live_bans for insert
  to authenticated
  with check (
    banned_by = auth.uid()
    and user_id <> auth.uid()
    and exists (select 1 from public.lives l where l.id = live_bans.live_id and l.host_id = auth.uid())
  );

-- S7) حاويات Storage العامة غير المستخدمة (chat-images / property-media / avatars):
--     التطبيق يرفع كل الميديا إلى Cloudinary ولا يستخدم supabase.storage إطلاقًا، لكن الحاويات كانت public=true وبسياسات
--     إدراج لأى authenticated (حتى الضيف) بلا حد حجم/نوع = استضافة مجانية للملفات. هنا: نحذف كل سياسات الكتابة/القراءة عليها،
--     ونغلقها (public=false) مع حد حجم وأنواع صور فقط. الملفات الموجودة (إن وُجدت) تبقى حتى تُحذف من لوحة Supabase؛ لا نحذف
--     الحاويات من SQL (Supabase يمنع الحذف المباشر من storage.*). حاوية live-recordings لا تتأثر.
drop policy if exists "chat-images: anyone authenticated can read" on storage.objects;
drop policy if exists "chat-images: users upload into their own folder" on storage.objects;
drop policy if exists "chat-images: users manage their own uploads" on storage.objects;
drop policy if exists "chat-images: users delete their own uploads" on storage.objects;
drop policy if exists "property-media: anyone authenticated can read" on storage.objects;
drop policy if exists "property-media: users upload into their own folder" on storage.objects;
drop policy if exists "property-media: users manage their own uploads" on storage.objects;
drop policy if exists "property-media: users delete their own uploads" on storage.objects;
drop policy if exists "avatars: anyone authenticated can read" on storage.objects;
drop policy if exists "avatars: users upload into their own folder" on storage.objects;
drop policy if exists "avatars: users manage their own uploads" on storage.objects;
drop policy if exists "avatars: users delete their own uploads" on storage.objects;

update storage.buckets
   set public = false,
       file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id in ('chat-images', 'property-media', 'avatars');

notify pgrst, 'reload schema';
