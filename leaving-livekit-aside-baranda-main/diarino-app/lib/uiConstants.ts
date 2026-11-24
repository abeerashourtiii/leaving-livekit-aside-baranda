import { createContext, useContext, useRef } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { usePiPActive } from "./pipState";

// ↔ يعكس بالظبط قيم app/(tabs)/_floating-tab-bar.tsx: `bottom: insets.bottom + 14`
// و`BAR_H = 52` (ارتفاع الشريط الفعلي). ⚠ إصلاح: كانت القيمة هنا 32 (أقل من الارتفاع الحقيقي 52 بـ 20dp)
// فكانت منطقة لمس شريط الـ seek تتداخل مع شريط المهام السفلي ويصعب سحبه — لازم تفضل مطابقة لـ BAR_H. أي شاشة عندها محتوى
// عائم (position: absolute) قريب من أسفل الشاشة ولازم مايتغطّاش بشريط
// المهام العائم لازم تستخدم FLOATING_TAB_BAR_CLEARANCE بدل رقم ثابت
// عشوائي، عشان لو الشريط اتغيّر مقاسه فى مكان واحد يفضل الحساب هنا صح.
export const FLOATING_TAB_BAR_MARGIN = 14;
export const FLOATING_TAB_BAR_HEIGHT = 52;
export const FLOATING_TAB_BAR_CLEARANCE = FLOATING_TAB_BAR_MARGIN + FLOATING_TAB_BAR_HEIGHT;

// ↔ #2 (صفحة الريلز): الفجوة الصغيرة بين شريط الـ seek وأعلى شريط المهام
// العائم — بدونها الشريطين بيبانوا ملزّقين فى بعض من غير أي هامش.
export const REEL_SEEK_BAR_GAP = 6;

// ↔ إصلاح: كل كارت ريل لازم ياخد ارتفاع الشاشة الكامل بالظبط (fullscreen
// حقيقي زي تيك توك/ريلز) — مش ارتفاع مُنقّص. قبل كده كان useReelHeight()
// بينقص مساحة شريط المهام العائم من ارتفاع الكارت نفسه، فكان الـ FlatList
// (اللي بياخد كل مساحة الشاشة flex:1) بيسيب فراغ فاضي أسفل كل كارت بمقدار
// المساحة المنقوصة دي، والكارت اللي بعده كان يظهر جزء منه جوه الفراغ ده —
// يعني عند التنقل بين الريلز كان بيبان جزء من الريل التانى (فوق/تحت) جوه
// نفس الشاشة، والأيقونات بتاعته بتتداخل مع أيقونات الريل النشط. الحل:
// الكارت نفسه (وبالتالي عنصر الـ FlatList) بياخد ارتفاع الشاشة بالكامل —
// كده مفيش أي جزء من ريل تانى يبان أبدًا. عشان نسيب مساحة لشريط المهام
// العائم فوق الريل، العناصر التفاعلية السفلية بس (شريط الـ seek/أيقونات
// الجانب/كارت الوصف) هي اللي بتاخد padding/bottom إضافي — مش الكارت كله.
// ↔ ⚠ إصلاح جذرى لشريط الـ seek (والوصف وأزرار الجانب) اللى كان يظهر *تحت* شريط التنقل على أندرويد:
// `useWindowDimensions().height` على أندرويد (شريط تنقل نظام ثلاثى الأزرار/غير شفاف) أكبر من المساحة المرئية الفعلية للتطبيق بمقدار
// ارتفاع شريط تنقل النظام (≈47dp على هاتف المستخدم)، فكان كارت الريل أطول من الشاشة المرئية ويُقصّ جزؤه السفلى تحت شريط النظام،
// وكل العناصر المثبّتة بـ bottom (seek/وصف/أيقونات) تنزل نفس المقدار فتغطيها حبّة شريط التنقل العائم (الذى يتموضع صح بالنسبة للمساحة المرئية).
// الارتفاع الحقيقى للمساحة المرئية = إطار SafeAreaProvider (useSafeAreaFrame: يقاس من الـ root view نفسه). نستخدم الأصغر بين الاثنين،
// ونتجاهل الانكماش الكبير للإطار (الكيبورد: adjustResize يصغّر الـ root view) كى لا ينكمش الكارت عند الكتابة؛
// وإذا تغيّر ارتفاع النافذة (دوران/تقسيم شاشة/شريط عنوان متصفح الويب) نعيد القياس. آيفون/ويب: الإطار = النافذة فلا تغيّر.
const reelViewport = { win: 0, frame: 0 };

// ↔ الـ Modal (مثل SponsoredAdReelModal) نافذة مستقلة بـ statusBarTranslucent تغطى الشاشة كلها، فارتفاعها = ارتفاع النافذة لا إطار الـ root:
// هناك نستخدم قيمة النافذة كما كانت (لا فجوة سوداء أسفل المودال). الافتراضى "frame" لشاشات التطبيق العادية (تبويب الريلز وشاشة الريل).
export type ReelHeightSource = "frame" | "window";
export const ReelHeightSourceContext = createContext<ReelHeightSource>("frame");

export function useReelHeight(): number {
  const { height } = useWindowDimensions();
  const frame = useSafeAreaFrame();
  const source = useContext(ReelHeightSourceContext);
  if (reelViewport.win !== height) {
    reelViewport.win = height;
    reelViewport.frame = 0;
  }
  // آخر قيمة معقولة للإطار (≥ 80% من النافذة: أشرطة النظام لا تتجاوز ~15%)؛ أى انكماش أكبر هو الكيبورد (adjustResize) فنتجاهله.
  // لا نستخدم "أكبر قيمة" لأن القيمة الأولية للإطار قد تأتى خاطئة (أكبر) قبل أول قياس فعلى.
  if (frame.height >= height * 0.8) reelViewport.frame = frame.height;
  const visible = source === "frame" && reelViewport.frame > 0 ? Math.min(height, Math.round(reelViewport.frame)) : height;
  // ↔ أثناء PiP نافذة النظام بتصغّر الشاشة، فبنثبّت آخر ارتفاع طبيعى — غير كده الـ FlatList
  // (pagingEnabled + getItemLayout) بتعيد حساب مكانها وبتقفز لريل تانى والنافذة العائمة تفقد الريل.
  const pip = usePiPActive();
  const normalHeight = useRef(visible);
  if (!pip) normalHeight.current = visible;
  return pip ? normalHeight.current : visible;
}

// ↔ المسافة اللي لازم تتحط bottom offset بيها لأي عنصر تفاعلي عائم جوه
// كارت الريل (شريط الـ seek بشكل مباشر) عشان يوقف فوق شريط المهام العائم
// بالظبط بمسافة REEL_SEEK_BAR_GAP، من غير ما يتغطّى أو يتلزّق بيه — ده
// اللي بيحقق الترتيب المطلوب من تحت لفوق: شريط المهام بتاع الهاتف، بعدين
// شريط المهام بتاع التطبيق، بعدين شريط الـ seek.
export function useReelControlsBottomOffset(): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + FLOATING_TAB_BAR_CLEARANCE + REEL_SEEK_BAR_GAP;
}
