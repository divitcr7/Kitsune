import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, SchedulableTriggerInputTypes } from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import { api } from './api';
import type { ScheduleRow } from './catalog';
import { useStore } from './store';

/**
 * Notifications: a new episode of a show in My List (or one watched lately), and a finished
 * download while Kitsune is in the background.
 *
 * miruro.cx only answers a browser, and Kitsune's browser tab exists only while the app runs, so
 * nothing can check for new episodes in the background. Instead, whenever Kitsune is opened, it
 * reads miruro's airing schedule (a week back, a week ahead): episodes that came out since last
 * time are announced now, and the coming week's are scheduled to notify at their air time, so they
 * arrive on time with Kitsune closed. Someone who doesn't open Kitsune for over a week stops
 * getting them until they do.
 */

// The background task from 1.2; kept defined (doing nothing) so Android finds code for it, and
// unregistered below.
const OLD_TASK = 'kitsune-new-episodes';
const SEEN_KEY = 'kitsune-notify-seen';
const EPISODES = 'new-episodes';
const DOWNLOADS = 'downloads-done';
const RECENT = 45 * 24 * 60 * 60_000;
const MAX_NOW = 5;
const MAX_SCHEDULED = 50;
const FOREGROUND_GAP = 15 * 60_000;
const AHEAD = 7 * 24 * 60 * 60_000;

type Seen = { init: boolean; eps: Record<string, number>; movedApplied?: boolean };

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

TaskManager.defineTask(OLD_TASK, async () => BackgroundTask.BackgroundTaskResult.Success);

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

/** On app start: channels; the old background check removed; alerts cleared if turned off. */
export async function setupNotifications() {
  try {
    await channels();
    if (await TaskManager.isTaskRegisteredAsync(OLD_TASK)) await BackgroundTask.unregisterTaskAsync(OLD_TASK);
  } catch {
    // Nothing to undo.
  }
  if (!useStore.getState().prefs.notify) await cancelScheduled(new Set());
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

/** Scheduled episode alerts not in `keep` are cancelled. */
async function cancelScheduled(keep: Set<string>) {
  try {
    for (const n of await Notifications.getAllScheduledNotificationsAsync()) {
      if (n.identifier.startsWith('ep-') && !keep.has(n.identifier)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  } catch {
    // Nothing scheduled.
  }
}

/** Shows someone follows: My List, and anything watched in the last 45 days. */
function followed(): Map<string, string> {
  const { myList, history } = useStore.getState();
  const out = new Map<string, string>();
  for (const s of myList) out.set(s.id, s.name);
  const since = Date.now() - RECENT;
  for (const h of Object.values(history)) if (h.at > since) out.set(h.show.id, h.show.name);
  return out;
}

/** For each show and episode: when it's watchable (the sub release if there is one, else the broadcast). */
function releases(rows: ScheduleRow[], ids: Map<string, string>) {
  const best = new Map<string, ScheduleRow>();
  for (const r of rows) {
    if (!ids.has(r.anime_id) || r.track === 'dub') continue;
    const key = `${r.anime_id}:${r.episode_number}`;
    const had = best.get(key);
    if (!had || (had.track !== 'sub' && r.track === 'sub')) best.set(key, r);
  }
  return [...best.values()];
}

/**
 * Announce episodes that came out since last time, and schedule the coming week's. The first look
 * at a show only notes where it is, so following a show never sets off an alert for an old episode.
 */
export async function checkNewEpisodes() {
  if (!useStore.persist.hasHydrated()) await useStore.persist.rehydrate();
  if (!useStore.getState().prefs.notify) return;
  const ids = followed();
  if (!ids.size) return cancelScheduled(new Set());

  const rows = releases(await api.scheduleRows(), ids);
  const now = Date.now();
  const seen = await readSeen();
  if (!seen.movedApplied) {
    // Alerts saved before 1.3 were keyed by anime.nexus ids.
    const moved = useStore.getState().moved;
    for (const [old, id] of Object.entries(moved)) if (seen.eps[old] !== undefined) seen.eps[id] = Math.max(seen.eps[id] ?? 0, seen.eps[old]);
    seen.movedApplied = true;
  }

  const fresh: { id: string; n: number }[] = [];
  const out = new Map<string, number>();
  for (const r of rows) if (Date.parse(r.air_at) <= now) out.set(r.anime_id, Math.max(out.get(r.anime_id) ?? 0, r.episode_number));
  for (const [id, n] of out) {
    const before = seen.eps[id];
    if (before === undefined || n > before) {
      if (seen.init && before !== undefined) fresh.push({ id, n });
      seen.eps[id] = Math.max(n, before ?? 0);
    }
  }
  // Shows followed that have nothing in this week's schedule still get their first look noted.
  for (const id of ids.keys()) if (seen.eps[id] === undefined) seen.eps[id] = 0;
  seen.init = true;
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen));

  const allowed = await allowNotifications(false);
  if (!allowed) return;
  await channels();
  for (const f of fresh.slice(0, MAX_NOW)) {
    await Notifications.scheduleNotificationAsync({
      identifier: `now-${f.id}-${f.n}`,
      content: { title: ids.get(f.id) ?? 'New episode', body: `Episode ${f.n} is out`, data: { showId: f.id } },
      trigger: Platform.OS === 'android' ? { channelId: EPISODES } : null,
    });
  }

  // The coming week, at each episode's release time.
  const keep = new Set<string>();
  const ahead = rows.filter((r) => Date.parse(r.air_at) > now + 60_000 && Date.parse(r.air_at) < now + AHEAD).sort((a, b) => Date.parse(a.air_at) - Date.parse(b.air_at));
  for (const r of ahead.slice(0, MAX_SCHEDULED)) {
    const identifier = `ep-${r.anime_id}-${r.episode_number}`;
    keep.add(identifier);
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title: ids.get(r.anime_id) ?? 'New episode', body: `Episode ${r.episode_number} should be out now`, data: { showId: r.anime_id } },
      trigger: { type: SchedulableTriggerInputTypes.DATE, date: new Date(r.air_at), ...(Platform.OS === 'android' ? { channelId: EPISODES } : {}) },
    });
  }
  await cancelScheduled(keep);
}

let lastForegroundCheck = 0;
/** While Kitsune is open: check now and then (at start and whenever it comes back). */
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
