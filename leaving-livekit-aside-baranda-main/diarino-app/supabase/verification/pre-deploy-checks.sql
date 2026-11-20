-- فحوص قراءة فقط قبل النشر (لا تعدّل شيئًا). ليست migration (مجلد verification لا يُنفَّذ بـ `supabase db push`).
-- شغّلها فى SQL Editor أو psql بعد تطبيق كل الـ migrations حتى 20261116100001 (الاستعلام 3 يستخدم normalize_arabic_name من 20261116000002).
-- القرارات (سحب التوثيق، حسابات <18، حذف اليتيم) لك؛ هذا الملف يعرض الصفوف فقط.

-- ═══ 1) حسابات verified = true (التوثيق صار بيد الأدمن فقط بعد G1؛ راجع هل كل واحد منها موثَّق فعلًا) ═══
select p.id, p.full_name, u.email, p.account_type, p.verified, p.phone_verified, p.created_at
  from public.profiles p
  left join auth.users u on u.id = p.id
 where p.verified = true
 order by p.created_at;

-- ═══ 2) مستخدمون أقل من 18 سنة أو بتاريخ ميلاد غير صالح (الـ trigger يمنعهم عند الإدراج/تغيير التاريخ فقط، فالقدامى باقون) ═══
select p.id, p.full_name, u.email, p.birth_date,
       case when p.birth_date > current_date then 'تاريخ فى المستقبل'
            when p.birth_date < date '1900-01-01' then 'قبل 1900'
            else 'أقل من 18 سنة' end as problem,
       date_part('year', age(current_date, p.birth_date))::int as age_years,
       p.created_at
  from public.profiles p
  left join auth.users u on u.id = p.id
 where p.birth_date is not null
   and (p.birth_date > current_date
        or p.birth_date < date '1900-01-01'
        or age(current_date, p.birth_date) < interval '18 years')
 order by p.birth_date desc;

-- ═══ 3) known_provinces (جدول قديم: القائمة صارت مغلقة 27 محافظة ولا تُقرأ منه أى قيمة) — صفوف لا لزوم لها / مشبوهة ═══
with official(name) as (
  values ('القاهرة'), ('الجيزة'), ('الإسكندرية'), ('الدقهلية'), ('البحر الأحمر'), ('البحيرة'),
         ('الفيوم'), ('الغربية'), ('الإسماعيلية'), ('المنوفية'), ('المنيا'), ('القليوبية'),
         ('الوادي الجديد'), ('السويس'), ('أسوان'), ('أسيوط'), ('بني سويف'), ('بورسعيد'),
         ('دمياط'), ('الشرقية'), ('جنوب سيناء'), ('كفر الشيخ'), ('مطروح'), ('الأقصر'), ('قنا'),
         ('شمال سيناء'), ('سوهاج')
), norm_official as (
  select name, public.normalize_arabic_name(name) as n from official
)
select k.id, k.name, k.search_count, k.created_at,
       case
         when public.reel_comment_blocked_reason(k.name) is not null then 'يخالف فلتر الأرقام/الروابط'
         when k.name in (select name from official) then 'مطابق تمامًا لمحافظة رسمية (مكرر لا لزوم له)'
         when public.normalize_arabic_name(k.name) in (select n from norm_official) then 'محافظة رسمية بإملاء مختلف'
         else 'ليس محافظة مصرية فى القائمة (يتيم)'
       end as category,
       (k.search_count >= 3) as was_publicly_suggested
  from public.known_provinces k
 order by category, k.search_count desc, k.created_at;

-- ═══ 4) البث المباشر وأثر إغلاق الإدراج المباشر على lives (البند 7) ═══
-- 4أ) هل الميزة مفعّلة؟
select key, enabled from public.feature_flags where key = 'live';
-- 4ب) بثوث أُنشئت بالنسخ القديمة (اسم غرفة live_<uuid>_<timestamp>) مقابل الجديدة (live_<uuid>) آخر 90 يومًا.
select date_trunc('month', created_at)::date as month,
       count(*) filter (where room_name ~ '^live_[0-9a-f-]{36}_[0-9]+$') as created_by_old_clients,
       count(*) filter (where room_name ~ '^live_[0-9a-f-]{36}$') as created_by_new_clients,
       count(distinct host_id) as distinct_hosts
  from public.lives
 where created_at > now() - interval '90 days'
 group by 1 order by 1 desc;

