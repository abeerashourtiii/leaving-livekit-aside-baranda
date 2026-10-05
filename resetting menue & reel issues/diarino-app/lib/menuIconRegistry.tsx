import { ImageSourcePropType } from "react-native";
import { Image } from "expo-image";
import Svg, { Path, Circle, Rect } from "react-native-svg";

// Real cropped photos/illustrations from the approved reference design
// (AI-generated, not anyone's copyrighted property — see chat) — used
// instead of the plain vector icons for these specific menu cards.
// Aspect ratio is preserved from the original crop so sizing stays
// faithful to the reference proportions; MenuCardIcon derives width from
// a target height using this ratio.
const MENU_CARD_IMAGES: Record<string, ImageSourcePropType> = {
  search_building: require("../assets/menu-icons/ref_search.png"),
  plus: require("../assets/menu-icons/ref_publish.png"),
  chat: require("../assets/menu-icons/ref_request.png"),
  scale: require("../assets/menu-icons/ref_scales.png"),
  live_signal: require("../assets/menu-icons/live.png"),
  building: require("../assets/menu-icons/ref_repoo.png"),
  crane_truck: require("../assets/menu-icons/ref_tow.png"),
  settings: require("../assets/menu-icons/ref_gears.png"),
  plumbing_electric: require("../assets/menu-icons/ref_plumbing.png"),
};

// ↔ الرسومات المرجعية (ref_*.png) — PNG بخلفية شفافة، بعضها مستخرج من
// تصميم القائمة المعتمد (المرجع) وبعضها صور أعلى دقة مرفوعة من صاحب
// المشروع (البيت، المبنى السكني). لو عندك نسخة أعلى دقة من أي رسمة،
// استبدل الملف بنفس الاسم (وحدّث النسبة تحت لو اختلفت) من غير أي تعديل كود.
const MENU_CARD_IMAGE_ASPECT: Record<string, number> = {
  search_building: 900 / 584,
  plus: 407 / 420,
  chat: 383 / 400,
  scale: 450 / 416,
  live_signal: 1,
  building: 600 / 769,
  crane_truck: 500 / 371,
  settings: 400 / 316,
  plumbing_electric: 650 / 574,
};

// ↔ بانر "مساحة إعلانية" الثابت (لما مفيش أي بانر فعلي من الأدمن). الصورة
// جاهزة بالكامل (PNG شفاف: الإطار الذهبي + النصوص + زر "اعرف المزيد" كلها
// مدمجة فيها)، فالكارت بيعرضها زي ما هي من غير أي نص بالكود فوقها.
// لو غيّرت الملف: حدّث النسبة (عرض ÷ ارتفاع) تحت لو اختلفت.
export const AD_PLACEHOLDER_IMAGE: ImageSourcePropType = require("../assets/menu-icons/ad-placeholder.png");
// نسخة إنجليزية بنفس التصميم والأبعاد (Ad Space / Place your ad here / Reach thousands daily / Learn More)
export const AD_PLACEHOLDER_IMAGE_EN: ImageSourcePropType = require("../assets/menu-icons/ad-placeholder-en.png");
export const AD_PLACEHOLDER_ASPECT = 1400 / 620;

