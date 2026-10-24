import { Audio } from "expo-av";
import { resolveMusicSource, MusicSource } from "./musicLibrary";
import { getMusicAsset } from "../data/music-tracks";

// ↔ `let currentReelMusic = null` + startReelMusic()/stopReelMusic() in
// app-viewer.html — there's only ever one reel's music playing at a time
// (switching reels stops the previous track), same as the original global.
// Kept as a plain module singleton rather than a hook since multiple
// ReelCards need to share and preempt the same playback slot.
//
// ↔ المكتبة الموسيقية + مزامنة المدة:
//   * المقطع بيتحدد باسمه (property.music) وبيتحل من المكتبة (Cloudinary أو المدمج) عبر resolveMusicSource.
//   * الموسيقى بتتكرر (isLooping) لو أقصر من الريل فتملأه بالكامل؛ ولو أطول بيرجّعها ReelCard لأولها مع كل لفّة للفيديو/
//     العرض التتابعى (restartReelMusic) فمدتها بتتضبط على مدة الريل. وبتتزامن مع تقدّم الفيديو عند التشغيل/التمرير.

let currentSound: Audio.Sound | null = null;
let currentReelId: string | null = null;
let currentDurationMs = 0;
// ↔ #4 (قايمة خيارات الريل — صوت الخلفية): بيتقرا وقت أي startReelMusic
// جديدة عشان الموسيقى تبدأ مكتومة لو المستخدم كاتم الصوت أصلاً، وبيتحدّث
// فوريًا لو المستخدم بدّل الكتم وهي شغالة (شوف setReelMusicMuted تحت).
let musicMuted = false;
// ↔ مستوى صوت الموسيقى الأساسى: 1 لوحدها (ريل صور)، وأقل لما بتشتغل مع صوت الفيديو الأصلى.
let baseVolume = 1;

async function loadSound(source: MusicSource, volume: number): Promise<Audio.Sound | null> {
  const attempt = async (src: number | { uri: string }) => {
    const { sound } = await Audio.Sound.createAsync(src, { isLooping: true, volume, shouldPlay: false });
    return sound;
  };
  try {
    return await attempt(typeof source === "number" ? source : { uri: source.uri });
  } catch {
    // ↔ تحويل Cloudinary (mp3 مضغوط) فشل → نجرّب الرابط الأصلى، وآخر حاجة المقطع المدمج الافتراضى.
    if (typeof source !== "number") {
      try {
        return await attempt({ uri: source.originalUri });
      } catch {
        /* ... */
      }
    }
    const fallback = getMusicAsset("Uplifting Corporate");
    try {
      return fallback ? await attempt(fallback) : null;
    } catch {
      return null;
    }
  }
}

export type StartMusicOptions = {
  // مستوى صوت الموسيقى (0..1) — أقل لما بتصاحب فيديو له صوته.
  volume?: number;
  // موضع بداية (ثوانى) من وقت الريل — الموسيقى بتبدأ من (الموضع % مدة المقطع) عشان تفضل متزامنة مع الفيديو.
  positionSec?: number;
};

export async function startReelMusic(reelId: string, trackName: string | null | undefined, opts: StartMusicOptions = {}) {
  if (currentReelId === reelId && currentSound) return; // already playing for this reel
  await stopReelMusic();

  const source = resolveMusicSource(trackName);
  if (!source) return;

  baseVolume = opts.volume ?? 1;
  // ↔ بنسجّل reelId الأول: لو ريل تانى بدأ أثناء تحميل المقطع، الأقدم بيتلغى (race).
  currentReelId = reelId;
  const sound = await loadSound(source, musicMuted ? 0 : baseVolume);
  if (!sound || currentReelId !== reelId) {
    sound?.unloadAsync().catch(() => {});
    return;
  }
  try {
    const status = await sound.getStatusAsync();
    currentDurationMs = status.isLoaded ? status.durationMillis ?? 0 : 0;
    if (opts.positionSec && opts.positionSec > 0 && currentDurationMs > 0) {
      await sound.setPositionAsync(Math.floor((opts.positionSec * 1000) % currentDurationMs));
    }
    await sound.playAsync();
    currentSound = sound;
  } catch {
    // ignore playback failures (e.g. silent mode edge cases) — non-critical background audio
    sound.unloadAsync().catch(() => {});
  }
}

