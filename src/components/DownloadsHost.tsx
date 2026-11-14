import { useEffect } from 'react';
import { AppState } from 'react-native';
import { kick, startup } from '@/lib/downloads/engine';
import { useDownloads } from '@/lib/downloads/store';

/**
 * Drives the download queue: starts it once the saved queue is loaded, on every change to it, and
 * whenever Kitsune comes back to the foreground (Android may have paused it in the background).
 */
export function DownloadsHost() {
  useEffect(() => {
    const begin = () => startup();
    if (useDownloads.persist.hasHydrated()) begin();
    const offHydrate = useDownloads.persist.onFinishHydration(begin);
    const offChange = useDownloads.subscribe((s, prev) => {
      if (s.items !== prev.items || s.order !== prev.order || s.paused !== prev.paused) kick();
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') kick();
    });
    return () => {
      offHydrate();
      offChange();
      app.remove();
    };
  }, []);
  return null;
}