// ↔ كارت Repoo الطويل: الصورة هي الكارت كله (الخلفية + "Repoo" + الرسمة +
// "للتشطيبات المتكاملة والديكور" + سطر الإنجاز + زر "اطلب عرض سعر")، مرسومة
// جاهزة فى PNG واحد — فالنصوص بتظهر كاملة بنفس الشكل بالظبط على الأندرويد
// والآيفون والويب والـ APK من غير أي اقتصاص أو اختلاف خطوط/RTL.
//   * ألوان "Rep" + جملة "للتشطيبات المتكاملة والديكور" + خلفية زر
//     "اطلب عرض سعر" = #D9CEB0 (217,206,176) بالظبط.
//   * الصورة مقصوصة جوه الإطار الذهبي، وخلفيتها لون واحد مسطّح =
//     REPOO_CARD_BG، والإطار الذهبي بيترسم من الكود (MenuCard) — فلو مساحة
//     الكارت نسبتها اختلفت عن نسبة الصورة، الفراغ بيتملي بنفس اللون من غير
//     أي خط فاصل ظاهر.
// لو استبدلت الملف: حدّث الأبعاد/اللون تحت (عرض ÷ ارتفاع).
export const REPOO_CARD_IMAGE: ImageSourcePropType = require("../assets/menu-icons/repoo_card.png");
// نسخة الإنجليزية: نفس التصميم/الألوان/المقاس بالظبط، والنصوص مترجمة داخل الصورة
// ("For Complete Finishing & Decor" / "Over 1K homes delivered" / "Request a Quote").
export const REPOO_CARD_IMAGE_EN: ImageSourcePropType = require("../assets/menu-icons/repoo_card_en.png");
export const REPOO_CARD_ASPECT = 954 / 1477;
export const REPOO_CARD_BG = "#151512";
export const REPOO_CARD_RIM = "#DDBF8E";

// ↔ كارت "ونش ونقل أثاث": نفس فكرة Repoo — الصورة هي الكارت كله (الرسمة + العنوان
// + "عرض سعر فوري")، ولون "عرض سعر فوري" (النص + إطار الزر) = #D9CEB0 بالظبط.
// الخلفية البنفسجية مسطّحة (#330356) فمفيش فرق بين الصورة ولون الكارت لو
// ظهر فراغ جانبي. نسخة إنجليزية بنفس التصميم: "Crane & Furniture Moving" /
// "Instant Quote".
export const CRANE_CARD_IMAGE: ImageSourcePropType = require("../assets/menu-icons/crane_card.png");
export const CRANE_CARD_IMAGE_EN: ImageSourcePropType = require("../assets/menu-icons/crane_card_en.png");
// عرض ÷ ارتفاع صورة الونش (1070×935) — صفحة القائمة بتستخدمها لحساب الارتفاع اللى بيخلّى
// الكارت يعرض الصورة كاملة بعرض العمود من غير ما تصغر (شوف menu.tsx).
export const CRANE_CARD_ASPECT = 1070 / 935;

// ↔ كروت القائمة اللى الصورة الجاهزة فيها هى الكارت كله (النصوص مدمجة جوه الصورة)،
// بالمفتاح icon_key. بتتفعّل لو الكارت من المقاس المحدد (sizes) ومن غير صورة
// مخصّصة مرفوعة من الأدمن. الصورة بتتعرض كاملة (contain) من غير اقتصاص.
//   * bg  : لون الكارت = لون خلفية الصورة المسطّح.
//   * rim : إطار يترسم من الكود (اختياري).
//   * labelEn/labelAr : وصف الوصول (accessibility).
//   * aspect : (اختياري) عرض ÷ ارتفاع الصورة. لو موجود، الكارت بياخد ارتفاعه من
//     عرضه بنفس نسبة الصورة بالظبط (الإطار الذهبي كله ظاهر من غير فراغات ولا
//     تمدد) بدل minHeight الثابت.
export type MenuArtCard = {
  ar: ImageSourcePropType; en: ImageSourcePropType; bg: string; rim?: string; aspect?: number;
  sizes: string[]; labelAr: string; labelEn: string;
};
// ↔ كارت "وكيلك القانوني": الصورة (الميزان + "وكيلك القانوني" + "استشارات قانونية
// عقارية متخصصة") هى الكارت كله بإطارها الذهبي، مقصوصة على حافة الإطار بالظبط،
// والزوايا برّا القوس متملّية بلون الإطار. نسخة إنجليزية بنفس التصميم:
// "Your Legal Agent" / "Specialized Real-Estate Legal Consultations".
export const LEGAL_CARD_IMAGE: ImageSourcePropType = require("../assets/menu-icons/legal_card.png");
export const LEGAL_CARD_IMAGE_EN: ImageSourcePropType = require("../assets/menu-icons/legal_card_en.png");
export const LEGAL_CARD_ASPECT = 1848 / 684;

