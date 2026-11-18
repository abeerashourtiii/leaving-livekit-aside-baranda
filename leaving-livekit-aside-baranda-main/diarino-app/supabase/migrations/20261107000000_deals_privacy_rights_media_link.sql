-- ---------------------------------------------------------------------
-- 1) الناشر لا يقرأ بيانات إدارية من صفقاته
--    سياسة RLS على property_deals على مستوى الصف فقط ("payers read own deals"): الناشر كان يقدر يطلب مباشرة أعمدة إدارية
--    (admin_note, payment_ref, handled_by, handled_at, payer_*) من صفوف صفقاته، ودالتا confirm_deal_payment / submit_deal_payment
--    كانتا ترجعان الصف كاملًا. الآن: صلاحيات على مستوى العمود (الناشر يقرأ فقط ما تعرضه الشاشات)، والدالتان ترجعان jsonb
--    بحقول الناشر فقط. الأدمن يقرأ عبر admin_list_deals (security definer) فلا يتأثر. نسخ التطبيق القديمة تتجاهل قيمة الإرجاع.
-- ---------------------------------------------------------------------
revoke select on public.property_deals from anon, authenticated;
grant select (
  id, property_id, property_title, property_province, payer_id, payer_account_type, deal_type, fee_egp, status,
  reported_at, due_at, paid_at, payment_method, payment_sender_name, payment_sender_email,
  payment_contact_phone, payment_submitted_at
) on public.property_deals to authenticated;

drop function if exists public.confirm_deal_payment(uuid, text, text, text);
create or replace function public.confirm_deal_payment(
  p_deal_id uuid,
  p_method text,
  p_sender_name text,
  p_contact_phone text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_deal public.property_deals%rowtype;
  v_name text := regexp_replace(btrim(coalesce(p_sender_name, '')), '\s+', ' ', 'g');
  v_phone text := btrim(coalesce(p_contact_phone, ''));
  v_row public.property_deals%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_deal from public.property_deals where id = p_deal_id for update;
  if not found or v_deal.payer_id is distinct from v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_deal.status in ('paid', 'waived') then
    raise exception 'deal_closed';
  end if;

  if p_method not in ('vodafone_cash', 'etisalat_cash', 'instapay') then
    raise exception 'bad_method';
  end if;
  if char_length(v_name) > 120 or coalesce(array_length(regexp_split_to_array(v_name, ' '), 1), 0) < 3 then
    raise exception 'bad_sender_name';
  end if;
  if char_length(regexp_replace(v_phone, '\D', '', 'g')) not between 7 and 15 or char_length(v_phone) > 30 then
    raise exception 'bad_contact_phone';
  end if;

  update public.property_deals
     set status = 'submitted',
         payment_method = p_method,
         payment_sender_name = v_name,
         payment_contact_phone = v_phone,
         payment_submitted_at = now()
   where id = p_deal_id
   returning * into v_row;

  -- حقول الناشر فقط (بدون admin_note / payment_ref / handled_by …).
  return jsonb_build_object(
    'id', v_row.id, 'status', v_row.status, 'fee_egp', v_row.fee_egp,
    'payment_method', v_row.payment_method, 'payment_submitted_at', v_row.payment_submitted_at
  );
end;
$$;
revoke all on function public.confirm_deal_payment(uuid, text, text, text) from public;
grant execute on function public.confirm_deal_payment(uuid, text, text, text) to authenticated;

-- الدالة القديمة (لنسخ التطبيق القديمة): نفس الإصلاح.
drop function if exists public.submit_deal_payment(uuid, text, text, text);
create or replace function public.submit_deal_payment(
  p_deal_id uuid,
  p_sender_name text,
  p_sender_email text,
  p_contact_phone text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_deal public.property_deals%rowtype;
  v_name text := btrim(coalesce(p_sender_name, ''));
  v_email text := lower(btrim(coalesce(p_sender_email, '')));
  v_phone text := btrim(coalesce(p_contact_phone, ''));
  v_row public.property_deals%rowtype;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_deal from public.property_deals where id = p_deal_id for update;
  if not found or v_deal.payer_id is distinct from v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_deal.status in ('paid', 'waived') then
    raise exception 'deal_closed';
  end if;

  if char_length(v_name) < 3 or char_length(v_name) > 120 then
    raise exception 'bad_sender_name';
  end if;
  if char_length(v_email) < 5 or char_length(v_email) > 160 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'bad_sender_email';
  end if;
  if char_length(regexp_replace(v_phone, '\D', '', 'g')) < 7 or char_length(v_phone) > 30 then
    raise exception 'bad_contact_phone';
  end if;

  update public.property_deals
     set status = 'submitted',
         payment_sender_name = v_name,
         payment_sender_email = v_email,
         payment_contact_phone = v_phone,
         payment_submitted_at = now()
   where id = p_deal_id
   returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'status', v_row.status, 'fee_egp', v_row.fee_egp,
    'payment_submitted_at', v_row.payment_submitted_at
  );
end;
$$;
revoke all on function public.submit_deal_payment(uuid, text, text, text) from public;
grant execute on function public.submit_deal_payment(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) إقرار ملكية الحقوق: يُسجَّل مرة واحدة بوقت الخادم
--    قبلها: العميل يرسل الوقت عند كل نشر وتعديل (فيُمحى التاريخ الأصلى فى كل تعديل، ويمكن تزويره).
--    الآن: عند الإدراج يُستبدل الوقت المرسَل بـ now() (إن أُرسل إقرار)؛ وعند التعديل: لو سُجّل إقرار سابقًا يبقى كما هو (لا يتغيّر،
--    حتى من صاحب الإعلان)، ولو لم يكن مسجّلًا يُسجَّل now() عند أول إقرار. الأدمن غير مقيَّد.
-- ---------------------------------------------------------------------
create or replace function public.properties_rights_declared_once()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.rights_declared_at is not null then
      new.rights_declared_at := now();
    end if;
    return new;
  end if;
  -- UPDATE
  if public.admin_has_permission('reels') then
    return new;
  end if;
  if old.rights_declared_at is not null then
    new.rights_declared_at := old.rights_declared_at;
  elsif new.rights_declared_at is not null then
    new.rights_declared_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists properties_rights_declared_once on public.properties;
create trigger properties_rights_declared_once
  before insert or update on public.properties
  for each row execute function public.properties_rights_declared_once();

-- ---------------------------------------------------------------------
-- 3) ربط وسائط الإعلان بالإعلان بعد النشر + قائمة الوسائط اليتيمة (للأدمن)
--    الوسائط تُرفع إلى Cloudinary قبل إدراج الإعلان؛ فشل الإدراج (أو التخلّى عن النشر) كان يترك ملفات يتيمة بلا أثر.
--    كل رفع يُسجَّل أصلًا فى جدول media بـ context='property' و context_id فارغ؛ بعد نجاح النشر يربطها التطبيق بالإعلان
--    (link_media_to_property)، فالباقى بلا ربط = يتيم ويظهر للأدمن فى admin_list_orphan_media للحذف من Cloudinary (يلزم مفتاح الخدمة).
-- ---------------------------------------------------------------------
create or replace function public.link_media_to_property(p_property_id uuid, p_urls text[])
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.properties where id = p_property_id and seller_id = auth.uid()) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  update public.media
     set context_id = p_property_id
   where owner_id = auth.uid()
     and context = 'property'
     and context_id is null
     and url = any (p_urls);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.link_media_to_property(uuid, text[]) from public, anon;
