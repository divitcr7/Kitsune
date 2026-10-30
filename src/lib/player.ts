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
  /** false while the episode is only being preloaded in the background. */
  visible: boolean;
  /** Episode to pick back up once the user has signed in to anime.nexus. */
  resume: Session | null;
  open: (s: Session) => void;
  preload: (s: Session) => void;
  dropPreload: (showId: string) => void;
  close: () => void;
  setResume: (s: Session | null) => void;
  /** The site refused a stream: hold off on background preloads for a while. */
  backOff: () => void;
};

// Every preload opens a streaming session with anime.nexus, and the site limits how many a guest
// may start. Preload at most once per PRELOAD_GAP, and not at all for BACKOFF after a refusal.
const PRELOAD_GAP = 45_000;
const BACKOFF = 10 * 60_000;
let lastPreload = 0;
let quietUntil = 0;

/**
 * One player for the whole app. Opening the episode that's already preloaded just
 * reveals it (page loaded, verification done, video buffered), so it starts instantly.
 */
export const usePlayer = create<State>((set, get) => ({
  session: null,
  visible: false,
  resume: null,
  open: (s) => {
    const cur = get().session;
    set({ session: cur && cur.episodeId === s.episodeId ? { ...cur, ...s } : s, visible: true });
  },
  preload: (s) => {
    const { session, visible } = get();
    const now = Date.now();
    if (visible || session?.episodeId === s.episodeId || now < quietUntil || now - lastPreload < PRELOAD_GAP) return;
    lastPreload = now;
    set({ session: s, visible: false });
  },
  dropPreload: (showId) => {
    const { session, visible } = get();
    if (!visible && session?.showId === showId) set({ session: null });
  },
  close: () => set({ session: null, visible: false }),
  setResume: (resume) => set({ resume }),
  backOff: () => {
    quietUntil = Date.now() + BACKOFF;
  },
}));
