-- supabase/migrations/20261016000000_property_offers.sql
--
-- «تقديم عرض» على إعلان عقار (من صفحة تفاصيل العقار، أيقونة بجوار زر الاتصال) — مشابه لتقديم العرض فى صفحة الطلبات:
-- رسالة + سعر مقترح (اختيارى) + رقم واتساب للتواصل. العرض خاص بين مقدّمه وصاحب الإعلان (مش علنى زى التعليقات).
--
--  • property_offers          : العروض (مقدّم العرض، صاحب الإعلان، السعر، الرسالة، الواتساب، الحالة).
--  • submit_property_offer    : تقديم/تحديث عرض (RPC) — تحقق على الخادم: مسجَّل (مش ضيف)، الإعلان متاح، مش إعلانه، حد معدل.
--  • respond_property_offer   : صاحب الإعلان يقبل/يعتذر (RPC) — إشعار لمقدّم العرض.
--  • إشعارات (category = 'offer'): عرض جديد → صاحب الإعلان، رد على العرض → مقدّمه.
--
-- الأمان: لا INSERT/UPDATE مباشر من العميل (كله عبر الدوال)؛ القراءة لمقدّم العرض وصاحب الإعلان فقط؛ مقدّم العرض يسحب عرضه (DELETE).

-- ---------------------------------------------------------------------
-- 1) الجدول
-- ---------------------------------------------------------------------
create table if not exists public.property_offers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  offerer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  price numeric(14, 0) check (price is null or price > 0),
  message text not null check (char_length(btrim(message)) between 1 and 1000),
  whatsapp text not null check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'new' check (status in ('new', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (property_id, offerer_id)
);

create index if not exists property_offers_seller_idx on public.property_offers (seller_id, created_at desc);
create index if not exists property_offers_offerer_idx on public.property_offers (offerer_id, created_at desc);

alter table public.property_offers enable row level security;

drop policy if exists "offers readable by offerer and seller" on public.property_offers;
create policy "offers readable by offerer and seller"
  on public.property_offers for select
  to authenticated
  using (offerer_id = auth.uid() or seller_id = auth.uid());

drop policy if exists "offerers can withdraw their offers" on public.property_offers;
create policy "offerers can withdraw their offers"
  on public.property_offers for delete
  to authenticated
  using (offerer_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2) تصنيف إشعار جديد
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_category_check;
alter table public.notifications add constraint notifications_category_check
  check (category in ('like', 'save', 'follow', 'chat', 'new_match', 'price_drop', 'comment', 'offer'));

-- ---------------------------------------------------------------------
-- 3) تقديم عرض (أو تحديث عرضك السابق على نفس الإعلان)
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

  -- حد المعدل: 10 عروض/تحديثات فى الساعة لكل مستخدم (يمنع السبام).
  if (
    select count(*) from public.property_offers
     where offerer_id = v_uid and updated_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'rate_limited';
  end if;

  insert into public.property_offers (property_id, offerer_id, seller_id, price, message, whatsapp)
  values (p_property_id, v_uid, v_prop.seller_id, round(p_price), v_msg, p_whatsapp)
  on conflict (property_id, offerer_id) do update
    set price = excluded.price,
        message = excluded.message,
        whatsapp = excluded.whatsapp,
        seller_id = excluded.seller_id,
        status = 'new',
        updated_at = now(),
        responded_at = null
  returning * into v_row;

  insert into public.notifications (recipient_id, actor_id, category, text, property_id)
  values (
    v_prop.seller_id, v_uid, 'offer',
    'قدّم عرضًا على إعلانك' || case when v_row.price is not null then ' بسعر ' || to_char(v_row.price, 'FM999G999G999G999') || ' ج.م' else '' end,
    p_property_id
  );

  return v_row;
end;
$$;

revoke all on function public.submit_property_offer(uuid, numeric, text, text) from public;
grant execute on function public.submit_property_offer(uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) رد صاحب الإعلان: قبول / اعتذار
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

  update public.property_offers
     set status = p_status, responded_at = now()
   where id = p_offer_id;

  insert into public.notifications (recipient_id, actor_id, category, text, property_id)
  values (
    v_offer.offerer_id, v_uid, 'offer',
    case when p_status = 'accepted' then 'قبل المعلن عرضك، تواصل معه لإتمام الصفقة' else 'اعتذر المعلن عن عرضك' end,
    v_offer.property_id
  );
end;
$$;

revoke all on function public.respond_property_offer(uuid, text) from public;
grant execute on function public.respond_property_offer(uuid, text) to authenticated;
