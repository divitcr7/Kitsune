import type { Show } from '@/lib/api';
import { imgUrl } from '@/lib/img';
import { api, load } from './api';
import { type EpisodeLite, lite, type Playing, resumePoint, session, type ShowLite, store } from './store';

/**
 * Kitsune's own screens live on a plain anime.nexus page (robots.txt: same origin as the site, so the
 * catalog API and sign-in cookies work, but none of the site's scripts or ads). The module manifest's
 * websiteURL points here.
 */
export const UI_PATH = '/robots.txt';

export type Tab = 'home' | 'search' | 'schedule' | 'library';
export type Route =
  | { name: Tab }
  | { name: 'account' }
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
  if (a === 'search' || a === 'schedule' || a === 'library' || a === 'account') return { name: a };
  return { name: 'home' };
}

/*
 * The back stack is ours, not the browser's: going to the player and back is a full page load, so the
 * stack is kept in sessionStorage and the URL is only ever replaced. That keeps the TV's history at
 * TizenBrew → Kitsune, so Back on Home leaves cleanly.
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

/** Address of a Kitsune screen, for coming back from the player or the sign-in page. */
export function uiUrl(r?: Route) {
  return `${location.origin}${UI_PATH}#${format(r ?? router.top())}`;
}

/** Leave a site page (player, sign-in) for Kitsune's UI without adding to the TV's history. */
export function backToUi(r?: Route) {
  const saved = session.get<Route[]>('stack');
  const target = r ?? (saved && saved.length ? saved[saved.length - 1] : { name: 'home' as const });
  if (window.__kitsuneDev) return console.log('[dev] back to UI', format(target));
  location.replace(`${location.origin}${UI_PATH}#${format(target)}`);
}

const previews = new Map<string, Show>();

export function previewOf(id: string) {
  return previews.get(id);
}

export function openShow(show: Show | ShowLite) {
  previews.set(show.id, { ...previews.get(show.id), ...(show as Show) });
  router.go({ name: 'show', id: show.id });
}

export function watchUrl(ep: { id: string; slug: string }) {
  return `/watch/${encodeURIComponent(ep.id)}/${encodeURIComponent(ep.slug)}`;
}

/** Starts an episode in the site's own player page. */
export function playEpisode(show: Show | ShowLite, episode: EpisodeLite) {
  const s = lite(show);
  store.recordPlay(s, episode);
  const playing: Playing = {
    show: s,
    episode,
    thumb: imgUrl(episode.image, 'episode', '1280x720') ?? imgUrl(show.background ?? show.poster, 'background', '1920x1080'),
  };
  session.set('playing', playing);
  if (window.__kitsuneDev) return console.log('[dev] play', watchUrl(episode));
  location.replace(watchUrl(episode));
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

/**
 * Asks anime.nexus whether this TV is signed in (its API answers 401 to signed-out visitors), the same
 * check the phone's account screen makes.
 */
export async function checkSignedIn(): Promise<boolean | null> {
  const ask = (url: string) =>
    fetch(url, { credentials: 'include', headers: { accept: 'application/json' } }).then(
      (r) => r.status,
      () => 0,
    );
  let status = await ask('/api/user/auth/providers');
  if (status < 200 || status >= 300) {
    const other = await ask('https://api.anime.nexus/api/user/auth/providers');
    status = other >= 200 && other < 300 ? 200 : Math.max(status, other);
  }
  if (status === 200 || status === 401) {
    store.setSignedIn(status === 200);
    return status === 200;
  }
  return null;
}
