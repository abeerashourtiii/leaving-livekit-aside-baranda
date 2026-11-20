-- ---------------------------------------------------------------------
-- ملحق الفحص B2 / B3 / B4 — قابل لإعادة التشغيل. (لا يعدّل أى migration قديم.)
-- ---------------------------------------------------------------------

-- إصدارات السياسات المعروفة على الخادم (B3أ). **عند رفع POLICIES_VERSION فى data/policies.ts أضف الإصدار الجديد هنا فى migration جديد**
-- (insert into public.policy_versions values ('21') on conflict do nothing) وإلا لن تُسجَّل موافقات الإصدار الجديد.
create table if not exists public.policy_versions (
  version text primary key,
  published_at timestamptz not null default now()
);
alter table public.policy_versions enable row level security;
revoke all on public.policy_versions from anon, authenticated;
insert into public.policy_versions (version) values ('20') on conflict do nothing;

-- علامات الهاتف (B3ج): الرقم غير مُتحقَّق منه بـ OTP، فلا يُعدّ موثّقًا (phone_verified=false دائمًا من العميل)،
-- وphone_conflict=true لو أُسقط رقم التسجيل لأنه مسجّل لحساب آخر (ليُبلَّغ المستخدم).
alter table public.profiles
  add column if not exists phone_verified boolean not null default false,
  add column if not exists phone_conflict boolean not null default false;

-- ---------------------------------------------------------------------
-- تحقق موحّد لكتابات profiles (إدراج/تعديل) — B2 + B3
--  • B2: تاريخ الميلاد: لا مستقبل ولا قبل 1900 ولا أقل من 18 سنة (يُفحص فقط عند الإدراج أو عند تغيير التاريخ، فلا يعطّل
--    تعديلات أخرى لحسابات قديمة). الخطأ: invalid_birth_date / under_18 (SQLSTATE 22023) والعميل يعرض رسالة عربية واضحة.
--  • B3ب: قصّ أطوال النصوص، وavatar_url لا يُقبل إلا من Google أو Cloudinary (عند الإدراج/التغيير)، وإلا يُهمَل.
--  • B3أ: policies_version لا يُقبل إلا إن كان إصدارًا معروفًا (عند الإدراج: يُهمَل بدل إفشال التسجيل؛ عند التعديل: خطأ صريح).
--  • B3ج: phone_verified لا يضبطه العميل (يُصفَّر عند تغيير الرقم)؛ الخدمة/لوحة Supabase (auth.uid() فارغ) غير مقيَّدة.
-- ---------------------------------------------------------------------
create or replace function public.profiles_validate_write()
returns trigger
language plpgsql
security definer set search_path = public
as $$
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

  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.phone_verified := false;
    else
      if new.phone_e164 is distinct from old.phone_e164 then
        new.phone_verified := false;
      else
        new.phone_verified := old.phone_verified;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_validate_write on public.profiles;
create trigger profiles_validate_write
  before insert or update on public.profiles
  for each row execute function public.profiles_validate_write();

-- handle_new_user: نفس منطق 20261010000000 + قصّ الأطوال + علامة تعارض الرقم (التحقق من العمر/avatar/السياسات فى trigger profiles أعلاه).
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
  v_conflict boolean := false;
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
  -- phone_e164 فريد: لو الرقم مستخدم فى حساب آخر نُسقطه ونعلّم phone_conflict ليُبلَّغ المستخدم (بدل أن يفشل التسجيل أو يختفى الرقم بصمت).
  if v_phone is not null and exists (select 1 from public.profiles where phone_e164 = v_phone) then
    v_phone := null;
    v_conflict := true;
  end if;
  v_accepted := nullif(m->>'policies_version', '') is not null;

  insert into public.profiles (
    id, full_name, avatar_url,
    first_name, last_name, birth_date, gender, nationality, residence,
    phone_e164, phone_country_code, phone_country_name,
    account_type, policies_accepted_at, policies_version, phone_conflict
  )
  values (
    new.id,
    left(coalesce(m->>'full_name', m->>'name'), 100),
    m->>'avatar_url',
    nullif(left(m->>'first_name', 60), ''),
    nullif(left(m->>'last_name', 60), ''),
    v_birth,
    v_gender,
    nullif(left(m->>'nationality', 8), ''),
    nullif(left(m->>'residence', 100), ''),
    v_phone,
    case when v_phone is not null then nullif(left(m->>'phone_country_code', 5), '') end,
    case when v_phone is not null then nullif(left(m->>'phone_country_name', 100), '') end,
    v_type,
    case when v_accepted then now() end,
    case when v_accepted then left(m->>'policies_version', 20) end,
    v_conflict
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- B4) سجل الدخول من الخادم
--     كان العميل يُدخل صفوف «login» بنفسه (user_name نص حر، details بلا حد، بلا حد معدل) وفى مسار Google على الموبايل فقط — قابل للتزييف
--     وناقص. الآن trigger على auth.users عند تغيّر last_sign_in_at (كل تسجيل دخول فعلى: بريد/Google ويب وموبايل) يشتق الاسم من profiles،
--     ولا يُسجَّل الضيف. فشل التسجيل لا يكسر الدخول. وتُسحب صلاحية الإدراج من العملاء.
-- ---------------------------------------------------------------------
create or replace function public.log_user_login()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  insert into public.user_activity_log (user_id, user_name, activity_type, details)
  select p.id, p.full_name, 'login', jsonb_build_object('provider', coalesce(new.raw_app_meta_data ->> 'provider', 'email'))
    from (select 1) s
    left join public.profiles p on p.id = new.id;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists on_auth_user_login on auth.users;
create trigger on_auth_user_login
  after update of last_sign_in_at on auth.users
  for each row
  when (old.last_sign_in_at is distinct from new.last_sign_in_at)
  execute function public.log_user_login();

drop policy if exists "users can log their own login" on public.user_activity_log;
revoke insert, update, delete on public.user_activity_log from anon, authenticated;

notify pgrst, 'reload schema';
