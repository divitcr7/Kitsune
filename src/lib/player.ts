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
  open: (s: Session) => void;
  preload: (s: Session) => void;
  dropPreload: (showId: string) => void;
  close: () => void;
};

/**
 * One player for the whole app. Opening the episode that's already preloaded just
 * reveals it (page loaded, verification done, video buffered), so it starts instantly.
 */
export const usePlayer = create<State>((set, get) => ({
  session: null,
  visible: false,
  open: (s) => {
    const cur = get().session;
    set({ session: cur && cur.episodeId === s.episodeId ? { ...cur, ...s } : s, visible: true });
  },
  preload: (s) => {
    const { session, visible } = get();
    if (visible || session?.episodeId === s.episodeId) return;
    set({ session: s, visible: false });
  },
  dropPreload: (showId) => {
    const { session, visible } = get();
    if (!visible && session?.showId === showId) set({ session: null });
  },
  close: () => set({ session: null, visible: false }),
}));
