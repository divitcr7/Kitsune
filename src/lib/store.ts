import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Episode, ImageSet, Show } from './api';

export type ShowLite = Pick<Show, 'id' | 'slug' | 'name'> & { poster?: ImageSet; background?: ImageSet };
export type EpisodeLite = Pick<Episode, 'id' | 'slug' | 'number' | 'title' | 'duration'> & { image?: ImageSet };
export type Progress = { t: number; d: number; at: number };
export type HistoryEntry = { show: ShowLite; episode: EpisodeLite; at: number };

type State = {
  myList: ShowLite[];
  history: Record<string, HistoryEntry>;
  progress: Record<string, Progress>;
  toggleList: (show: ShowLite) => boolean;
  recordPlay: (show: ShowLite, episode: EpisodeLite) => void;
  recordProgress: (showId: string, episode: { id: string; slug: string; number?: number }, t: number, d: number) => void;
  removeHistory: (showId: string) => void;
  /** Last known anime.nexus sign-in state (null: never checked). */
  signedIn: boolean | null;
  setSignedIn: (v: boolean) => void;
};

const MAX_PROGRESS = 800;

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
        // The site's player can move on to the next episode by itself; follow it.
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

      signedIn: null,
      setSignedIn: (signedIn) => set({ signedIn }),
    }),
    {
      name: 'kitsune-store',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ myList: s.myList, history: s.history, progress: s.progress, signedIn: s.signedIn }),
    },
  ),
);

export function resumePoint(p?: Progress) {
  if (!p || p.t < 10 || p.t > p.d - 60) return 0;
  return p.t;
}

export function fraction(p?: Progress) {
  return p && p.d ? Math.min(1, p.t / p.d) : 0;
}
