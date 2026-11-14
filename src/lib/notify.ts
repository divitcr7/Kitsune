import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import { api } from './api';
import { useStore } from './store';

/**
 * Notifications: a new episode of a show in My List (or one watched lately), and a finished
 * download while Kitsune is in the background. New episodes are found by a background task the
 * system runs every so often (at least 30 minutes apart, when Android allows), which reads
 * anime.nexus's latest-episodes feed. Imported from the app's entry file (index.js), so the task is
 * defined even when Android starts Kitsune just to run it.
 */

const TASK = 'kitsune-new-episodes';
const SEEN_KEY = 'kitsune-notify-seen';
const EPISODES = 'new-episodes';
const DOWNLOADS = 'downloads-done';
// Shows watched within this long count as followed, as well as everything in My List.
const RECENT = 45 * 24 * 60 * 60_000;
const MAX_PER_RUN = 5;
const FOREGROUND_GAP = 15 * 60_000;

type Seen = { init: boolean; eps: Record<string, number> };

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

TaskManager.defineTask(TASK, async () => {
  try {
    await checkNewEpisodes();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

let channelsMade = false;
async function channels() {
  if (channelsMade || Platform.OS !== 'android') return;
  channelsMade = true;
  await Notifications.setNotificationChannelAsync(EPISODES, { name: 'New episodes', importance: AndroidImportance.HIGH, description: 'A new episode of a show you follow is out' });
  await Notifications.setNotificationChannelAsync(DOWNLOADS, { name: 'Finished downloads', importance: AndroidImportance.DEFAULT, description: 'An episode finished downloading' });
}

/** Ask once for permission to notify (Android 13+); true if allowed. */
export async function allowNotifications(ask = true): Promise<boolean> {
  try {
    const now = await Notifications.getPermissionsAsync();
    if (now.granted) return true;
    if (!ask || !now.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** On app start: channels, and the background check registered or removed to match the setting. */
export async function setupNotifications() {
  try {
    await channels();
    const on = useStore.getState().prefs.notify;
    const registered = await TaskManager.isTaskRegisteredAsync(TASK);
    if (on && !registered) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 30 });
    if (!on && registered) await BackgroundTask.unregisterTaskAsync(TASK);
  } catch {
    // Background tasks unavailable (e.g. a TV box without the services): checks still run in the app.
  }
}

async function readSeen(): Promise<Seen> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as Seen) : null;
    if (parsed && typeof parsed === 'object' && parsed.eps) return parsed;
  } catch {
    // Start over.
  }
  return { init: false, eps: {} };
}

/**
 * Look at anime.nexus's latest episodes and notify for followed shows that moved on since last
 * time. The first look at a show only notes where it is, so following a show never sets off a
 * notification for an episode that's been out for days.
 */
export async function checkNewEpisodes() {
  if (!useStore.persist.hasHydrated()) await useStore.persist.rehydrate();
  const { myList, history, prefs } = useStore.getState();
  if (!prefs.notify) return;
  const followed = new Map<string, string>();
  for (const s of myList) followed.set(s.id, s.name);
  const since = Date.now() - RECENT;
  for (const h of Object.values(history)) if (h.at > since) followed.set(h.show.id, h.show.name);
  if (!followed.size) return;

  const latest = await api.latest();
  const seen = await readSeen();
  const fresh: { showId: string; name: string; number: number; title: string | null }[] = [];
  for (const item of latest) {
    if (!followed.has(item.id) || !item.episode) continue;
    const n = item.episode.number;
    const before = seen.eps[item.id];
    if (before === undefined || n > before) {
      seen.eps[item.id] = Math.max(n, before ?? 0);
      if (seen.init && before !== undefined) fresh.push({ showId: item.id, name: item.name, number: n, title: item.episode.title });
    }
  }
  seen.init = true;
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  if (!fresh.length || !(await allowNotifications(false))) return;
  await channels();
  for (const f of fresh.slice(0, MAX_PER_RUN)) {
    await Notifications.scheduleNotificationAsync({
      identifier: `ep-${f.showId}-${f.number}`,
      content: { title: f.name, body: `Episode ${f.number}${f.title ? `  ·  ${f.title}` : ''} is out`, data: { showId: f.showId } },
      trigger: Platform.OS === 'android' ? { channelId: EPISODES } : null,
    });
  }
}

let lastForegroundCheck = 0;
/** While Kitsune is open: check now and then too (the background task may be held back by Android). */
export function checkSoon() {
  if (Date.now() - lastForegroundCheck < FOREGROUND_GAP) return;
  lastForegroundCheck = Date.now();
  checkNewEpisodes().catch(() => {});
}

/** A download finished while Kitsune wasn't on screen. */
export async function notifyDownloaded(showName: string, number: number, left: number) {
  if (AppState.currentState === 'active') return;
  try {
    if (!(await allowNotifications(false))) return;
    await channels();
    await Notifications.scheduleNotificationAsync({
      identifier: 'downloads-done',
      content: { title: `Downloaded: ${showName}`, body: left ? `Episode ${number} is ready  ·  ${left} more on the way` : `Episode ${number} is ready to watch offline`, data: { screen: 'downloads' } },
      trigger: Platform.OS === 'android' ? { channelId: DOWNLOADS } : null,
    });
  } catch {
    // Not shown; the Downloads screen still has it.
  }
}