// ↔ الفيديو/العرض التتابعى لفّ من الأول: الموسيقى ترجع لأولها (لو أطول من الريل بتتقطع، ولو أقصر بتتكرر).
export function restartReelMusic() {
  currentSound?.setPositionAsync(0).catch(() => {});
}

// ↔ المستخدم مرّر شريط الـ seek: الموسيقى تروح لنفس النقطة (متكررة على مدة المقطع).
export function seekReelMusic(positionSec: number) {
  if (!currentSound || currentDurationMs <= 0) return;
  currentSound.setPositionAsync(Math.floor((Math.max(0, positionSec) * 1000) % currentDurationMs)).catch(() => {});
}

// ↔ #4: بيغيّر مستوى الصوت للموسيقى الشغالة حاليًا فورًا (من غير ما
// يوقفها ويشغّلها تانى)، وبيسجّل الحالة عشان أي موسيقى تبدأ بعد كده
// (لريل تانى) تاخد نفس حالة الكتم على طول.
export function setReelMusicMuted(muted: boolean) {
  musicMuted = muted;
  currentSound?.setStatusAsync({ volume: muted ? 0 : baseVolume }).catch(() => {});
}

export async function stopReelMusic() {
  currentReelId = null;
  if (!currentSound) return;
  const sound = currentSound;
  currentSound = null;
  currentDurationMs = 0;
  try {
    // ↔ the 0.12s linear ramp-to-zero before disconnecting in stopReelMusic()
    await fadeOutAndStop(sound);
  } catch {
    // ignore
  }
}

async function fadeOutAndStop(sound: Audio.Sound) {
  const steps = 4;
  const stepMs = 30; // ~120ms total, matching the original's ramp duration
  for (let i = steps; i >= 0; i--) {
    try {
      await sound.setStatusAsync({ volume: (i / steps) * (musicMuted ? 0 : baseVolume) });
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  await sound.stopAsync().catch(() => {});
  await sound.unloadAsync().catch(() => {});
}

// ---------------------------------------------------------------------------
// معاينة مقطع (شاشة «انشر عقارك» ولوحة الأدمن): تشغيل مرة واحدة من غير تكرار، ومقطع واحد فى الوقت.
// ---------------------------------------------------------------------------
let previewSound: Audio.Sound | null = null;
let previewToken = 0;

export async function stopMusicPreview() {
  previewToken += 1;
  const sound = previewSound;
  previewSound = null;
  if (!sound) return;
  await sound.stopAsync().catch(() => {});
  await sound.unloadAsync().catch(() => {});
}

// onEnd بيتنده لما المقطع يخلص أو يتوقف (عشان الواجهة ترجّع زر ▶).
export async function startMusicPreview(source: MusicSource, onEnd: () => void): Promise<boolean> {
  await stopMusicPreview();
  const token = previewToken;
  Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
  const attempt = async (src: number | { uri: string }) => {
    const { sound } = await Audio.Sound.createAsync(src, { shouldPlay: true, volume: 1, isLooping: false }, (st) => {
      if (st.isLoaded && st.didJustFinish) onEnd();
    });
    return sound;
  };
  let sound: Audio.Sound | null = null;
  try {
    sound = await attempt(typeof source === "number" ? source : { uri: source.uri });
  } catch {
    if (typeof source !== "number") {
      try {
        sound = await attempt({ uri: source.originalUri });
      } catch {
        sound = null;
      }
    }
  }
  if (!sound) return false;
  if (token !== previewToken) {
    sound.unloadAsync().catch(() => {});
    return false;
  }
  previewSound = sound;
  return true;
}
