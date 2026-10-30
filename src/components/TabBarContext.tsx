import { createContext, type ReactNode, useContext } from 'react';
import {
  type SharedValue,
  useAnimatedScrollHandler,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { spring } from '@/theme/tokens';

/** 0 = tab bar fully shown, 1 = tucked away while the user scrolls down. */
const Ctx = createContext<SharedValue<number> | null>(null);

export function TabBarProvider({ children }: { children: ReactNode }) {
  const hidden = useSharedValue(0);
  return <Ctx.Provider value={hidden}>{children}</Ctx.Provider>;
}

export function useTabBarHidden() {
  return useContext(Ctx);
}

/**
 * Scroll handler for tab screens: tucks the tab bar away when scrolling down,
 * brings it back on the way up. Also writes the offset into `scrollY` if given.
 */
export function useTabScroll(scrollY?: SharedValue<number>) {
  const hidden = useContext(Ctx);
  const last = useSharedValue(0);
  return useAnimatedScrollHandler({
    onScroll: (e) => {
      const y = e.contentOffset.y;
      if (scrollY) scrollY.set(y);
      if (!hidden) return;
      const dy = y - last.value;
      last.value = y;
      if (y < 120 || dy < -8) {
        if (hidden.get() !== 0) hidden.set(withSpring(0, spring.smooth));
      } else if (dy > 8 && hidden.get() !== 1) {
        hidden.set(withSpring(1, spring.smooth));
      }
    },
  });
}
