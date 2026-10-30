import { Platform } from "react-native";

// ↔ اختيار ملف صوتى (mp3 / m4a / wav / aac ...) لإضافته للمكتبة الموسيقية من لوحة الأدمن.
//   الويب: عنصر <input type=file> عادى. أندرويد/آيفون: expo-document-picker (مكتبة native — لازم تتثبّت وتتبنى فى نسخة
//   التطبيق: `npx expo install expo-document-picker` ثم build جديد). فى نسخة قديمة مبنيّة من غيرها بنرجّع "unsupported"
//   بدل ما التطبيق ينهار، واللوحة بتوضّح للأدمن إنه يرفع من الويب أو يحدّث التطبيق.
export type PickedAudio = { uri: string; name: string; size: number | null };

export async function pickAudioFile(): Promise<PickedAudio | "cancelled" | "unsupported"> {
  if (Platform.OS === "web") {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*,.mp3,.m4a,.aac,.wav,.ogg";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve("cancelled");
        resolve({ uri: URL.createObjectURL(file), name: file.name, size: file.size });
      };
      // ↔ لو المستخدم قفل نافذة الاختيار من غير اختيار، المتصفحات الحديثة بتبعت cancel.
      input.addEventListener("cancel", () => resolve("cancelled"));
      input.click();
    });
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const DocumentPicker = require("expo-document-picker");
    const res = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.[0]) return "cancelled";
    const a = res.assets[0];
    return { uri: a.uri, name: a.name ?? "track", size: typeof a.size === "number" ? a.size : null };
  } catch {
    return "unsupported";
  }
}