grant execute on function public.link_media_to_property(uuid, text[]) to authenticated;

create or replace function public.admin_list_orphan_media(p_older_than_hours integer default 24)
returns table (id uuid, owner_id uuid, type text, url text, public_id text, bytes bigint, created_at timestamptz)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.admin_has_permission('reels') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select m.id, m.owner_id, m.type::text, m.url, m.public_id, m.bytes::bigint, m.created_at
      from public.media m
     where m.context = 'property'
       and m.context_id is null
       and m.created_at < now() - make_interval(hours => greatest(p_older_than_hours, 1))
       and not exists (select 1 from public.properties p where p.media::text like '%' || m.public_id || '%')
     order by m.created_at;
end;
$$;
revoke all on function public.admin_list_orphan_media(integer) from public, anon;
grant execute on function public.admin_list_orphan_media(integer) to authenticated;

-- ---------------------------------------------------------------------
-- 4) رسوم الصفقات لا تُحفظ صفرًا/سالبة (حماية على الخادم بجانب تحقق لوحة الأدمن)
--    NOT VALID: يُطبَّق على الكتابات الجديدة فقط ولا يفشل لو وُجدت قيم قديمة.
-- ---------------------------------------------------------------------
alter table public.deal_settings drop constraint if exists deal_settings_fees_positive;
alter table public.deal_settings
  add constraint deal_settings_fees_positive
  check (fee_egp > 0 and (fee_rent_egp is null or fee_rent_egp > 0)) not valid;
