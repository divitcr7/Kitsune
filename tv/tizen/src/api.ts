import { useEffect, useState } from 'preact/hooks';
import { api } from './miruro';
import { useShown } from './ui/showing';

export { api };

/*
 * A small stale-while-revalidate cache. Home rails are also kept in localStorage for a week so a
 * cold start paints straight away, like the phone's persisted TanStack cache.
 */
type Entry = { at: number; data: unknown };
const mem = new Map<string, Entry>();
const DISK = 'kitsune:cache:';
const WEEK = 7 * 24 * 60 * 60_000;

function read(key: string, persist: boolean): Entry | undefined {
  const hit = mem.get(key);
  if (hit || !persist) return hit;
  try {
    const saved: Entry | null = JSON.parse(localStorage.getItem(DISK + key) || 'null');
    if (saved && Date.now() - saved.at < WEEK) {
      mem.set(key, saved);
      return saved;
    }
  } catch {}
  return undefined;
}

function write(key: string, data: unknown, persist: boolean) {
  const entry = { at: Date.now(), data };
  mem.set(key, entry);
  if (persist) {
    try {
      localStorage.setItem(DISK + key, JSON.stringify(entry));
    } catch {}
  }
}

export function peek<T>(key: string): T | undefined {
  return mem.get(key)?.data as T | undefined;
}

/** Fetch once and share: later callers get the cached value while it's fresh. */
export function load<T>(key: string, fn: () => Promise<T>, stale = 5 * 60_000, persist = false): Promise<T> {
  const hit = read(key, persist);
  if (hit && Date.now() - hit.at < stale) return Promise.resolve(hit.data as T);
  return fn().then((data) => {
    write(key, data, persist);
    return data;
  });
}

type Result<T> = { data: T | undefined; error: boolean; loading: boolean };
type Held<T> = Result<T> & { key: string | null };

function cached<T>(key: string | null, persist: boolean): Held<T> {
  const hit = key ? read(key, persist) : undefined;
  return { key, data: hit?.data as T | undefined, error: false, loading: !hit };
}

/**
 * Cached data for a screen, refreshed in the background once it's older than `stale`. Screens stay
 * mounted behind others, so the check runs again whenever the screen comes back into view, and a
 * refresh that brings the same data doesn't redraw it.
 */
export function useData<T>(key: string | null, fn: () => Promise<T>, opts: { stale?: number; persist?: boolean } = {}): Result<T> {
  const { stale = 5 * 60_000, persist = false } = opts;
  const shown = useShown();
  const [held, setHeld] = useState<Held<T>>(() => cached<T>(key, persist));
  // A new key starts from whatever is cached for it.
  const result = held.key === key ? held : cached<T>(key, persist);

  useEffect(() => {
    if (!key) return;
    let live = true;
    let fetching = false;
    const check = () => {
      if (!shown.on || fetching) return;
      const hit = read(key, persist);
      // Something fetched while this screen was out of view is in the cache already.
      if (hit) setHeld((h) => (h.key === key && h.data === hit.data ? h : { key, data: hit.data as T, error: false, loading: false }));
      if (hit && Date.now() - hit.at < stale) return;
      fetching = true;
      fn().then(
        (fresh) => {
          fetching = false;
          // Unchanged data keeps its old object, so nothing downstream redraws for it.
          const data = hit && JSON.stringify(hit.data) === JSON.stringify(fresh) ? (hit.data as T) : fresh;
          write(key, data, persist);
          if (live) setHeld((h) => (h.key === key && h.data === data ? h : { key, data, error: false, loading: false }));
        },
        () => {
          fetching = false;
          if (live) setHeld((h) => ({ key, data: h.key === key ? h.data : (hit?.data as T | undefined), error: true, loading: false }));
        },
      );
    };
    check();
    const off = shown.subscribe(check);
    return () => {
      live = false;
      off();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return result;
}

/** Home rails: persisted, refreshed when older than five minutes. */
export const rails = { persist: true, stale: 5 * 60_000 };
