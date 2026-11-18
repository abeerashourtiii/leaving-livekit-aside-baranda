-- ملخص قائمة المحادثات: آخر رسالة + عدد غير المقروء لكل محادثة فى استعلام واحد خفيف.
-- قبلها كان التطبيق (fetchChatList) ينزّل *كل رسائل كل المحادثات* ثم يحسب آخر رسالة وغير المقروء فى الجهاز عند كل تحديث
-- (وكان محدودًا ضمنيًا بـ 1000 صف فى Supabase فتتخرّب الأرقام عند كثرة الرسائل).
-- security invoker: سياسات RLS الحالية على chats/chat_messages هى اللى تحدد المتاح (طرفا المحادثة فقط) — لا صلاحيات جديدة.
create or replace function public.chat_list_summary()
returns table (
  chat_id uuid,
  last_text text,
  last_sender_id uuid,
  last_at timestamptz,
  unread_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id as chat_id,
    lm.text as last_text,
    lm.sender_id as last_sender_id,
    lm.created_at as last_at,
    (
      select count(*) from public.chat_messages m
      where m.chat_id = c.id and m.read = false and m.sender_id <> auth.uid()
    ) as unread_count
  from public.chats c
  left join lateral (
    select m.text, m.sender_id, m.created_at
    from public.chat_messages m
    where m.chat_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where c.initiator_id = auth.uid() or c.partner_id = auth.uid();
$$;

revoke all on function public.chat_list_summary() from public, anon;
grant execute on function public.chat_list_summary() to authenticated;

-- يسرّع عدّ غير المقروء (الصفوف غير المقروءة قليلة دائمًا).
create index if not exists chat_messages_unread_idx
  on public.chat_messages (chat_id)
  where read = false;
