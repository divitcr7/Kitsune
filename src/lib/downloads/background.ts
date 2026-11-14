import { AppRegistry, PermissionsAndroid, Platform } from 'react-native';
import { KitsuneDownloads } from '../../../modules/kitsune-downloads';

/**
 * Keeps downloads going with Kitsune in the background. React Native stops JavaScript timers in a
 * backgrounded app unless a Headless JS task is running, and Android may stop the process; the
 * native KitsuneDownloadService (a foreground service with a progress notification) runs this
 * module's task for as long as the queue has work, which keeps both alive. The engine calls
 * `holdAwake` when it starts work and `letGo` when the queue is idle.
 */

const TASK = 'KitsuneDownloads';
let release: (() => void) | null = null;
let letGoRequested = false;
let lastUpdate = 0;

// The task lives until the queue goes idle. Registered at load, before the service can ask for it.
AppRegistry.registerHeadlessTask(TASK, () => async () => {
  if (letGoRequested) return;
  await new Promise<void>((resolve) => {
    release = resolve;
  });
});

export function holdAwake(title: string, text: string) {
  if (Platform.OS !== 'android' || !KitsuneDownloads) return;
  letGoRequested = false;
  if (KitsuneDownloads.isRunning() && release) KitsuneDownloads.update(title, text, -1);
  else KitsuneDownloads.start(title, text);
}

/** Progress in the notification, at most once a second. `pct` 0..1, or null while it's finding the stream. */
export function showProgress(title: string, text: string, pct: number | null, force = false) {
  if (Platform.OS !== 'android' || !KitsuneDownloads) return;
  const now = Date.now();
  if (!force && now - lastUpdate < 1000) return;
  lastUpdate = now;
  KitsuneDownloads.update(title, text, pct === null ? -1 : Math.max(0, Math.min(100, Math.floor(pct * 100))));
}

export function letGo() {
  if (Platform.OS !== 'android' || !KitsuneDownloads) return;
  letGoRequested = true;
  const r = release;
  release = null;
  // Ending the task stops the service by itself; stop it outright in case the task never began.
  if (r) r();
  setTimeout(() => {
    if (letGoRequested && KitsuneDownloads?.isRunning()) KitsuneDownloads.stop();
  }, 3000);
}

let asked = false;

/** Android 13+ shows the progress notification only with this permission (downloads run either way). */
export async function askForNotifications() {
  if (asked || Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  asked = true;
  try {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch {
    // Not granted: downloads still run, just without the visible progress.
  }
}