-- ═══ 5) تسجيلات ما زالت بمسار قديم غير عشوائى (يُهجَّر بـ scripts/migrate-live-recordings.mjs) ═══
select count(*) as legacy_recording_paths
  from public.live_recording_private
 where recording_filepath is not null
   and recording_filepath !~ '^recordings/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$';

-- ═══ 6) أسماء المناطق التى أُخفيت تلقائيًا بعد M2 (تخالف فلتر الأرقام/الروابط) للمراجعة ═══
select id, province, name, created_at from public.known_regions where hidden = true order by created_at desc;

-- ═══ 7) صفوف تخالف القيود NOT VALID (القيود تُفرض على الكتابات الجديدة فقط؛ القديم المخالف يبقى حتى تنظّفه ثم تعمل VALIDATE) ═══
-- كل استعلام يجب أن يرجع 0 صف قبل الخطوة 8. الصف المخالف = يفشل شرط القيد (NULL يعدّ ناجحًا كما فى CHECK).
-- 7أ) deal_settings_fees_positive
select 'deal_settings_fees_positive' as constraint_name, d.*
  from public.deal_settings d
 where not (fee_egp > 0 and (fee_rent_egp is null or fee_rent_egp > 0));
-- 7ب) ad_banners_link_url_scheme
select 'ad_banners_link_url_scheme' as constraint_name, b.id, b.title, b.link_url
  from public.ad_banners b
 where not (link_url is null or link_url ~* '^(https://|tel:|mailto:)');
-- 7ج) menu_items_url_scheme
select 'menu_items_url_scheme' as constraint_name, m.id, m.title, m.action_type, m.action_value
  from public.menu_items m
 where not (action_type <> 'url' or action_value ~* '^(https://|tel:|mailto:)');
-- 7د) social_share_links_https
select 'social_share_links_https' as constraint_name, s.*
  from public.social_share_links s
 where not (url = '' or url ~* '^https://');
-- 7هـ) sponsored_reels_targeting_check (عمر ≥ 18، أدنى ≤ أقصى، هدف > 0)
select 'sponsored_reels_targeting_check' as constraint_name, r.id, r.property_id, r.age_min, r.age_max, r.reach_goal, r.active
  from public.sponsored_reels r
 where not (
        (age_min is null or age_min >= 18)
    and (age_max is null or (age_max >= 18 and age_max <= 100))
    and (age_min is null or age_max is null or age_max >= age_min)
    and (reach_goal is null or reach_goal > 0));
-- 7و) sponsored_reels_has_limit_check (حد واحد على الأقل: هدف وصول أو تاريخ انتهاء) — الصفوف النشطة بلا نهاية هى الأخطر
select 'sponsored_reels_has_limit_check' as constraint_name, r.id, r.property_id, r.placement, r.active, r.start_date, r.end_date, r.reach_goal
  from public.sponsored_reels r
 where reach_goal is null and end_date is null
 order by r.active desc, r.start_date;

-- ═══ 8) VALIDATE CONSTRAINT — شغّل هذه الأوامر فقط بعد أن ترجع الاستعلامات 7أ–7و صفر صف (نظّف أو عدّل الصفوف أولًا). ═══
-- VALIDATE يمسح الجدول مرة واحدة بقفل SHARE UPDATE EXCLUSIVE (لا يمنع القراءة/الكتابة العادية)، وبعده يصير القيد «موثَّقًا» على كل الصفوف.
-- (أزل علامة التعليق من الأسطر الستة بعد التنظيف.)
-- alter table public.deal_settings    validate constraint deal_settings_fees_positive;
-- alter table public.ad_banners       validate constraint ad_banners_link_url_scheme;
-- alter table public.menu_items       validate constraint menu_items_url_scheme;
-- alter table public.social_share_links validate constraint social_share_links_https;
-- alter table public.sponsored_reels  validate constraint sponsored_reels_targeting_check;
-- alter table public.sponsored_reels  validate constraint sponsored_reels_has_limit_check;
-- للتحقق من الحالة بعدها:
-- select conname, convalidated from pg_constraint where conname in ('deal_settings_fees_positive','ad_banners_link_url_scheme','menu_items_url_scheme','social_share_links_https','sponsored_reels_targeting_check','sponsored_reels_has_limit_check');
