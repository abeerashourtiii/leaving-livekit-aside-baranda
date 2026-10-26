-- supabase/migrations/20261005000000_seller_notification_subscriptions.sql
--
-- جرس الإشعارات فى صفحة المعلن بقى *مستقل تمامًا عن المتابعة*.
--
-- قبل كده: الجرس كان عمود follows.notify (القيمة الافتراضية true)، فكل متابعة بتشغّل الإشعارات تلقائيًا،
-- وتفعيل الجرس بيعمل متابعة (upsert على follows)، وإلغاء المتابعة بيمسح صف الجرس معاها.
-- دلوقتى: جدول مستقل بيحفظ "مين مفعّل إشعارات إعلانات مين". تفعيل الجرس مايعملش متابعة، والمتابعة ما بتشغّلش
-- الجرس، وإلغاء المتابعة ما بيطفّيهوش. والمعلن لما ينشر إعلان جديد، اللى مفعّلين الجرس بس (متابعين أو لأ)
-- بيوصلهم إشعار.

create table if not exists public.seller_notification_subscriptions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, seller_id),
  constraint seller_notification_no_self check (user_id <> seller_id)
);

create index if not exists seller_notification_subscriptions_seller_idx
  on public.seller_notification_subscriptions(seller_id);

alter table public.seller_notification_subscriptions enable row level security;

-- الاشتراك خاص بصاحبه: يشوف ويفعّل ويلغى اشتراكاته هو بس.
drop policy if exists "users read their own seller notification subscriptions" on public.seller_notification_subscriptions;
create policy "users read their own seller notification subscriptions"
  on public.seller_notification_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users subscribe as themselves" on public.seller_notification_subscriptions;
create policy "users subscribe as themselves"
  on public.seller_notification_subscriptions for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users unsubscribe their own" on public.seller_notification_subscriptions;
create policy "users unsubscribe their own"
  on public.seller_notification_subscriptions for delete
  to authenticated
  using (user_id = auth.uid());

-- الحفاظ على الوضع الحالى: اللى جرسهم شغّال النهاردة (follows.notify = true) يفضلوا مفعّلين.
insert into public.seller_notification_subscriptions (user_id, seller_id)
select f.follower_id, f.followee_id
from public.follows f
where f.notify = true
on conflict do nothing;

-- إشعار الإعلان الجديد: بقى بيروح لمشتركى الجرس (مش للمتابعين)، وبرضه بيحترم تفضيل المستلم notify_follows.
create or replace function public.handle_new_listing_notify()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (recipient_id, actor_id, category, text, property_id)
  select s.user_id, new.seller_id, 'follow', 'نشر إعلانًا جديدًا: ' || coalesce(new.title, ''), new.id
  from public.seller_notification_subscriptions s
  join public.profiles p on p.id = s.user_id
  where s.seller_id = new.seller_id
    and coalesce(p.notify_follows, true) = true;
  return new;
end;
$$;
