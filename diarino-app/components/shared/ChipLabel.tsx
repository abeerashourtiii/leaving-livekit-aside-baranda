import { StyleProp, StyleSheet, Text, TextStyle, View } from "react-native";

// ↔ نص الشارات (الكماليات والمرافق، الجنس «ذكر/أنثى»، طريقة الدفع، نوع الحساب، فلاتر البحث...).
// العطل (على أندرويد/APK): بعد اختيار الشارة (خلفية خضراء + نص أبيض) بيختفى آخر حرف/كلمة من النص: «ذكر» بتبقى «ذك»
// و«مطبخ مجهز» بتبقى «مطبخ». الشارة نفسها بتفضل بعرض النص الكامل، بس النص المرسوم جوّاها بيتقصّ — يعنى
// اللى بيتحدّث عند تغيير الاختيار هو *رسم النص*: لما خصائص الـ Text (لونه) بتتغيّر على نفس الـ view، أندرويد
// بيعيد استخدام layout قديم أضيق. محاولات تغيير الـ layout (numberOfLines/key/حشو) ما كفتش لأن المشكلة فى
// التحديث نفسه.
//
// الحل الجذرى: **مفيش تحديث للنص أصلًا**. بنرسم نسختين ثابتتين من النص فوق بعض: واحدة بلون الشارة العادية
// وواحدة بلون الشارة المختارة، وكل اللى بيتغيّر عند الاختيار هو opacity (شفافية) — الـ Text نفسهم props بتاعتهم
// ثابتة دايمًا فمفيش إعادة layout ولا رسم قديم. النسخة المختارة بتاخد نفس حجم/وزن خط النسخة العادية بالظبط
// (فمقاسهم متطابق) وبتتحط فوقها بالحجم نفسه، والشارة بتتحدد بعرض النسخة العادية (اللى كانت بتظهر سليمة دايمًا).
type Props = {
  text: string;
  active: boolean;
  textStyle: StyleProp<TextStyle>;
  activeTextStyle: StyleProp<TextStyle>;
};

export function ChipLabel({ text, active, textStyle, activeTextStyle }: Props) {
  const base = StyleSheet.flatten(textStyle) ?? {};
  // ↔ نفس مقاييس الخط للنسختين (الحجم/الوزن/العائلة/تباعد الحروف) عشان تتطابق تمامًا.
  const metrics: TextStyle = {
    fontSize: base.fontSize,
    fontWeight: base.fontWeight,
    fontFamily: base.fontFamily,
    letterSpacing: base.letterSpacing,
    lineHeight: base.lineHeight,
    textAlign: "center",
  };
  return (
    <View style={styles.wrap}>
      <Text
        style={[textStyle, metrics, styles.pad, { opacity: active ? 0 : 1 }]}
        importantForAccessibility={active ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={active}
      >
        {text}
      </Text>
      <Text
        style={[activeTextStyle, metrics, styles.pad, styles.overlay, { opacity: active ? 1 : 0, pointerEvents: "none" }]}
        importantForAccessibility={active ? "auto" : "no-hide-descendants"}
        accessibilityElementsHidden={!active}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  // حشو أفقى صغير احتياطى يتشارك فيه النسختين بنفس القيمة.
  pad: { paddingHorizontal: 4 },
  overlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
});
