/**
 * Moving data saved before 1.3 (when the catalog was anime.nexus's) onto miruro.cx's ids. Pure,
 * so `scripts/check-miruro.mjs` tests it on a saved-data fixture.
 *
 * Shows already played in Kitsune were linked to their miruro show (`links`), so they move
 * exactly. The rest wait in `pending` until a title search on miruro finds them for certain
 * (lib/migrateRun.ts); none are dropped. Downloads keep their folders where they are (`dir`).
 */

export type OldImage = { resized?: Record<string, string>; original?: string };
export type OldShow = { id: string; slug: string; name: string; poster?: OldImage; background?: OldImage };
export type OldEpisode = { id: string; slug: string; number: number; title: string | null; duration: number; image?: OldImage };
export type Progress = { t: number; d: number; at: number };
export type OldHistory = { show: OldShow; episode: OldEpisode; at: number };

export type V3 = {
  myList?: OldShow[];
  history?: Record<string, OldHistory>;
  progress?: Record<string, Progress>;
  links?: Record<string, { anilist: number; miruro: string }>;
  prefs?: unknown;
  signedIn?: unknown;
  blockedUntil?: unknown;
};

/** A saved show not yet found on miruro.cx. */
export type Pending = {
  name: string;
  /** Its place in My List, if it was there. */
  listIndex: number | null;
  history: { number: number; title: string | null; at: number; t?: number; d?: number } | null;
  tries: number;
  lastTry: number;
};

export type V4 = {
  myList: OldShow[];
  history: Record<string, OldHistory>;
  progress: Record<string, Progress>;
  prefs?: unknown;
  /** anime.nexus show id → miruro show id, for anything still pointing at an old id. */
  moved: Record<string, string>;
  pending: Record<string, Pending>;
};

export const epKey = (showId: string, n: number) => `${showId}:${n}`;

// Episodes before the one someone is on count as watched (they were, or were skipped on purpose).
const MARK_BEFORE = 200;

function newShow(old: OldShow, id: string): OldShow {
  // Old artwork was anime.nexus's; the new art is filled in from miruro once online.
  return { id, slug: id, name: old.name };
}

function newEpisode(old: OldEpisode, showId: string): OldEpisode {
  return { id: epKey(showId, old.number), slug: String(old.number), number: old.number, title: old.title, duration: old.duration };
}

/** Stage A: what can move without the network. */
export function migrateStore(v3: V3, downloads: { episodeId: string; showId: string; number: number }[] = []): V4 {
  const links = v3.links ?? {};
  const moved: Record<string, string> = {};
  for (const [nexusId, l] of Object.entries(links)) if (l?.miruro) moved[nexusId] = l.miruro;

  const pending: Record<string, Pending> = {};
  const myList: OldShow[] = [];
  const seenList = new Set<string>();
  (v3.myList ?? []).forEach((s, i) => {
    const m = moved[s.id];
    if (m) {
      if (!seenList.has(m)) {
        seenList.add(m);
        myList.push(newShow(s, m));
      }
    } else {
      pending[s.id] = { name: s.name, listIndex: i, history: null, tries: 0, lastTry: 0 };
    }
  });

  const oldProgress = v3.progress ?? {};
  const progress: Record<string, Progress> = {};
  const history: Record<string, OldHistory> = {};
  for (const [nexusId, h] of Object.entries(v3.history ?? {})) {
    if (!h?.episode || typeof h.episode.number !== 'number') continue;
    const m = moved[nexusId];
    const p = oldProgress[h.episode.id];
    if (!m) {
      const was = pending[nexusId];
      pending[nexusId] = {
        name: h.show?.name ?? was?.name ?? 'Unknown show',
        listIndex: was?.listIndex ?? null,
        history: { number: h.episode.number, title: h.episode.title, at: h.at, t: p?.t, d: p?.d },
        tries: 0,
        lastTry: 0,
      };
      continue;
    }
    const had = history[m];
    if (had && had.at >= h.at) continue;
    history[m] = { show: newShow(h.show, m), episode: newEpisode(h.episode, m), at: h.at };
    if (p) progress[epKey(m, h.episode.number)] = p;
    const from = Math.max(1, h.episode.number - MARK_BEFORE);
    for (let n = from; n < h.episode.number; n++) {
      const k = epKey(m, n);
      if (!progress[k]) progress[k] = { t: 1, d: 1, at: h.at };
    }
  }

  // Downloaded episodes carry their number, so their progress moves exactly too.
  for (const d of downloads) {
    const m = moved[d.showId];
    const p = oldProgress[d.episodeId];
    if (m && p) progress[epKey(m, d.number)] = p;
  }

  return { myList, history, progress, prefs: v3.prefs, moved, pending };
}

export type OldDownload = {
  id: string;
  show: OldShow;
  episode: OldEpisode;
  status: string;
  fail?: string;
  dir?: string;
  legacy?: boolean;
  [k: string]: unknown;
};

export function safeDir(id: string) {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Stage A for downloads: new ids, folders left where they are. */
export function migrateDownloads(items: Record<string, OldDownload>, order: string[], moved: Record<string, string>) {
  const out: Record<string, OldDownload> = {};
  const newOrder: string[] = [];
  for (const oldId of order.filter((id) => items[id]).concat(Object.keys(items).filter((id) => !order.includes(id)))) {
    if (newOrder.includes(oldId)) continue;
    const it = items[oldId];
    const dir = it.dir ?? safeDir(oldId);
    const m = moved[it.show.id];
    if (m) {
      const id = epKey(m, it.episode.number);
      const had = out[id];
      // Two downloads of the same episode: keep the finished (or newer) one; the other stays as it was.
      if (had && (had.status === 'done' || it.status !== 'done')) {
        out[oldId] = { ...it, dir, legacy: true };
        newOrder.push(oldId);
        continue;
      }
      out[id] = { ...it, id, dir, show: newShow(it.show, m), episode: newEpisode(it.episode, m), legacy: undefined };
      newOrder.push(id);
    } else {
      const unfinished = it.status !== 'done';
      out[oldId] = { ...it, dir, legacy: true, ...(unfinished ? { status: 'failed', fail: 'unmatched' } : {}) };
      newOrder.push(oldId);
    }
  }
  return { items: out, order: newOrder };
}

/** Whether a miruro search result is, without doubt, the saved show (by its stored name only). */
export function sameTitle(name: string, titles: (string | null | undefined)[], normalize: (s: string) => string) {
  const want = normalize(name);
  return !!want && titles.some((t) => !!t && normalize(t) === want);
}