// ↔ كارت "ابحث عن عقار": الصورة (العنوان + "اشتري واستأجر بسهولة سكني وتجاري" +
// المبنى) هى الكارت كله، مقصوصة على حافة الإطار بالظبط. لون سطرَي "اشتري
// واستأجر بسهولة / سكني وتجاري" = #D9CEB0 بالظبط. الخلفية لون واحد مسطّح
// (#193F43). نسخة إنجليزية بنفس التصميم: "Find a Property" / "Buy & Rent with
// Ease — Residential & Commercial". الكارت بياخد ارتفاعه من عرضه بنفس نسبة الصورة.
export const SEARCH_CARD_IMAGE: ImageSourcePropType = require("../assets/menu-icons/search_card.png");
export const SEARCH_CARD_IMAGE_EN: ImageSourcePropType = require("../assets/menu-icons/search_card_en.png");
export const SEARCH_CARD_ASPECT = 1037 / 1369;

// ↔ كارت "اطلب عقارك": الصورة (الحافظة + البيت + "اطلب عقارك" + "والعروض توصلك")
// مقصوصة جوه الإطار، وخلفيتها لون واحد مسطّح (#0D6972) = لون الكارت، والإطار
// بيترسم من الكود — فالصورة بتتعرض كاملة (contain) فى أى ارتفاع للكارت من غير
// فراغ ظاهر. لون "والعروض توصلك" = #D9CEB0 بالظبط. نسخة إنجليزية: "Request a
// Property" / "Offers come to you".
export const REQUEST_CARD_IMAGE: ImageSourcePropType = require("../assets/menu-icons/request_card.png");
export const REQUEST_CARD_IMAGE_EN: ImageSourcePropType = require("../assets/menu-icons/request_card_en.png");

// ↔ كارت "انشر عقارك": الصورة (البيت + "انشر عقارك" + "بدون أي رسوم") مقصوصة جوه
// الإطار، وخلفيتها لون واحد مسطّح (#4B6426) = لون الكارت، والإطار بيترسم من الكود
// (نفس فكرة "اطلب عقارك"). لون "بدون أي رسوم" = #D9CEB0 بالظبط. نسخة إنجليزية:
// "Publish Your Property" / "No fees".
export const PUBLISH_CARD_IMAGE: ImageSourcePropType = require("../assets/menu-icons/publish_card.png");
export const PUBLISH_CARD_IMAGE_EN: ImageSourcePropType = require("../assets/menu-icons/publish_card_en.png");

export const MENU_ART_CARDS: Record<string, MenuArtCard> = {
  plus: {
    ar: PUBLISH_CARD_IMAGE, en: PUBLISH_CARD_IMAGE_EN, bg: "#4B6426", rim: "#687C3E",
    sizes: ["half"],
    labelAr: "انشر عقارك — بدون أي رسوم",
    labelEn: "Publish Your Property — No fees",
  },
  chat: {
    ar: REQUEST_CARD_IMAGE, en: REQUEST_CARD_IMAGE_EN, bg: "#0D6972", rim: "#1E96A0",
    sizes: ["half"],
    labelAr: "اطلب عقارك — والعروض توصلك",
    labelEn: "Request a Property — Offers come to you",
  },
  search_building: {
    ar: SEARCH_CARD_IMAGE, en: SEARCH_CARD_IMAGE_EN, bg: "#193F43", aspect: SEARCH_CARD_ASPECT,
    sizes: ["tall"],
    labelAr: "ابحث عن عقار — اشتري واستأجر بسهولة سكني وتجاري",
    labelEn: "Find a Property — Buy & rent with ease, residential & commercial",
  },
  scale: {
    ar: LEGAL_CARD_IMAGE, en: LEGAL_CARD_IMAGE_EN, bg: "#EDD5AC", aspect: LEGAL_CARD_ASPECT,
    sizes: ["half", "wide", "full"],
    labelAr: "وكيلك القانوني — استشارات قانونية عقارية متخصصة",
    labelEn: "Your Legal Agent — Specialized real-estate legal consultations",
  },
  building: {
    ar: REPOO_CARD_IMAGE, en: REPOO_CARD_IMAGE_EN, bg: REPOO_CARD_BG, rim: REPOO_CARD_RIM,
    sizes: ["tall"],
    labelAr: "Repoo — للتشطيبات المتكاملة والديكور. اطلب عرض سعر",
    labelEn: "Repoo — Complete Finishing & Decor. Request a Quote",
  },
  crane_truck: {
    ar: CRANE_CARD_IMAGE, en: CRANE_CARD_IMAGE_EN, bg: "#330356",
    sizes: ["half", "tall", "wide", "full"],
    labelAr: "ونش ونقل أثاث — عرض سعر فوري",
    labelEn: "Crane & Furniture Moving — Instant Quote",
  },
};

