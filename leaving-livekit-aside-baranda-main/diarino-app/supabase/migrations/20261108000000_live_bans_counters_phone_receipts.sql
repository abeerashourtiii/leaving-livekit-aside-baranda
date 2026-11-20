-- ---------------------------------------------------------------------
-- 1) حظر المشاهد من البث (livekit-moderate كان يطرد فقط فيعود المطرود بتوكن جديد فورًا)
--    الكتابة من الـ edge functions بمفتاح الخدمة فقط؛ لا سياسات ولا صلاحيات للعملاء عمدًا.
-- ---------------------------------------------------------------------
create table if not exists public.live_bans (
  live_id uuid not null references public.lives(id) on delete cascade,
  user_id uuid not null,
  banned_by uuid,
  created_at timestamptz not null default now(),
  primary key (live_id, user_id)
);
alter table public.live_bans enable row level security;
revoke all on public.live_bans from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) عدّادات قابلة للتلاعب
--    increment_wa_clicks / increment_sponsored_reach كانتا تزيدان بلا أى تحقق: أى مستخدم (حتى جلسة ضيف) يستدعيهما فى حلقة فيلوّث
--    إحصاءات النقرات أو يُنهى reach_goal لحملة مدفوعة مبكرًا. الآن: لا زيادة إلا (مرة لكل مستخدم/عنصر/يوم) على عنصر صالح،
--    ونفس نمط increment_property_views. واتساب يتطلب حسابًا مسجّلًا غير ضيف.
-- ---------------------------------------------------------------------
create table if not exists public.wa_click_log (
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null,
  day date not null default ((now() at time zone 'utc')::date),
  primary key (property_id, user_id, day)
);
alter table public.wa_click_log enable row level security;
revoke all on public.wa_click_log from anon, authenticated;

create table if not exists public.sponsored_reach_log (
  sponsored_id uuid not null references public.sponsored_reels(id) on delete cascade,
  user_id uuid not null,
  day date not null default ((now() at time zone 'utc')::date),
  primary key (sponsored_id, user_id, day)
);
alter table public.sponsored_reach_log enable row level security;
revoke all on public.sponsored_reach_log from anon, authenticated;

create or replace function public.increment_wa_clicks(property_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new integer;
begin
  if v_uid is null or property_id is null then return; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then return; end if;
  -- إعلان صالح للعرض فقط، ولا تُحتسب نقرة صاحب الإعلان على إعلانه.
  if not exists (
    select 1 from public.properties p
     where p.id = increment_wa_clicks.property_id
       and p.moderation_status = 'approved'
       and p.closed_at is null
       and p.seller_id <> v_uid
  ) then
    return;
  end if;
  insert into public.wa_click_log (property_id, user_id)
  values (increment_wa_clicks.property_id, v_uid)
  on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new > 0 then
    update public.properties p set wa_clicks = p.wa_clicks + 1 where p.id = increment_wa_clicks.property_id;
  end if;
  -- تنظيف انتهازى للسجل القديم (بدون الحاجة لمهمة مجدولة).
  if random() < 0.01 then
    delete from public.wa_click_log where day < ((now() at time zone 'utc')::date - 2);
  end if;
exception when foreign_key_violation then
  return;
end;
$$;
revoke all on function public.increment_wa_clicks(uuid) from public, anon;
grant execute on function public.increment_wa_clicks(uuid) to authenticated;

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
  -- حملة فعّالة داخل مدتها ولم تبلغ هدفها (الضيف مسموح: هو مشاهد حقيقى، لكن مرة واحدة يوميًا لكل حملة).
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

-- increment_request_offers: بلا أى تحقق، والهوك الذى يستدعيها غير مستخدم (عدّاد العروض يُحسب من جدول request_offers) — تُحذف.
drop function if exists public.increment_request_offers(uuid);

-- ---------------------------------------------------------------------
-- 3) get_property_contact_phone: بوابة الضيف كانت على العميل فقط، وبلا فحص لحالة الإعلان
--    الآن (على الخادم): جلسة ضيف/بلا جلسة ⇐ null؛ وللغير صاحب الإعلان/الأدمن: إعلان معتمد وغير مُغلق فقط
--    (المخفى/قيد المراجعة/المرفوض/المُغلق لا يكشف رقم صاحبه). يظل الشرط السابق: البائع فعّل واتساب أو زر الاتصال.
-- ---------------------------------------------------------------------
create or replace function public.get_property_contact_phone(p_property_id uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select p.phone_e164
  from public.properties prop
  join public.profiles p on p.id = prop.seller_id
  where prop.id = p_property_id
    and auth.uid() is not null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and (p.show_whatsapp = true or p.show_call_button = true)
    and (
      prop.seller_id = auth.uid()
      or public.admin_has_permission('reels')
      or (prop.moderation_status = 'approved' and prop.closed_at is null)
    )
  limit 1;
$$;
revoke all on function public.get_property_contact_phone(uuid) from public, anon;
grant execute on function public.get_property_contact_phone(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4) إيصالات Expo للإشعارات: send-push يسجّل ticket ids ويعالجها بعد ~15 دقيقة (DeviceNotRegistered ⇐ حذف التوكن الميت)
-- ---------------------------------------------------------------------
create table if not exists public.push_receipts (
  ticket_id text primary key,
  token text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_receipts_created_idx on public.push_receipts (created_at);
alter table public.push_receipts enable row level security;
revoke all on public.push_receipts from anon, authenticated;

notify pgrst, 'reload schema';
