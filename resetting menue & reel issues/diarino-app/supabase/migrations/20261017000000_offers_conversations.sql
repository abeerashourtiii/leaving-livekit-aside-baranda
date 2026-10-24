-- supabase/migrations/20261017000000_offers_conversations.sql
--
-- «العروض» كمحادثات: كل عرض (على إعلان/ريل أو على طلب) = محادثة بين مقدّم العرض وصاحب الإعلان/الطلب، تظهر فى صفحة «العروض»
-- (الكل / عروض الريلز / عروض الطلبات) والأحدث فى الأعلى، وتُرسَل منها الردود. إشعارات رسائل العروض منفصلة عن جرس الإشعارات.
--
--  1) property_offers.chat_id  : ربط عرض الريل بمحادثته. submit_property_offer بقت تنشئ المحادثة + الرسالة الأولى (بدل إشعار 'offer').
--  2) request_offers           : سجل عروض الطلبات (كان العرض رسالة فى محادثة بس، بدون سجل) + submit_request_offer / respond_request_offer.
--  3) respond_*                : القبول/الاعتذار بيظهر كرسالة فى المحادثة (ومنها الإشعار للطرف التانى).
--  4) admin_list_offers()      : قائمة كل العروض (ريلز + طلبات) للأدمن بصلاحية قسم «offers» — بيانات العرض فقط (الأطراف، السعر، الحالة،
--                                 نص العرض الأول، عدد الرسائل) بدون محتوى باقى المحادثة، لمعرفة عمليات البيع الجارية عبر التطبيق.
--
-- الإشعارات: كل رسالة عرض بتعدّى على trigger الرسائل الموجود (handle_chat_message_insert → notifications.category='chat' + push)،
-- وواجهة التطبيق بتخفى فئتى chat/offer من جرس الإشعارات وتعرضهم كنقطة حمراء على أيقونة «العروض».

-- ---------------------------------------------------------------------
-- 1) ربط عرض الريل بالمحادثة
-- ---------------------------------------------------------------------
alter table public.property_offers
  add column if not exists chat_id uuid references public.chats(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2) عروض الطلبات