// ↔ تحديد كارت الصورة-الجاهزة لعنصر قائمة: بالعنوان الأول (العناوين المعروفة للكروت الستة)
// وبعدين بمفتاح الأيقونة icon_key. بيرجّع null لو الكارت مش من الكروت دي أو مقاسه مش
// مناسب للتصميم. سبب مطابقة العنوان: صف Repoo فى قاعدة بيانات الإنتاج ممكن يكون
// icon_key بتاعه اتغيّر أو له صورة مخصّصة قديمة مرفوعة من لوحة الأدمن (كارت صورة بدون
// نص) — وده كان بيخلّى الكارت يظهر فاضى بلون الخلفية بدل التصميم الجديد.
export const MENU_ART_BY_TITLE: Record<string, string> = {
  "repoo": "building",
  "ونش ونقل أثاث": "crane_truck",
  "وكيلك القانوني": "scale",
  "ابحث عن عقار": "search_building",
  "اطلب عقارك": "chat",
  "انشر عقارك": "plus",
};

function normalizeTitle(title: string): string {
  return (title ?? "").replace(/[\u064B-\u065F\u0640]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function menuArtCardFor(item: { iconKey: string; title: string; size: string }): MenuArtCard | null {
  const byTitle = MENU_ART_BY_TITLE[normalizeTitle(item.title)];
  const art = (byTitle ? MENU_ART_CARDS[byTitle] : undefined) ?? MENU_ART_CARDS[item.iconKey];
  if (!art || !art.sizes.includes(item.size)) return null;
  return art;
}

// ↔ الرسومات المضمّنة اللى PNG شفاف بالكامل (من غير خلفية مدمجة). كارت
// "above" (ابحث عن عقار) بيعرضها كاملة (contain) من غير تدرّج إخفاء لأن
// مفيش خلفية تتخفّى — عكس الصور اللي بخلفية مدمجة (JPG / صور الأدمن).
const MENU_CARD_IMAGE_TRANSPARENT = new Set<string>(["search_building"]);

export function menuCardImageIsTransparent(iconKey: string): boolean {
  return MENU_CARD_IMAGE_TRANSPARENT.has(iconKey);
}

export function menuCardImageAspect(iconKey: string): number {
  return MENU_CARD_IMAGE_ASPECT[iconKey] ?? 1;
}

// ↔ "إدارة الحساب" card — explicitly a plain green human silhouette, not
// a photo (per the person's instruction), so this one key always renders
// as a solid-fill vector shape regardless of card color.
function GreenPersonIcon({ height }: { height: number }) {
  return (
    <Svg width={height} height={height} viewBox="0 0 24 24">
      <Circle cx={12} cy={8} r={4.2} fill="#22A652" />
      <Path d="M4 20.5c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="#22A652" />
    </Svg>
  );
}

// ↔ the menu page's per-card icon — a real image for the keys that have
// one (see MENU_CARD_IMAGES above), the green silhouette for the account
// card, or the plain vector icon (MenuIcon below) as a fallback for any
// other admin-chosen key.
export function MenuCardIcon({ iconKey, height = 56, color = "white" }: { iconKey: string; height?: number; color?: string }) {
  if (iconKey === "account_circle") return <GreenPersonIcon height={height} />;
  const source = MENU_CARD_IMAGES[iconKey];
  if (source) {
    const aspect = MENU_CARD_IMAGE_ASPECT[iconKey] ?? 1;
    // ↔ #2: expo-image (بدل Image الأساسي من react-native) بيدّي تحجيم
    // بجودة أعلى (GPU-accelerated resampling) + كاش على الديسك، فالأيقونة
    // بتظهر أوضح من غير أي تغيير فى الملفات نفسها — نفس مكوّن الصور
    // المستخدم فى باقي الشاشة (menu.tsx وReelCard.tsx).
    return (
      <Image
        source={source}
        style={{ height, width: height * aspect, borderRadius: 8 }}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
    );
  }
  return <MenuIcon iconKey={iconKey} size={height} color={color} />;
}

// ↔ raw source for cards that need full-bleed placement (cover-fit,
// no padding/contain-box) instead of the fixed-aspect icon box above —
// the tall "ابحث عن عقار" hero photo and the round "اطلع اللايف" button.
export function menuCardImageSource(iconKey: string): ImageSourcePropType | null {
  return MENU_CARD_IMAGES[iconKey] ?? null;
}

// ↔ backs the menu page's fully admin-manageable cards (public.menu_items).
// Since letting an admin type raw SVG path data would be both unsafe and
// impractical on a phone keyboard, icons are chosen from this curated set
// by key instead — still real customization (color/text/order/action are
// all free-form), just not arbitrary vector art.
export type MenuIconKey =
  | "search_building" | "plus" | "chat" | "scale" | "building" | "crane_truck"
  | "star" | "gift" | "home" | "heart" | "phone" | "tag" | "camera" | "briefcase"
  | "map_pin" | "users" | "megaphone" | "question"
  | "settings" | "account_circle" | "live_signal" | "plumbing_electric";

export const ICON_KEYS: MenuIconKey[] = [
  "search_building", "plus", "chat", "scale", "building", "crane_truck",
  "star", "gift", "home", "heart", "phone", "tag", "camera", "briefcase",
  "map_pin", "users", "megaphone", "question",
  "settings", "account_circle", "live_signal", "plumbing_electric",
];

export function MenuIcon({ iconKey, size = 32, color = "white" }: { iconKey: string; size?: number; color?: string }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none" as const, stroke: color, strokeWidth: 1.7 };
  switch (iconKey as MenuIconKey) {
    case "search_building":
      return (
        <Svg {...p}>
          <Path d="M6 22V4a1 1 0 011-1h10a1 1 0 011 1v18" strokeLinejoin="round" />
          <Path d="M2 22h20" strokeLinecap="round" />
          <Path d="M9 6h1.5M13.5 6H15M9 10h1.5M13.5 10H15M9 14h1.5M13.5 14H15" strokeLinecap="round" />
          <Path d="M10 22v-4a1 1 0 011-1h2a1 1 0 011 1v4" />
        </Svg>
      );
    case "plus":
      return <Svg {...p}><Path d="M12 5v14M5 12h14" /></Svg>;
    case "chat":
      return <Svg {...p}><Path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></Svg>;
    case "scale":
      return (
        <Svg {...p}>
          <Path d="M12 2v20M7.5 22h9" strokeLinecap="round" />
          <Path d="M4 6h16" strokeLinecap="round" />
          <Path d="M4 6l-2.6 5.2a2.8 2.8 0 005.2 0L4 6z" strokeLinejoin="round" />
          <Path d="M20 6l-2.6 5.2a2.8 2.8 0 005.2 0L20 6z" strokeLinejoin="round" />
          <Circle cx={12} cy={2.4} r={1} fill={color} stroke="none" />
        </Svg>
      );
    case "building":
      return <Svg {...p}><Path d="M3 21h18M5 21V8l7-4 7 4v13" /></Svg>;
    case "crane_truck":
      return (
        <Svg {...p}>
          <Path d="M2 16V10a1 1 0 011-1h6v7" strokeLinejoin="round" />
          <Path d="M9 12h4.5l3 3.5V16" strokeLinejoin="round" />
          <Path d="M2 16h1.5M17 16h1.5" strokeLinecap="round" />
          <Circle cx={6} cy={18} r={1.6} />
          <Circle cx={15.5} cy={18} r={1.6} />
          <Path d="M8 9V3.5h8" strokeLinecap="round" />
          <Path d="M16 3.5v3" strokeLinecap="round" />
        </Svg>
      );
    case "star":
      return <Svg {...p}><Path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8l-6.2 3.2 1.2-6.8-5-4.9 6.9-1z" /></Svg>;
    case "gift":
      return <Svg {...p}><Rect x={3} y={8} width={18} height={13} rx={1} /><Path d="M3 12h18M12 8v13M12 8c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3M12 8c1.7 0 3-1.3 3-3s-1.3-3-3-3" /></Svg>;
    case "home":
      return <Svg {...p}><Path d="M3 11l9-8 9 8" /><Path d="M5 10v10h14V10" /></Svg>;
    case "heart":
      return <Svg {...p}><Path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z" /></Svg>;
    case "phone":
      return <Svg {...p}><Path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3.1-8.7A2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .3 2 .7 3a2 2 0 01-.5 2.1L7.9 10.3a16 16 0 006 6l1.5-1.4a2 2 0 012.1-.5c1 .4 2 .6 3 .7a2 2 0 011.7 2z" /></Svg>;
    case "tag":
      return <Svg {...p}><Path d="M20.6 12l-8.6 8.6L2 10.6V2h8.6z" /><Circle cx={7} cy={7} r={1.5} fill={color} stroke="none" /></Svg>;
    case "camera":
      return <Svg {...p}><Path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><Circle cx={12} cy={13} r={4} /></Svg>;
    case "briefcase":
      return <Svg {...p}><Rect x={2} y={7} width={20} height={14} rx={2} /><Path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" /></Svg>;
    case "map_pin":
      return <Svg {...p}><Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><Circle cx={12} cy={10} r={3} /></Svg>;
    case "users":
      return <Svg {...p}><Path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><Circle cx={9} cy={7} r={4} /><Path d="M23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8" /></Svg>;
    case "megaphone":
      return <Svg {...p}><Path d="M3 11v3a1 1 0 001 1h2l4 5V6L6 11H4a1 1 0 00-1 1z" /><Path d="M15 8a4 4 0 010 7M18 5a8 8 0 010 13" /></Svg>;
    case "settings":
      return (
        <Svg {...p}>
          <Circle cx={12} cy={12} r={3} />
          <Path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21a2 2 0 11-4 0v-.2a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H3a2 2 0 110-4h.2a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.6V3a2 2 0 114 0v.2a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.6 1H21a2 2 0 110 4h-.2a1.7 1.7 0 00-1.6 1z" strokeLinejoin="round" />
        </Svg>
      );
    case "account_circle":
      return (
        <Svg {...p}>
          <Circle cx={12} cy={12} r={10} />
          <Circle cx={12} cy={10} r={3.2} />
          <Path d="M5.5 19a6.8 6.8 0 0113 0" />
        </Svg>
      );
    case "live_signal":
      return (
        <Svg {...p}>
          <Circle cx={5.5} cy={18.5} r={1.8} fill={color} stroke="none" />
          <Path d="M5 13a6.5 6.5 0 016.5 6.5M5 8a11.5 11.5 0 0111.5 11.5" strokeLinecap="round" />
        </Svg>
      );
    case "plumbing_electric":
      return (
        <Svg {...p}>
          <Path d="M3 6l4-3 3 3-4 4" strokeLinejoin="round" />
          <Path d="M6 7l9 9" />
          <Path d="M13 21l3-6h-2l3-6-6 7h2z" strokeLinejoin="round" fill={color} />
        </Svg>
      );
    case "question":
    default:
      return <Svg {...p}><Circle cx={12} cy={12} r={10} /><Path d="M9.5 9a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5M12 17h.01" /></Svg>;
  }
}
