// ↔ مقاس المساحة الإعلانية أعلى صفحة القائمة (مصدر واحد للحقيقة): الصندوق بيتعرض
// بعرض الصفحة كله وبنسبة ثابتة = نسبة صورة "ضع إعلانك هنا" الدائمة. أى إعلان يضيفه
// الأدمن لازم يطابق نفس النسبة عشان يظهر كامل بدون اقتصاص — قص الصورة داخل التطبيق
// (components/admin/ImageCropModal.tsx) بيثبّت النسبة دى، والمشرف اللى هيجهّز الصورة
// برّه التطبيق يعمل الصورة بالمقاس ده بالظبط.
export const AD_BANNER_WIDTH = 1400;
export const AD_BANNER_HEIGHT = 620;
export const AD_BANNER_ASPECT = AD_BANNER_WIDTH / AD_BANNER_HEIGHT; // ≈ 2.258 : 1
export const AD_BANNER_RATIO_LABEL = "70 : 31";
export const AD_BANNER_SPEC_TEXT = `${AD_BANNER_WIDTH} × ${AD_BANNER_HEIGHT} بكسل (نسبة ${AD_BANNER_RATIO_LABEL} ≈ 2.26 : 1)`;
