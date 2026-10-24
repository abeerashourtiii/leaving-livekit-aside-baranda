-- supabase/migrations/20261018000000_offers_optional_whatsapp.sql
--
-- رقم الواتساب فى «تقديم عرض» (على ريل/إعلان أو على طلب) صار **اختيارى**: مقدّم العرض يقدر يكمّل المحادثة داخل التطبيق من صفحة «العروض»
-- (أيقونة بجوار جرس الإشعارات) من غير ما يكتب رقم. لو كتبه لازم يكون بصيغة دولية صحيحة (+201012345678) ويراه الطرف التانى.
--  • property_offers.whatsapp / request_offers.whatsapp : null مسموح (والصيغة تُفحص فقط لو فيه قيمة).
--  • submit_property_offer / submit_request_offer      : p_whatsapp اختيارى (default null)، '' بيتحوّل null.

do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid in ('public.property_offers'::regclass, 'public.request_offers'::regclass)
       and pg_get_constraintdef(c.oid) ilike '%whatsapp%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.property_offers alter column whatsapp drop not null;
alter table public.request_offers alter column whatsapp drop not null;

alter table public.property_offers
  add constraint property_offers_whatsapp_check check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{7,14}$');
alter table public.request_offers
  add constraint request_offers_whatsapp_check check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{7,14}$');

drop function if exists public.submit_property_offer(uuid, numeric, text, text);

create or replace function public.submit_property_offer(
  p_property_id uuid,
  p_price numeric,
  p_message text,
  p_whatsapp text default null
)
returns public.property_offers
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prop public.properties%rowtype;
  v_msg text := btrim(coalesce(p_message, ''));
  v_wa text := nullif(btrim(coalesce(p_whatsapp, '')), '');  -- رقم التواصل اختيارى
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
  -- رقم الواتساب اختيارى: لو كُتب لازم يكون بصيغة دولية صحيحة (E.164).
  if v_wa is not null and v_wa !~ '^\+[1-9][0-9]{7,14}$' then
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
  values (p_property_id, v_uid, v_prop.seller_id, round(p_price), v_msg, v_wa, v_chat)
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
  values (v_chat, v_uid, v_text, v_wa);

  return v_row;
end;
$$;

revoke all on function public.submit_property_offer(uuid, numeric, text, text) from public;
grant execute on function public.submit_property_offer(uuid, numeric, text, text) to authenticated;

drop function if exists public.submit_request_offer(uuid, numeric, text, text);

create or replace function public.submit_request_offer(
  p_request_id uuid,
  p_price numeric,
  p_message text,
  p_whatsapp text default null
)
returns public.request_offers
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.requests%rowtype;
  v_msg text := btrim(coalesce(p_message, ''));
  v_wa text := nullif(btrim(coalesce(p_whatsapp, '')), '');  -- رقم التواصل اختيارى
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
  -- رقم الواتساب اختيارى: لو كُتب لازم يكون بصيغة دولية صحيحة (E.164).
  if v_wa is not null and v_wa !~ '^\+[1-9][0-9]{7,14}$' then
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
  values (p_request_id, v_title, v_uid, v_req.requester_id, round(p_price), v_msg, v_wa, v_chat)
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
  values (v_chat, v_uid, v_text, v_wa);

  return v_row;
end;
$$;

revoke all on function public.submit_request_offer(uuid, numeric, text, text) from public;
grant execute on function public.submit_request_offer(uuid, numeric, text, text) to authenticated;
