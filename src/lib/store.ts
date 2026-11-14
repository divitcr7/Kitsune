import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Episode, ImageSet, Show } from './api';
import { migrateStore, type Pending, type V3 } from './migrate';

export type ShowLite = Pick<Show, 'id' | 'slug' | 'name'> & { poster?: ImageSet; background?: ImageSet };
export type EpisodeLite = Pick<Episode, 'id' | 'slug' | 'number' | 'title' | 'duration'> & { image?: ImageSet };
export type Progress = { t: number; d: number; at: number };
export type HistoryEntry = { show: ShowLite; episode: EpisodeLite; at: number };
export type CaptionSize = 's' | 'm' | 'l' | 'xl';
export type Prefs = {
  audio: 'sub' | 'dub';
  subs: boolean;
  /** 'auto', or the most lines to play (1080, 720, …). */
  quality: 'auto' | number;
  speed: number;
  /** Preferred audio language for streams that carry several ('ja', 'en', …). */
  audioLang: string | null;
  subLang: string | null;
  captionSize: CaptionSize;
  captionBg: boolean;
  /** What a new download is saved as. */
  download: { audio: 'sub' | 'dub'; height: 'best' | number };
  /** Notify when a followed show has a new episode. */
  notify: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  audio: 'sub',
  subs: true,
  quality: 'auto',
  speed: 1,
  audioLang: null,
  subLang: null,
  captionSize: 'm',
  captionBg: false,
  download: { audio: 'sub', height: 1080 },
  notify: true,
};

/** Stored prefs over the defaults, so a field added later never comes back undefined. */
export function migratePrefs(stored: unknown): Prefs {
  const p = stored && typeof stored === 'object' ? (stored as Partial<Prefs>) : {};
  return { ...DEFAULT_PREFS, ...p, download: { ...DEFAULT_PREFS.download, ...(p.download ?? {}) } };
}

type State = {
  myList: ShowLite[];
  history: Record<string, HistoryEntry>;
  progress: Record<string, Progress>;
  toggleList: (show: ShowLite) => boolean;
  recordPlay: (show: ShowLite, episode: EpisodeLite) => void;
  recordProgress: (showId: string, episode: { id: string; slug: string; number?: number }, t: number, d: number) => void;
  removeHistory: (showId: string) => void;
  /** Saved before 1.3 under anime.nexus ids: old show id → miruro id (see lib/migrate.ts). */
  moved: Record<string, string>;
  /** Saved shows not yet found on miruro.cx, by their old id. */
  pending: Record<string, Pending>;
  patchPending: (id: string, p: Pending | null) => void;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
};

const MAX_PROGRESS = 2000;

export const lite = (s: Show | ShowLite): ShowLite => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
  poster: s.poster,
  background: s.background,
});

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      myList: [],
      history: {},
      progress: {},

      toggleList: (show) => {
        const has = get().myList.some((s) => s.id === show.id);
        set({ myList: has ? get().myList.filter((s) => s.id !== show.id) : [lite(show), ...get().myList] });
        return !has;
      },

      recordPlay: (show, episode) =>
        set({ history: { ...get().history, [show.id]: { show: lite(show), episode, at: Date.now() } } }),

      recordProgress: (showId, ep, t, d) => {
        const progress = { ...get().progress, [ep.id]: { t, d, at: Date.now() } };
        const ids = Object.keys(progress);
        if (ids.length > MAX_PROGRESS) {
          ids.sort((a, b) => progress[a].at - progress[b].at);
          ids.slice(0, ids.length - MAX_PROGRESS).forEach((id) => delete progress[id]);
        }
        const entry = get().history[showId];
        // The player can move on to the next episode by itself; follow it.
        const history =
          entry && entry.episode.id !== ep.id
            ? {
                ...get().history,
                [showId]: {
                  ...entry,
                  episode: { id: ep.id, slug: ep.slug, number: ep.number ?? entry.episode.number + 1, title: null, duration: d },
                  at: Date.now(),
                },
              }
            : entry
              ? { ...get().history, [showId]: { ...entry, at: Date.now() } }
              : get().history;
        set({ progress, history });
      },

      removeHistory: (showId) => {
        const history = { ...get().history };
        delete history[showId];
        set({ history });
      },

      moved: {},
      pending: {},
      patchPending: (id, p) => {
        const pending = { ...get().pending };
        if (p) pending[id] = p;
        else delete pending[id];
        set({ pending });
      },

      prefs: DEFAULT_PREFS,
      setPrefs: (p) => set({ prefs: { ...get().prefs, ...p } }),
    }),
    {
      name: 'kitsune-store',
      version: 4,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ myList: s.myList, history: s.history, progress: s.progress, prefs: s.prefs, moved: s.moved, pending: s.pending }),
      // Version 1 kept `blockedUntil`; version 3 grew `prefs`. Version 4 moved everything from
      // anime.nexus's ids to miruro.cx's (the old data is kept as a backup first).
      migrate: async (stored, version) => {
        if (!stored || typeof stored !== 'object') return stored as State;
        const rest: Record<string, unknown> = { ...stored };
        delete rest.blockedUntil;
        rest.prefs = migratePrefs(rest.prefs);
        if (version >= 4) return rest as unknown as State;
        try {
          await AsyncStorage.setItem('kitsune-store-v3-backup', JSON.stringify({ state: stored, version }));
        } catch {
          // A backup that can't be written doesn't stop the move.
        }
        const v4 = migrateStore(rest as V3, await downloadRefs());
        return { ...v4, prefs: migratePrefs(v4.prefs) } as unknown as State;
      },
      // The default merge is shallow: a stored `prefs` would replace the defaults wholesale.
      merge: (stored, current) => {
        const s = (stored ?? {}) as Partial<State>;
        return { ...current, ...s, prefs: migratePrefs(s.prefs), moved: s.moved ?? {}, pending: s.pending ?? {} };
      },
    },
  ),
);

/** Downloaded episodes as saved (their numbers let their progress move exactly). */
async function downloadRefs(): Promise<{ episodeId: string; showId: string; number: number }[]> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem('kitsune-downloads')) || 'null') as { state?: { items?: Record<string, { id: string; show: { id: string }; episode: { number: number } }> } } | null;
    return Object.values(raw?.state?.items ?? {}).map((d) => ({ episodeId: d.id, showId: d.show.id, number: d.episode.number }));
  } catch {
    return [];
  }
}

export function resumePoint(p?: Progress) {
  if (!p || p.t < 10 || p.t > p.d - 60) return 0;
  return p.t;
}

export function fraction(p?: Progress) {
  return p && p.d ? Math.min(1, p.t / p.d) : 0;
}
