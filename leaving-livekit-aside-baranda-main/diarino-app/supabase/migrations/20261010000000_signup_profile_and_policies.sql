-- supabase/migrations/20261010000000_signup_profile_and_policies.sql
--
-- 1) موافقة المستخدم على الشروط والسياسات (شروط الاستخدام + سياسة الخصوصية + سياسة البيع): وقت الموافقة وإصدار
--    السياسات (data/policies.ts → POLICIES_VERSION). بتتسجّل من شاشة إكمال بيانات حساب جوجل (update على صف
--    اليوزر نفسه، تغطيها سياسة "users can update their own profile") ومن إنشاء الحساب بالبريد (من الـ trigger تحت).
-- 2) إنشاء حساب بالبريد بنفس بيانات شاشة تعديل بيانات الحساب: التطبيق بيبعتها فى user_metadata مع signUp
--    (لأن مفيش جلسة لحد ما البريد يتفعّل)، والـ trigger handle_new_user بينقلها لصف profiles. التحويلات
--    محصّنة: أى قيمة غلط (تاريخ، نوع حساب، رقم هاتف مكرر...) بتتجاهل ومبتفشّلش التسجيل.

alter table public.profiles
  add column if not exists policies_accepted_at timestamptz,
  add column if not exists policies_version text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_birth date;
  v_type text;
  v_gender text;
  v_phone text;
  v_accepted boolean;
begin
  begin
    v_birth := nullif(m->>'birth_date', '')::date;
  exception when others then
    v_birth := null;
  end;
  v_type := case when m->>'account_type' in ('individual', 'developer', 'broker') then m->>'account_type' end;
  v_gender := case when m->>'gender' in ('male', 'female') then m->>'gender' end;
  v_phone := nullif(left(m->>'phone_e164', 20), '');
  -- phone_e164 فريد: لو الرقم مستخدم فى حساب تانى منسجّلوش (بدل ما التسجيل كله يفشل).
  if v_phone is not null and exists (select 1 from public.profiles where phone_e164 = v_phone) then
    v_phone := null;
  end if;
  v_accepted := nullif(m->>'policies_version', '') is not null;

  insert into public.profiles (
    id, full_name, avatar_url,
    first_name, last_name, birth_date, gender, nationality, residence,
    phone_e164, phone_country_code, phone_country_name,
    account_type, policies_accepted_at, policies_version
  )
  values (
    new.id,
    coalesce(m->>'full_name', m->>'name'),
    m->>'avatar_url',
    nullif(m->>'first_name', ''),
    nullif(m->>'last_name', ''),
    v_birth,
    v_gender,
    nullif(left(m->>'nationality', 8), ''),
    nullif(m->>'residence', ''),
    v_phone,
    case when v_phone is not null then nullif(left(m->>'phone_country_code', 5), '') end,
    case when v_phone is not null then nullif(left(m->>'phone_country_name', 100), '') end,
    v_type,
    case when v_accepted then now() end,
    case when v_accepted then left(m->>'policies_version', 20) end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
