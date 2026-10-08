import { StyleProp, Text, TextStyle } from "react-native";

// ↔ نص الشارات (الكماليات والمرافق، طريقة الدفع، فلاتر البحث...): على أندرويد كان النص
// العربى متعدد الكلمات (مثل «عداد كهرباء» و«مطبخ مجهز») بيفقد الكلمة الأخيرة لما الشارة
// تتحدد (الخلفية خضراء والنص أبيض): الشارة بتفضل بعرضها الكامل لكن الكلمة التانية بتختفى.
// ده سلوك معروف فى نص أندرويد لما الـ layout الأصلى بيطلع أعرض بكسور قليلة من القياس
// فالسطر بيلتف لسطر تانى بيتقصّ برّه الارتفاع. الحل هنا بتلات حماية:
//   1) numberOfLines=1 + ellipsizeMode="clip": مفيش التفاف لسطر تانى أبدًا.
//   2) flexShrink:0 + حشو أفقى صغير (2) داخل النص يمتص فرق القياس.
//   3) key بيتغير مع حالة الاختيار: النص بيتعمل من جديد (remount) بدل تحديث لونه فوق
//      layout قديم، فالقياس بيتعاد بالخط واللون الجديدين.
type Props = {
  text: string;
  active: boolean;
  textStyle: StyleProp<TextStyle>;
  activeTextStyle: StyleProp<TextStyle>;
};

export function ChipLabel({ text, active, textStyle, activeTextStyle }: Props) {
  return (
    <Text
      key={active ? "on" : "off"}
      style={[active ? activeTextStyle : textStyle, { flexShrink: 0, paddingHorizontal: 2 }]}
      numberOfLines={1}
      ellipsizeMode="clip"
      textBreakStrategy="simple"
    >
      {text}
    </Text>
  );
}
