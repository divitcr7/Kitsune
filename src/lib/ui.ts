import { useEffect, useRef } from 'react';
import { create } from 'zustand';

/** Tiny event channel between the tab bar / buttons and screens. */
type Ui = {
  signals: Record<string, number>;
  fire: (name: string) => void;
};

export const useUi = create<Ui>((set, get) => ({
  signals: {},
  fire: (name) => set({ signals: { ...get().signals, [name]: (get().signals[name] ?? 0) + 1 } }),
}));

/** Runs `fn` each time `name` is fired (not on mount). */
export function useSignal(name: string, fn: () => void) {
  const n = useUi((s) => s.signals[name] ?? 0);
  const first = useRef(n);
  const cb = useRef(fn);
  useEffect(() => {
    cb.current = fn;
  });
  useEffect(() => {
    if (n !== first.current) cb.current();
  }, [n]);
}
