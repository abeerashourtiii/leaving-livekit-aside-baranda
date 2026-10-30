import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { MUSIC_TRACK_ASSETS, getMusicAsset } from "../data/music-tracks";

// ↔ المكتبة الموسيقية للإعلانات. مصدر الحقيقة جدول public.music_tracks (migration 20261011000000): بيانات وصفية بس،
// والملفات الصوتية على Cloudinary (مش على Supabase Storage). المقاطع الخمسة المدمجة فى التطبيق (assets/music) بتظهر
// كصفوف builtin_key. لو الجدول لسه مش موجود (migration ما اتطبّقتش) أو الشبكة وقعت، بنرجع للمقاطع المدمجة الخمسة.
export type MusicTrack = {
  id: string;
  title: string; // = قيمة property.music المحفوظة مع الإعلان
  description: string | null;
  url: string | null; // رابط Cloudinary الأصلى (null للمدمج)
  publicId: string | null;
  builtinKey: string | null;
  durationSec: number | null;
  sortOrder: number;
  active: boolean;
  // ↔ مصدر الموسيقى ومرجع إثبات الترخيص (docs/licenses) — بيتحمّل فى لوحة الأدمن بس، مش للمستخدمين.
  licenseNote?: string | null;
};

// ↔ ملف الصوت بيتسلّم من Cloudinary مضغوط: mp3 بمعدل 96kbps (تحويل وقت العرض بالرابط — مفيش نسخ إضافية بتتخزّن).
// الأصل بيفضل زى ما اترفع، فلو التحويل فشل لأى سبب المشغّل بيرجع للرابط الأصلى (musicPlayer.ts).
export function musicDeliveryUrl(url: string): string {
  if (!/res\.cloudinary\.com/.test(url) || !url.includes("/video/upload/")) return url;
  return url.replace("/video/upload/", "/video/upload/br_96k/").replace(/\.[a-z0-9]+(\?.*)?$/i, ".mp3$1");
}

export type MusicSource = number | { uri: string; originalUri: string };

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  "Uplifting Corporate": "موسيقى حماسية",
  "Chill Lounge": "هادئة وعصرية",
  "Acoustic Morning": "جيتار هادئ",
  "Oriental Vibes": "شرقية خفيفة",
  "Modern Beat": "إيقاع عصري",
};

export const BUILTIN_TRACKS: MusicTrack[] = Object.keys(MUSIC_TRACK_ASSETS).map((key, i) => ({
  id: `builtin-${key}`,
  title: key,
  description: BUILTIN_DESCRIPTIONS[key] ?? null,
  url: null,
  publicId: null,
  builtinKey: key,
  durationSec: null,
  sortOrder: (i + 1) * 10,
  active: true,
}));

// ↔ نسخة فى الذاكرة لآخر مكتبة اتحمّلت — بيقراها مشغّل الموسيقى (مش هوك) وقت تشغيل أى ريل.
let cachedTracks: MusicTrack[] = BUILTIN_TRACKS;
export function setCachedMusicTracks(tracks: MusicTrack[]) {
  cachedTracks = tracks.length > 0 ? tracks : BUILTIN_TRACKS;
}

export function resolveMusicSource(title: string | null | undefined, tracks: MusicTrack[] = cachedTracks): MusicSource | null {
  if (!title) return null;
  const track = tracks.find((t) => t.title === title);
  if (track?.url) return { uri: musicDeliveryUrl(track.url), originalUri: track.url };
  if (track?.builtinKey && MUSIC_TRACK_ASSETS[track.builtinKey]) return MUSIC_TRACK_ASSETS[track.builtinKey];
  return getMusicAsset(title);
}

type MusicRow = {
  id: string; title: string; description: string | null; url: string | null; public_id: string | null;
  builtin_key: string | null; duration_sec: number | string | null; sort_order: number; active: boolean;
  license_note?: string | null;
};

function rowToTrack(r: MusicRow): MusicTrack {
  return {
    id: r.id, title: r.title, description: r.description, url: r.url, publicId: r.public_id, builtinKey: r.builtin_key,
    durationSec: r.duration_sec == null ? null : Number(r.duration_sec), sortOrder: r.sort_order, active: r.active,
    licenseNote: r.license_note ?? null,
  };
}

const COLUMNS = "id, title, description, url, public_id, builtin_key, duration_sec, sort_order, active";

async function fetchTracks(onlyActive: boolean): Promise<MusicTrack[]> {
  // ↔ license_note للأدمن فقط (onlyActive=false) — المستخدم العادى مش محتاجه.
  let q = supabase.from("music_tracks").select(onlyActive ? COLUMNS : `${COLUMNS}, license_note`).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
  if (onlyActive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown as MusicRow[]).map(rowToTrack);
}

// ↔ المكتبة الظاهرة للمستخدمين (النشطة فقط). بتحدّث نسخة الذاكرة تلقائيًا.
export function useMusicLibrary(): { tracks: MusicTrack[]; isLoading: boolean } {
  const q = useQuery({
    queryKey: ["musicLibrary", "active"],
    queryFn: async () => {
      const tracks = await fetchTracks(true);
      setCachedMusicTracks(tracks);
      return tracks;
    },
    staleTime: 10 * 60_000,
    retry: 1,
  });
  return { tracks: q.data ?? BUILTIN_TRACKS, isLoading: q.isLoading };
}

// ↔ لوحة الأدمن: كل المقاطع (نشطة وغير نشطة).
export function useAllMusicTracks() {
  return useQuery({
    queryKey: ["musicLibrary", "all"],
    queryFn: () => fetchTracks(false),
    staleTime: 5_000,
  });
}

export function useMusicMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["musicLibrary"] });
  };
  const add = useMutation({
    mutationFn: async (input: { title: string; description: string; url: string; publicId: string; durationSec: number | null; licenseNote?: string }) => {
      const { data: last } = await supabase.from("music_tracks").select("sort_order").order("sort_order", { ascending: false }).limit(1);
      const nextOrder = ((last?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0) + 10;
      const { error } = await supabase.from("music_tracks").insert({
        title: input.title, description: input.description || null, url: input.url, public_id: input.publicId,
        duration_sec: input.durationSec, sort_order: nextOrder, active: true,
        license_note: input.licenseNote?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("music_tracks").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("music_tracks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  return { add, toggleActive, remove };
}
