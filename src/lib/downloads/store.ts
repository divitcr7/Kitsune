import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { SkipTime } from '../miruro/api';
import type { Audio } from '../miruro/streams';
import { type EpisodeLite, lite, type ShowLite } from '../store';
import type { Show } from '../api';
import { migrateDownloads, type OldDownload } from '../migrate';

export type DownloadStatus = 'queued' | 'resolving' | 'downloading' | 'paused' | 'done' | 'failed';
export type DownloadFail = 'network' | 'space' | 'stream' | 'unmatched' | 'episode' | 'blocked' | 'protected';
export type DownloadWant = { audio: Audio; height: 'best' | number; audioLang: string | null; subLang: string | null };
export type SavedSub = { language: string; label: string; file: string };

export type DownloadItem = {
  /** The anime.nexus episode id (the same key progress and history use). */
  id: string;
  show: ShowLite;
  episode: EpisodeLite;
  want: DownloadWant;
  status: DownloadStatus;
  fail?: DownloadFail;
  addedAt: number;
  doneAt?: number;
  /** What was actually saved. */
  got?: { provider: string; server: string; track: string; height: number; audioLangs: string[]; subs: SavedSub[] };
  skips?: SkipTime[];
  /** Checkpoint of segments saved (the live figure is in useDownloadLive). */
  segs?: { done: number; total: number };
  bytes: number;
  /** Folder name under downloads/ (downloads saved before 1.3 keep their old folder). */
  dir?: string;
  /** Saved before 1.3 and not yet moved onto a miruro show (plays offline; can't stream). */
  legacy?: boolean;
};

type State = {
  items: Record<string, DownloadItem>;
  /** Queue order (oldest first); finished items stay in it for display order. */
  order: string[];
  /** The whole queue held by the person. */
  paused: boolean;
  /** An episode the person is waiting on right now, so a Cloudflare check may be shown for it. */
  asking: string | null;
  enqueue: (show: Show | ShowLite, episodes: EpisodeLite[], want: DownloadWant) => number;
  pause: (id?: string) => void;
  resume: (id?: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  patch: (id: string, p: Partial<DownloadItem>) => void;
  setAsking: (id: string | null) => void;
};

export const useDownloads = create<State>()(
  persist(
    (set, get) => ({
      items: {},
      order: [],
      paused: false,
      asking: null,

      enqueue: (show, episodes, want) => {
        const items = { ...get().items };
        const order = [...get().order];
        let added = 0;
        for (const episode of episodes) {
          const cur = items[episode.id];
          if (cur && cur.status !== 'failed') continue;
          items[episode.id] = { id: episode.id, show: lite(show), episode, want, status: 'queued', addedAt: Date.now(), bytes: cur?.bytes ?? 0, segs: cur?.segs };
          if (!order.includes(episode.id)) order.push(episode.id);
          added++;
        }
        set({ items, order, paused: false });
        return added;
      },

      pause: (id) => {
        if (!id) return set({ paused: true });
        const it = get().items[id];
        if (it && it.status !== 'done') get().patch(id, { status: 'paused' });
      },

      resume: (id) => {
        if (!id) {
          // Resume all: items paused one by one go back in the queue too.
          const items = { ...get().items };
          for (const k of Object.keys(items)) if (items[k].status === 'paused') items[k] = { ...items[k], status: 'queued' };
          return set({ items, paused: false });
        }
        const it = get().items[id];
        if (it && (it.status === 'paused' || it.status === 'failed')) get().patch(id, { status: 'queued', fail: undefined });
      },

      retry: (id) => get().resume(id),

      remove: (id) => {
        const items = { ...get().items };
        delete items[id];
        set({ items, order: get().order.filter((x) => x !== id) });
      },

      patch: (id, p) => {
        const it = get().items[id];
        if (!it) return;
        set({ items: { ...get().items, [id]: { ...it, ...p } } });
      },

      setAsking: (asking) => set({ asking }),
    }),
    {
      name: 'kitsune-downloads',
      version: 2,
      // Version 2: ids moved from anime.nexus's to miruro.cx's; files stay where they were.
      migrate: async (stored, version) => {
        const st = (stored ?? {}) as { items?: Record<string, OldDownload>; order?: string[]; paused?: boolean };
        if (version >= 2 || !st.items) return st as never;
        try {
          await AsyncStorage.setItem('kitsune-downloads-v1-backup', JSON.stringify({ state: stored, version }));
        } catch {
          // Carry on without the backup.
        }
        const moved = await movedShows();
        const { items, order } = migrateDownloads(st.items, st.order ?? Object.keys(st.items), moved);
        return { ...st, items, order } as never;
      },
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ items: s.items, order: s.order, paused: s.paused }),
      // Whatever was mid-transfer when the app stopped goes back in the queue; saved segments stay.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const items = { ...state.items };
        for (const k of Object.keys(items)) if (items[k].status === 'resolving' || items[k].status === 'downloading') items[k] = { ...items[k], status: 'queued' };
        useDownloads.setState({ items });
      },
    },
  ),
);

/** anime.nexus show id → miruro id, from the main store whether or not it has moved yet. */
async function movedShows(): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem('kitsune-store')) || 'null') as {
      state?: { moved?: Record<string, string>; links?: Record<string, { miruro?: string }> };
    } | null;
    const out: Record<string, string> = { ...(raw?.state?.moved ?? {}) };
    for (const [id, l] of Object.entries(raw?.state?.links ?? {})) if (l?.miruro) out[id] = l.miruro;
    return out;
  } catch {
    return {};
  }
}

/** Live progress of the item being downloaded (not persisted; updated a few times a second). */
export const useDownloadLive = create<{ id: string | null; done: number; total: number; bytes: number; bps: number; set: (p: Partial<{ id: string | null; done: number; total: number; bytes: number; bps: number }>) => void }>((set) => ({
  id: null,
  done: 0,
  total: 0,
  bytes: 0,
  bps: 0,
  set: (p) => set(p),
}));

export function isDone(item?: DownloadItem): item is DownloadItem & { status: 'done' } {
  return !!item && item.status === 'done';
}

/** A finished download of a show's episode by number (for next / previous while offline). */
export function downloadedByNumber(showId: string, number: number): DownloadItem | undefined {
  return Object.values(useDownloads.getState().items).find((d) => d.show.id === showId && d.episode.number === number && d.status === 'done');
}