-- ---------------------------------------------------------------------
create table if not exists public.request_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests(id) on delete set null,
  request_title text not null default '',
  offerer_id uuid not null references public.profiles(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  price numeric(14, 0) check (price is null or price > 0),
  message text not null check (char_length(btrim(message)) between 1 and 1000),
  whatsapp text not null check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'new' check (status in ('new', 'accepted', 'declined')),
  chat_id uuid references public.chats(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz
);

-- عرض واحد فعّال لكل (طلب، مقدّم عرض).
create unique index if not exists request_offers_one_per_offerer
  on public.request_offers (request_id, offerer_id) where request_id is not null;
create index if not exists request_offers_requester_idx on public.request_offers (requester_id, created_at desc);
create index if not exists request_offers_offerer_idx on public.request_offers (offerer_id, created_at desc);

alter table public.request_offers enable row level security;

drop policy if exists "request offers readable by both parties" on public.request_offers;
create policy "request offers readable by both parties"
  on public.request_offers for select
  to authenticated
  using (offerer_id = auth.uid() or requester_id = auth.uid());
-- لا INSERT/UPDATE/DELETE مباشر من العميل: كله عبر الدوال.

-- ---------------------------------------------------------------------
-- 3) مساعد داخلى: محادثة موجودة أو جديدة (نفس أسلوب openOrCreate* فى العميل) + رسالة
-- ---------------------------------------------------------------------
create or replace function public.offer_get_or_create_chat(
  p_initiator uuid, p_partner uuid, p_property uuid, p_request uuid
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_chat uuid;
begin
  if p_property is not null then
    select id into v_chat from public.chats where initiator_id = p_initiator and property_id = p_property;
  else
    select id into v_chat from public.chats where initiator_id = p_initiator and request_id = p_request;
  end if;

  if v_chat is null then
    insert into public.chats (initiator_id, partner_id, property_id, request_id)
    values (p_initiator, p_partner, p_property, p_request)
    returning id into v_chat;
  end if;
  return v_chat;
end;
$$;

revoke all on function public.offer_get_or_create_chat(uuid, uuid, uuid, uuid) from public;
-- (داخلى: تُستدعى من دوال security definer فقط)

-- ---------------------------------------------------------------------
-- 4) عرض على إعلان: المحادثة + الرسالة الأولى (بدل إشعار 'offer' المنفصل)
-- ---------------------------------------------------------------------
create or replace function public.submit_property_offer(
  p_property_id uuid,
  p_price numeric,
  p_message text,
  p_whatsapp text
)
returns public.property_offers
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prop public.properties%rowtype;
  v_msg text := btrim(coalesce(p_message, ''));
  v_row public.property_offers%rowtype;
  v_chat uuid;
  v_text text;
  v_existing boolean;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_prop from public.properties where id = p_property_id;
  if not found or v_prop.moderation_status is distinct from 'approved' or v_prop.closed_at is not null then
    raise exception 'property_unavailable';
  end if;

  if v_prop.seller_id = v_uid then
    raise exception 'own_property';
  end if;

  if char_length(v_msg) < 1 or char_length(v_msg) > 1000 then
    raise exception 'bad_message';
  end if;
  if p_price is not null and (p_price <= 0 or p_price > 100000000000) then
    raise exception 'bad_price';
  end if;
  if p_whatsapp is null or p_whatsapp !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'bad_whatsapp';
  end if;

  -- حد المعدل: 10 عروض/تحديثات فى الساعة لكل مستخدم.
  if (
    select count(*) from public.property_offers
     where offerer_id = v_uid and updated_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'rate_limited';
  end if;

  v_existing := exists (select 1 from public.property_offers where property_id = p_property_id and offerer_id = v_uid);
  v_chat := public.offer_get_or_create_chat(v_uid, v_prop.seller_id, p_property_id, null);

  insert into public.property_offers (property_id, offerer_id, seller_id, price, message, whatsapp, chat_id)
  values (p_property_id, v_uid, v_prop.seller_id, round(p_price), v_msg, p_whatsapp, v_chat)
  on conflict (property_id, offerer_id) do update
    set price = excluded.price,
        message = excluded.message,
        whatsapp = excluded.whatsapp,
        seller_id = excluded.seller_id,
        chat_id = excluded.chat_id,
        status = 'new',
        updated_at = now(),
        responded_at = null
  returning * into v_row;

  -- الرسالة الأولى (أو رسالة التحديث) فى المحادثة — ومنها بيتولّد إشعار/Push للطرف التانى.
  v_text := case when v_existing then 'عدّلتُ عرضي على: ' else 'عرض على: ' end
            || coalesce(v_prop.short_title, v_prop.title, '')
            || case when v_row.price is not null then E'\nالسعر المقترح: ' || to_char(v_row.price, 'FM999G999G999G999') || ' ج.م' else '' end
            || E'\n' || v_msg;
  insert into public.chat_messages (chat_id, sender_id, text, whatsapp)
  values (v_chat, v_uid, v_text, p_whatsapp);

  return v_row;
end;
$$;

revoke all on function public.submit_property_offer(uuid, numeric, text, text) from public;
grant execute on function public.submit_property_offer(uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) رد صاحب الإعلان: قبول/اعتذار = رسالة فى المحادثة
-- ---------------------------------------------------------------------
create or replace function public.respond_property_offer(p_offer_id uuid, p_status text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_offer public.property_offers%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_status not in ('accepted', 'declined') then
    raise exception 'bad_status';
  end if;

  select * into v_offer from public.property_offers where id = p_offer_id for update;
  if not found or v_offer.seller_id <> v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update public.property_offers set status = p_status, responded_at = now() where id = p_offer_id;

  if v_offer.chat_id is not null then
    insert into public.chat_messages (chat_id, sender_id, text)
    values (
      v_offer.chat_id, v_uid,
      case when p_status = 'accepted'
           then '✅ قبلتُ عرضك. تواصل معي لإتمام الصفقة.'
           else '❌ أعتذر عن عرضك. شكرًا لاهتمامك.' end
    );
  end if;
end;
$$;

revoke all on function public.respond_property_offer(uuid, text) from public;
grant execute on function public.respond_property_offer(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6) عرض على طلب (كان فى العميل: increment + إنشاء محادثة + رسالة) — صار على الخادم مع سجل
-- ---------------------------------------------------------------------
create or replace function public.submit_request_offer(
  p_request_id uuid,
  p_price numeric,
  p_message text,
  p_whatsapp text
)
returns public.request_offers
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.requests%rowtype;
  v_msg text := btrim(coalesce(p_message, ''));
  v_row public.request_offers%rowtype;
  v_chat uuid;
  v_title text;
  v_text text;
  v_existing boolean;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_req from public.requests where id = p_request_id;
  if not found then
    raise exception 'request_unavailable';
  end if;
  if v_req.requester_id = v_uid then
    raise exception 'own_request';
  end if;

  if char_length(v_msg) < 1 or char_length(v_msg) > 1000 then
    raise exception 'bad_message';
  end if;
  if p_price is not null and (p_price <= 0 or p_price > 100000000000) then
    raise exception 'bad_price';
  end if;
  if p_whatsapp is null or p_whatsapp !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'bad_whatsapp';
  end if;

  if (
    select count(*) from public.request_offers
     where offerer_id = v_uid and updated_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'rate_limited';
  end if;

  v_title := coalesce(v_req.type, '') || ' - ' || coalesce(v_req.location, '');
  v_existing := exists (select 1 from public.request_offers where request_id = p_request_id and offerer_id = v_uid);
  v_chat := public.offer_get_or_create_chat(v_uid, v_req.requester_id, null, p_request_id);

  insert into public.request_offers (request_id, request_title, offerer_id, requester_id, price, message, whatsapp, chat_id)
  values (p_request_id, v_title, v_uid, v_req.requester_id, round(p_price), v_msg, p_whatsapp, v_chat)
  on conflict (request_id, offerer_id) where request_id is not null do update
    set price = excluded.price,
        message = excluded.message,
        whatsapp = excluded.whatsapp,
        chat_id = excluded.chat_id,
        status = 'new',
        updated_at = now(),
        responded_at = null
  returning * into v_row;

  if not v_existing then
    update public.requests set offers_count = offers_count + 1 where id = p_request_id;
  end if;

  v_text := case when v_existing then 'عدّلتُ عرضي بخصوص طلبك (' else 'بخصوص طلبك (' end || v_title || E'):\n' || v_msg
            || case when v_row.price is not null then E'\nالسعر: ' || to_char(v_row.price, 'FM999G999G999G999') || ' ج.م' else '' end;
  insert into public.chat_messages (chat_id, sender_id, text, whatsapp)
  values (v_chat, v_uid, v_text, p_whatsapp);

  return v_row;
end;
$$;

revoke all on function public.submit_request_offer(uuid, numeric, text, text) from public;
grant execute on function public.submit_request_offer(uuid, numeric, text, text) to authenticated;

create or replace function public.respond_request_offer(p_offer_id uuid, p_status text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_offer public.request_offers%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_status not in ('accepted', 'declined') then
    raise exception 'bad_status';
  end if;

  select * into v_offer from public.request_offers where id = p_offer_id for update;
  if not found or v_offer.requester_id <> v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update public.request_offers set status = p_status, responded_at = now() where id = p_offer_id;

  if v_offer.chat_id is not null then
    insert into public.chat_messages (chat_id, sender_id, text)
    values (
      v_offer.chat_id, v_uid,
      case when p_status = 'accepted'
           then '✅ قبلتُ عرضك. تواصل معي لإتمام الصفقة.'
           else '❌ أعتذر عن عرضك. شكرًا لاهتمامك.' end
    );
  end if;
end;
$$;

revoke all on function public.respond_request_offer(uuid, text) from public;
grant execute on function public.respond_request_offer(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7) الأدمن: العروض المقدَّمة (ريلز + طلبات) — صلاحية قسم «offers»
-- ---------------------------------------------------------------------
create or replace function public.admin_list_offers()
returns table (
  id uuid,
  kind text,                 -- 'reel' | 'request'
  target_id uuid,
  target_title text,
  asking_price numeric,      -- سعر الإعلان (للريلز فقط)
  offer_price numeric,
  status text,
  message text,
  offerer_id uuid,
  offerer_name text,
  offerer_phone text,
  offerer_email text,
  other_id uuid,             -- صاحب الإعلان (reel) أو صاحب الطلب (request)
  other_name text,
  other_phone text,
  other_email text,
  chat_id uuid,
  messages_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.admin_has_permission('offers') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select o.id, 'reel'::text, o.property_id, coalesce(pr.short_title, pr.title, '')::text, pr.price::numeric,
           o.price, o.status::text, o.message::text,
           o.offerer_id, po.full_name::text, po.phone_e164::text, uo.email::text,
           o.seller_id, ps.full_name::text, ps.phone_e164::text, us.email::text,
           o.chat_id, (select count(*) from public.chat_messages m where m.chat_id = o.chat_id),
           o.created_at, o.updated_at
      from public.property_offers o
      left join public.properties pr on pr.id = o.property_id
      left join public.profiles po on po.id = o.offerer_id
      left join auth.users uo on uo.id = o.offerer_id
      left join public.profiles ps on ps.id = o.seller_id
      left join auth.users us on us.id = o.seller_id
    union all
    select o.id, 'request'::text, o.request_id, o.request_title::text, null::numeric,
           o.price, o.status::text, o.message::text,
           o.offerer_id, po.full_name::text, po.phone_e164::text, uo.email::text,
           o.requester_id, ps.full_name::text, ps.phone_e164::text, us.email::text,
           o.chat_id, (select count(*) from public.chat_messages m where m.chat_id = o.chat_id),
           o.created_at, o.updated_at
      from public.request_offers o
      left join public.profiles po on po.id = o.offerer_id
      left join auth.users uo on uo.id = o.offerer_id
      left join public.profiles ps on ps.id = o.requester_id
      left join auth.users us on us.id = o.requester_id
    order by 20 desc;
end;
$$;

revoke all on function public.admin_list_offers() from public;
grant execute on function public.admin_list_offers() to authenticated;
