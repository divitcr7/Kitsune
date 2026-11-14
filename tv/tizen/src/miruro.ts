import { createCatalog } from '@/lib/catalog';
import type { MiruroConfig, MiruroEpisode, PlayInfo, PlaySubtitle } from '@/lib/miruro/api';
import { decodeBody, FALLBACK_ENV, parseEnv, type ProxyEnv, proxyUrl } from '@/lib/miruro/codec';
import { type Audio, type Candidate, candidates } from '@/lib/miruro/streams';
import { parseCues, type Cue } from '@/lib/subtitles';
import { session } from './store';

/*
 * miruro.cx's API, from its own origin. Kitsune's TV screens live on https://www.miruro.cx/robots.txt
 * (a plain text file: none of the site's scripts or ads run there), so these are ordinary
 * same-origin requests, the same ones the phone app's hidden miruro.cx tab makes.
 */

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(status ? `miruro.cx answered ${status}` : 'Couldn’t reach miruro.cx');
    this.name = 'HttpError';
  }
}

const TIMEOUT = 15_000;

/** One request, as raw bytes (the catalog answers gzipped and XORed; `decodeBody` undoes it). */
function request(url: string, binary: boolean, timeout = TIMEOUT): Promise<{ status: number; ctype: string; body: ArrayBuffer | string }> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.responseType = binary ? 'arraybuffer' : 'text';
    x.timeout = timeout;
    x.onload = () => resolve({ status: x.status, ctype: x.getResponseHeader('content-type') || '', body: x.response });
    x.onerror = () => resolve({ status: 0, ctype: '', body: '' });
    x.ontimeout = x.onerror;
    x.send();
  });
}

/**
 * An HTML 403 from the API is Cloudflare wanting another look at this browser. Reloading lets its
 * check show (Kitsune never answers it); the screen stack survives in sessionStorage. At most once
 * a minute, so a site that keeps refusing doesn't loop.
 */
function recheck() {
  const last = session.get<number>('recheck') ?? 0;
  if (Date.now() - last < 60_000) return;
  session.set('recheck', Date.now());
  setTimeout(() => location.reload(), 300);
}

export function get<T>(path: string): Promise<T> {
  return request(path, true).then((r) => {
    if (r.status === 403 && /html/i.test(r.ctype)) recheck();
    if (r.status < 200 || r.status >= 300) throw new HttpError(r.status);
    return decodeBody(new Uint8Array(r.body as ArrayBuffer), r.ctype) as T;
  });
}

export const api = createCatalog(<T>(path: string) => get<T>(path));

/** Promises shared while fresh; a failure is forgotten so the next call asks again. */
const memo: Record<string, { at: number; p: Promise<unknown> }> = {};
function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo[key];
  if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>;
  const p = fn();
  memo[key] = { at: Date.now(), p };
  p.then(null, () => {
    if (memo[key] && memo[key].p === p) delete memo[key];
  });
  return p;
}

export const config = () => cached('config', 30 * 60_000, () => get<MiruroConfig>('/api/config').then(null, () => null));
export const env = () => cached('env', 30 * 60_000, () => get<string>('/env2.js').then(parseEnv, () => FALLBACK_ENV));
export const playInfo = (id: string, n: number) => cached(`play:${id}:${n}`, 5 * 60_000, () => get<PlayInfo>(`/api/v1/anime/${encodeURIComponent(id)}/episodes/${n}/play`));

/** miruro's own row for an episode (its skip times), from the show's list. */
export function episodeRow(id: string, n: number): Promise<MiruroEpisode | undefined> {
  return api.episodeRows(id).then((rows) => (rows as MiruroEpisode[]).filter((r) => r.episode_number === n)[0]);
}

/**
 * The streams a TV browser can play, best first. A browser can't send the Referer/Origin a server
 * lists, so every stream goes through miruro's proxy (as the site's player does). Subtitle files of
 * a server the site doesn't proxy can't be fetched either, so its clean-video ('ssub') streams go
 * last; that puts icarus's burned-in subtitles ahead of its clean video.
 */
export function tvCandidates(play: PlayInfo, cfg: MiruroConfig | null, e: ProxyEnv, audio: Audio): Candidate[] {
  const all = candidates(play, cfg, e, audio).filter((c) => c.via === 'proxy');
  const good = all.filter((c) => !(c.track === 'ssub' && !c.proxied));
  return good.concat(all.filter((c) => good.indexOf(c) < 0));
}

/** Whether a playlist answers, so a dead server is skipped quickly. */
export function probe(c: Candidate, timeout = 5000): Promise<boolean> {
  return request(c.uri, false, timeout).then((r) => r.status >= 200 && r.status < 300 && /^\s*#EXTM3U/.test(String(r.body)));
}

/** Subtitle cues through miruro's proxy (`/sub.vtt`), as the site fetches them. */
export function fetchCues(sub: PlaySubtitle, c: Candidate, e: ProxyEnv): Promise<Cue[]> {
  return request(proxyUrl(e.a, e.key, sub.file, c.referer, '/sub.vtt'), false).then((r) => {
    const cues = r.status >= 200 && r.status < 300 ? parseCues(String(r.body)) : [];
    if (!cues.length) throw new Error(`Couldn’t load the ${sub.label} subtitles`);
    return cues;
  });
}
