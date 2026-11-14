import { create } from 'zustand';

export type Session = {
  episodeId: string;
  slug: string;
  showId: string;
  showName: string;
  number: number;
  title: string;
  thumb?: string;
  startAt: number;
};

type State = {
  session: Session | null;
  /** true while the player is on screen (there's no hidden preloaded player any more). */
  visible: boolean;
  open: (s: Session) => void;
  close: () => void;
  /** miruro.cx refused a request: hold off on background lookups for a while. */
  backOff: () => void;
  /** Whether a background lookup may go now (and counts it if so). */
  mayPrefetch: () => boolean;
};

// Prefetching asks miruro.cx for an episode's streams before Play is pressed. Keep it occasional,
// and stop for a while after the site pushes back.
const PREFETCH_GAP = 10_000;
const BACKOFF = 10 * 60_000;
let lastPrefetch = 0;
let quietUntil = 0;

/** One player for the whole app. */
export const usePlayer = create<State>((set) => ({
  session: null,
  visible: false,
  open: (s) => set({ session: s, visible: true }),
  close: () => set({ session: null, visible: false }),
  backOff: () => {
    quietUntil = Date.now() + BACKOFF;
  },
  mayPrefetch: () => {
    const now = Date.now();
    if (now < quietUntil || now - lastPrefetch < PREFETCH_GAP) return false;
    lastPrefetch = now;
    return true;
  },
}));
