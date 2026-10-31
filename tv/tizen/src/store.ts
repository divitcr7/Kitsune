import { useEffect, useState } from 'preact/hooks';
import type { Episode, ImageSet, Show } from '@/lib/api';

/*
 * My List, history and progress, kept in anime.nexus's localStorage on the TV. Same shapes and rules
 * as the phone's store (src/lib/store.ts), stored the way zustand's persist does ({ state, version }),
 * so the two stay interchangeable.
 */
export type ShowLite = Pick<Show, 'id' | 'slug' | 'name'> & { poster?: ImageSet; background?: ImageSet };
export type EpisodeLite = Pick<Episode, 'id' | 'slug' | 'number' | 'title' | 'duration'> & { image?: ImageSet };
export type Progress = { t: number; d: number; at: number };
export type HistoryEntry = { show: ShowLite; episode: EpisodeLite; at: number };

type State = {
  myList: ShowLite[];
  history: Record<string, HistoryEntry>;
  progress: Record<string, Progress>;
  /** Last known anime.nexus sign-in state (null: never checked). */
  signedIn: boolean | null;
};

const KEY = 'kitsune:store';
const MAX_PROGRESS = 800;

function load(): State {
  const empty: State = { myList: [], history: {}, progress: {}, signedIn: null };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    return saved && saved.state ? { ...empty, ...saved.state } : empty;
  } catch {
    return empty;
  }
}

let state = load();
const subs = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ state, version: 1 }));
  } catch {}
  subs.forEach((fn) => fn());
}

export const lite = (s: Show | ShowLite): ShowLite => ({ id: s.id, slug: s.slug, name: s.name, poster: s.poster, background: s.background });

export const store = {
  get: () => state,
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  },
  /** Re-read after another page (the player, the sign-in page) changed it. */
  reload() {
    state = load();
    subs.forEach((fn) => fn());
  },

  toggleList(show: ShowLite) {
    const has = state.myList.some((s) => s.id === show.id);
    set({ myList: has ? state.myList.filter((s) => s.id !== show.id) : [lite(show), ...state.myList] });
    return !has;
  },

  recordPlay(show: ShowLite, episode: EpisodeLite) {
    set({ history: { ...state.history, [show.id]: { show: lite(show), episode, at: Date.now() } } });
  },

  recordProgress(showId: string, ep: { id: string; slug: string; number?: number }, t: number, d: number) {
    const progress = { ...state.progress, [ep.id]: { t, d, at: Date.now() } };
    const ids = Object.keys(progress);
    if (ids.length > MAX_PROGRESS) {
      ids.sort((a, b) => progress[a].at - progress[b].at);
      ids.slice(0, ids.length - MAX_PROGRESS).forEach((id) => delete progress[id]);
    }
    const entry = state.history[showId];
    // The site's player can move on to the next episode by itself; follow it.
    const history =
      entry && entry.episode.id !== ep.id
        ? {
            ...state.history,
            [showId]: {
              ...entry,
              episode: { id: ep.id, slug: ep.slug, number: ep.number ?? entry.episode.number + 1, title: null, duration: d },
              at: Date.now(),
            },
          }
        : entry
          ? { ...state.history, [showId]: { ...entry, at: Date.now() } }
          : state.history;
    set({ progress, history });
  },

  removeHistory(showId: string) {
    const history = { ...state.history };
    delete history[showId];
    set({ history });
  },

  setSignedIn(signedIn: boolean) {
    if (state.signedIn !== signedIn) set({ signedIn });
  },
};

/** Subscribes a component to a slice of the store. */
export function useStore<T>(pick: (s: State) => T): T {
  const [value, setValue] = useState(() => pick(state));
  useEffect(() => {
    setValue(() => pick(state));
    return store.subscribe(() => setValue(() => pick(state)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}

export function resumePoint(p?: Progress) {
  if (!p || p.t < 10 || p.t > p.d - 60) return 0;
  return p.t;
}

export function fraction(p?: Progress) {
  return p && p.d ? Math.min(1, p.t / p.d) : 0;
}

/*
 * Per-tab session state that has to survive the full page loads between Kitsune's UI, the site's
 * player and its sign-in page.
 */
export type Playing = { show: ShowLite; episode: EpisodeLite; thumb?: string };

export const session = {
  get<T>(key: string): T | null {
    try {
      return JSON.parse(sessionStorage.getItem(`kitsune:${key}`) || 'null');
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      if (value == null) sessionStorage.removeItem(`kitsune:${key}`);
      else sessionStorage.setItem(`kitsune:${key}`, JSON.stringify(value));
    } catch {}
  },
};
