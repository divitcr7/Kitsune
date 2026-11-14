import type { Show } from '@/lib/catalog';
import { imgUrl } from '@/lib/img';
import { api, load } from './api';
import { type EpisodeLite, lite, type Playing, resumePoint, session, type ShowLite, store } from './store';

/**
 * Kitsune lives on a plain miruro.cx page (robots.txt: same origin as the site, so its API answers,
 * but none of its scripts or ads). The module manifest's websiteURL points here, and the player is
 * one more screen on the same page.
 */
export const UI_PATH = '/robots.txt';

export type Tab = 'home' | 'search' | 'schedule' | 'library';
export type Route =
  | { name: Tab }
  | { name: 'show'; id: string }
  | { name: 'genre'; id: string; title: string };

export const TABS: { name: Tab; label: string }[] = [
  { name: 'home', label: 'Home' },
  { name: 'search', label: 'Search' },
  { name: 'schedule', label: 'Schedule' },
  { name: 'library', label: 'My Stuff' },
];

export function format(r: Route): string {
  if (r.name === 'show') return `/show/${encodeURIComponent(r.id)}`;
  if (r.name === 'genre') return `/genre/${encodeURIComponent(r.id)}/${encodeURIComponent(r.title)}`;
  return `/${r.name}`;
}

export function parse(hash: string): Route {
  const [, a, b, c] = hash.replace(/^#/, '').split('/');
  if (a === 'show' && b) return { name: 'show', id: decodeURIComponent(b) };
  if (a === 'genre' && b) return { name: 'genre', id: decodeURIComponent(b), title: decodeURIComponent(c || '') };
  if (a === 'search' || a === 'schedule' || a === 'library') return { name: a };
  return { name: 'home' };
}

/*
 * The back stack is ours, not the browser's: it's kept in sessionStorage (so a reload for a
 * Cloudflare check lands on the same screen) and the URL is only ever replaced. That keeps the TV's
 * history at TizenBrew → Kitsune, so Back on Home leaves cleanly.
 */
let stack: Route[] = initialStack();
const subs = new Set<() => void>();

function initialStack(): Route[] {
  const saved = session.get<Route[]>('stack');
  const fromUrl = parse(location.hash);
  if (saved && saved.length && format(saved[saved.length - 1]) === format(fromUrl)) return saved;
  return fromUrl.name === 'home' ? [fromUrl] : [{ name: 'home' }, fromUrl];
}

function commit(next: Route[]) {
  stack = next;
  session.set('stack', stack);
  try {
    history.replaceState(null, '', `#${format(stack[stack.length - 1])}`);
  } catch {}
  subs.forEach((fn) => fn());
}

export const router = {
  top: () => stack[stack.length - 1],
  depth: () => stack.length,
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  },
  go(r: Route) {
    commit([...stack, r]);
  },
  /** Back one screen; false when already at the root of a tab. */
  back(): boolean {
    if (stack.length <= 1) {
      if (stack[0]?.name !== 'home') {
        commit([{ name: 'home' }]);
        return true;
      }
      return false;
    }
    commit(stack.slice(0, -1));
    return true;
  },
  tab(name: Tab) {
    commit([{ name }]);
  },
};

const previews = new Map<string, Show>();

export function previewOf(id: string) {
  return previews.get(id);
}

export function openShow(show: Show | ShowLite) {
  previews.set(show.id, { ...previews.get(show.id), ...(show as Show) });
  router.go({ name: 'show', id: show.id });
}

/*
 * The player is a layer over the screens. What's playing is kept in sessionStorage too, so a reload
 * comes back to the same episode.
 */
let current: Playing | null = session.get<Playing>('playing');
const playerSubs = new Set<() => void>();

export const player = {
  get: () => current,
  subscribe(fn: () => void) {
    playerSubs.add(fn);
    return () => {
      playerSubs.delete(fn);
    };
  },
  open(p: Playing) {
    current = p;
    session.set('playing', p);
    playerSubs.forEach((fn) => fn());
  },
  close() {
    current = null;
    session.set('playing', null);
    playerSubs.forEach((fn) => fn());
  },
};

/** Starts an episode in Kitsune's player. */
export function playEpisode(show: Show | ShowLite, episode: EpisodeLite) {
  const s = lite(show);
  store.recordPlay(s, episode);
  player.open({
    show: s,
    episode,
    thumb: imgUrl(episode.image, 'episode', '1280x720') ?? imgUrl(show.background ?? show.poster, 'background', '1920x1080'),
  });
}

export async function findEpisode(showId: string, number: number) {
  const page = Math.max(1, Math.ceil(number / 100));
  const res = await load(`episodes:${showId}:${page}:asc`, () => api.episodes(showId, page, 'asc'), 2 * 60_000);
  return res.data.find((e) => e.number === number);
}

/** The episode Play should start: resume, the next one if the last was finished, or episode 1. */
export async function upNext(show: Show | ShowLite): Promise<EpisodeLite | undefined> {
  const { history, progress } = store.get();
  const entry = history[show.id];
  if (entry) {
    const p = progress[entry.episode.id];
    if (p && p.d && p.t / p.d > 0.92) return (await findEpisode(show.id, entry.episode.number + 1)) ?? entry.episode;
    return entry.episode;
  }
  const first = await load(`episodes:${show.id}:1:asc`, () => api.episodes(show.id, 1, 'asc'), 2 * 60_000);
  return first.data[0];
}

export async function playShow(show: Show | ShowLite) {
  const ep = await upNext(show).catch(() => undefined);
  if (ep) playEpisode(store.get().history[show.id]?.show ?? show, ep);
  else openShow(show);
}

export function resumeAt(episodeId: string) {
  return Math.floor(resumePoint(store.get().progress[episodeId]));
}
