-- معاينة رابط المشاركة (Open Graph): دالة قراءة عامة تُرجع فقط البيانات المعلنة أصلًا للإعلان المنشور
-- (العنوان، وصف مختصر، النوع، المحافظة، السعر، الغلاف، قائمة الميديا) لاستخدامها في وسوم og:* التي تقرؤها
-- تطبيقات المراسلة (واتساب/فيسبوك/تليجرام/iMessage...) من رابط https://shahir.site/property/<id>/reel.
-- الزاحف لا يملك جلسة، فلا تصله سياسة RLS (to authenticated)؛ لذلك الدالة SECURITY DEFINER تُرجع jsonb محدّدًا
-- ولا تكشف أي بيانات للبائع (لا اسم ولا هاتف) ولا إعلانًا غير منشور أو مُغلقًا بصفقة أو مرفوضًا.
-- (تُرجع jsonb لتفادي خطأ اختلاف الأنواع varchar/text الذى ظهر سابقًا فى دوال admin_list_*).
create or replace function public.get_share_preview(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'title',       p.title,
    'short_title', p.short_title,
    'description', left(coalesce(p.description, ''), 300),
    'purpose',     p.purpose,
    'type',        p.type,
    'province',    p.province,
    'price',       p.price,
    'cover_image', p.cover_image,
    'media',       coalesce(p.media, '[]'::jsonb)
  )
  from public.properties p
  where p.id = p_property_id
    and p.moderation_status = 'approved'
    and p.closed_at is null
  limit 1;
$$;

revoke all on function public.get_share_preview(uuid) from public;
grant execute on function public.get_share_preview(uuid) to anon, authenticated;

comment on function public.get_share_preview(uuid) is
  'بيانات معاينة رابط مشاركة الإعلان المنشور فقط (Open Graph) — تُستدعى من Cloudflare Pages Function functions/property/[[path]].js.';
