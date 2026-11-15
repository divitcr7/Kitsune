import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';

/**
 * Whether a screen is the one on show: not while it's kept behind another screen (for Back) or behind
 * the player. Screens stay mounted, so this is how they know to pause or refresh. It's an object
 * each screen keeps, not a context value that changes, so coming back to a screen redraws only what
 * asks to be told.
 */
export class Shown {
  on: boolean;
  private subs = new Set<() => void>();
  constructor(on: boolean) {
    this.on = on;
  }
  set(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.subs.forEach((fn) => fn());
  }
  subscribe(fn: () => void) {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }
}

export const ShownContext = createContext(new Shown(true));

/** The screen's Shown, for effects that act on it without redrawing. */
export function useShown() {
  return useContext(ShownContext);
}

/** Whether the screen is on show; the caller redraws when that changes. */
export function useShowing() {
  const shown = useShown();
  const [on, setOn] = useState(shown.on);
  useEffect(() => {
    setOn(shown.on);
    return shown.subscribe(() => setOn(shown.on));
  }, [shown]);
  return on;
}
