import { ReactNode, useEffect, useMemo, useState } from "react";
import { StyleProp, ImageStyle } from "react-native";
import { Image } from "expo-image";
import { cldImageCandidates } from "../../lib/cloudinary";

// ↔ صورة بسلسلة محاولات: لو تحميل أى رابط فشل (خطأ شبكة، Cloudinary رفض التحويل، ملف فيديو اتخزّن بالغلط…)
// بنجرّب الرابط التالى بدل ما المكان يفضل فاضى/أسود، وآخر حاجة بنعرض fallback (ومعاه onAllFailed).
// الترتيب فى cldImageCandidates (lib/cloudinary.ts).
export function CascadeImage({
  url, width = 1200, style, contentFit = "cover", transition = 200, fallback, onAllFailed,
}: {
  url: string | null | undefined;
  width?: number;
  style?: StyleProp<ImageStyle>;
  contentFit?: "cover" | "contain";
  transition?: number;
  fallback?: ReactNode;
  onAllFailed?: () => void;
}) {
  const candidates = useMemo(() => cldImageCandidates(url, width), [url, width]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setAttempt(0); }, [url, width]);

  const exhausted = attempt >= candidates.length;
  useEffect(() => { if (exhausted) onAllFailed?.(); }, [exhausted]); // eslint-disable-line react-hooks/exhaustive-deps

  if (exhausted) return <>{fallback ?? null}</>;
  return (
    <Image
      key={attempt}
      source={{ uri: candidates[attempt] }}
      style={style}
      contentFit={contentFit}
      transition={transition}
      onError={() => {
        if (__DEV__) console.warn("[CascadeImage] failed, trying next source:", candidates[attempt]);
        setAttempt((a) => a + 1);
      }}
    />
  );
}
