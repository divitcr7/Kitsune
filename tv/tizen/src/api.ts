import { useEffect, useState } from 'preact/hooks';
import { api } from '@/lib/api';

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

export function useData<T>(key: string | null, fn: () => Promise<T>, opts: { stale?: number; persist?: boolean } = {}): Result<T> {
  const { stale = 5 * 60_000, persist = false } = opts;
  const initial = key ? read(key, persist) : undefined;
  const [result, setResult] = useState<Result<T>>({ data: initial?.data as T | undefined, error: false, loading: !initial });

  useEffect(() => {
    if (!key) return;
    let live = true;
    const hit = read(key, persist);
    setResult({ data: hit?.data as T | undefined, error: false, loading: !hit });
    if (!hit || Date.now() - hit.at >= stale) {
      fn().then(
        (data) => {
          write(key, data, persist);
          if (live) setResult({ data, error: false, loading: false });
        },
        () => {
          if (live) setResult((r) => ({ data: r.data, error: true, loading: false }));
        },
      );
    }
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return result;
}

/** Home rails: persisted, refreshed when older than five minutes. */
export const rails = { persist: true, stale: 5 * 60_000 };
