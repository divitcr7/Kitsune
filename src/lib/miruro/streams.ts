import type { MiruroConfig, PlayInfo, PlaySubtitle } from './api';
import { type ProxyEnv, proxyUrl } from './codec';

/**
 * Every way to play one episode, best first. Pure, so `scripts/check-miruro.mjs` can test it.
 *
 * Providers come in miruro's own order (/api/config `providerOrder`, visible ones only). For a
 * provider the site plays through its proxy, the proxy URL comes first: the proxy fetches the stream
 * with the headers the API lists and rewrites the playlist, so the player sends nothing special.
 * Then the stream itself, with exactly the headers the API says that server needs.
 */

export type Audio = 'sub' | 'dub';

export type Candidate = {
  key: string;
  uri: string;
  headers?: Record<string, string>;
  provider: string;
  server: string;
  track: string;
  via: 'proxy' | 'direct';
  subtitles: PlaySubtitle[];
};

/** Tracks for a preference, in order. 'ssub' is clean video with subtitle files; 'sub' has them burned in. */
function tracksFor(audio: Audio, variantOrder: string[] | undefined) {
  const want = audio === 'dub' ? ['dub'] : ['ssub', 'sub'];
  const order = variantOrder?.length ? variantOrder.filter((t) => want.includes(t)) : [];
  return [...order, ...want.filter((t) => !order.includes(t))];
}

export function candidates(play: PlayInfo, config: MiruroConfig | null, env: ProxyEnv, audio: Audio, prefer?: { provider: string; server: string }): Candidate[] {
  const providers = new Set<string>();
  for (const t of play.tracks) for (const p of t.providers) providers.add(p.provider);
  const order = [...(config?.providerOrder ?? []), ...[...providers].sort()].filter((p, i, a) => a.indexOf(p) === i && providers.has(p));

  const out: Candidate[] = [];
  for (const provider of order) {
    const cfg = config?.streaming[provider];
    if (cfg && cfg.visible === false) continue;
    // An unknown provider is tried both ways; `proxy: false` means the site plays it directly.
    const useProxy = cfg ? cfg.proxy !== false : true;
    for (const track of tracksFor(audio, cfg?.variantOrder)) {
      const entry = play.tracks.find((t) => t.track === track)?.providers.find((p) => p.provider === provider);
      if (!entry) continue;
      for (const server of entry.servers) {
        const stream = server.streams.find((s) => s.format === 'hls' && /^https:\/\//.test(s.url));
        if (!stream) continue;
        const base = { provider, server: server.server, track, subtitles: track === 'ssub' ? (entry.subtitles ?? []) : [] };
        const headers = server.headers && Object.keys(server.headers).length ? server.headers : undefined;
        if (useProxy) {
          out.push({ ...base, key: `${provider}/${server.server}/${track}/proxy`, via: 'proxy', uri: proxyUrl(env.a, env.key, stream.url, headers ?? null, '/pl.m3u8') });
        }
        out.push({ ...base, key: `${provider}/${server.server}/${track}/direct`, via: 'direct', uri: stream.url, headers });
      }
    }
  }
  if (prefer) {
    const i = out.findIndex((c) => c.provider === prefer.provider && c.server === prefer.server);
    if (i > 0) out.unshift(...out.splice(i, 1));
  }
  return out;
}

/** Whether the play info has anything at all for a preference (to offer "Switch to dub"). */
export function hasAudio(play: PlayInfo, audio: Audio) {
  const want = audio === 'dub' ? ['dub'] : ['ssub', 'sub'];
  return play.tracks.some((t) => want.includes(t.track) && t.providers.some((p) => p.servers.some((s) => s.streams.length)));
}

/** Subtitle files the player can draw (forced-only tracks hold just signs and songs). */
export function usableSubtitles(list: PlaySubtitle[]) {
  return list.filter((s) => (s.format === 'vtt' || s.format === 'srt') && !/forced/i.test(s.label) && /^https:\/\//.test(s.file));
}

/** The subtitle file to show first: the one marked default, else English, else the first. */
export function defaultSubtitle(list: PlaySubtitle[]) {
  const usable = usableSubtitles(list);
  return usable.find((s) => s.default) ?? usable.find((s) => /^en/i.test(s.language)) ?? usable[0];
}

/**
 * Whether a master playlist answers at all. A quick look before handing a URL to the player, which
 * otherwise takes far longer to give up on a dead server.
 */
export async function probe(c: Candidate, timeout = 4000): Promise<boolean> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(c.uri, { headers: c.headers, signal: ctrl.signal });
    if (!res.ok) return false;
    const text = await res.text();
    return text.trimStart().startsWith('#EXTM3U');
  } catch {
    return false;
  } finally {
    clearTimeout(id);
  }
}
