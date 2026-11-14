import type { MiruroConfig, PlayInfo, PlaySubtitle } from './api';
import { type ProxyEnv, proxyUrl, refererOf } from './codec';

/**
 * Every way to play one episode, best first. Pure (apart from `probe`), so
 * `scripts/check-miruro.mjs` can test it.
 *
 * Providers come in miruro's own order (/api/config `providerOrder`, visible ones only). A provider
 * the site plays through its proxy gets the proxy URL first: the proxy fetches the stream with the
 * server's Referer and rewrites the playlist, so the player sends nothing special. Then the stream
 * itself, with exactly the headers the API lists. A provider the site plays directly (`proxy:
 * false`) gets the direct stream first and the proxy as a fallback.
 */

export type Audio = 'sub' | 'dub';

export type Candidate = {
  key: string;
  uri: string;
  headers?: Record<string, string>;
  provider: string;
  server: string;
  track: string;
  via: 'proxy' | 'direct' | 'local';
  /** The upstream master playlist, and the Referer the proxy should send for it. */
  streamUrl: string;
  referer: string | null;
  /** Whether the site sends this provider through its proxy (decides where subtitles come from). */
  proxied: boolean;
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
    // An unknown provider is treated as proxied, which is how the site handles most of them.
    const proxied = cfg ? cfg.proxy !== false : true;
    for (const track of tracksFor(audio, cfg?.variantOrder)) {
      const entry = play.tracks.find((t) => t.track === track)?.providers.find((p) => p.provider === provider);
      if (!entry) continue;
      for (const server of entry.servers) {
        const stream = server.streams.find((s) => s.format === 'hls' && /^https:\/\//.test(s.url));
        if (!stream) continue;
        const headers = server.headers && Object.keys(server.headers).length ? server.headers : undefined;
        const referer = refererOf(headers);
        const base = { provider, server: server.server, track, streamUrl: stream.url, referer, proxied, subtitles: track === 'ssub' ? (entry.subtitles ?? []) : [] };
        const viaProxy: Candidate = { ...base, key: `${provider}/${server.server}/${track}/proxy`, via: 'proxy', uri: proxyUrl(env.a, env.key, stream.url, referer, '/pl.m3u8') };
        const direct: Candidate = { ...base, key: `${provider}/${server.server}/${track}/direct`, via: 'direct', uri: stream.url, headers };
        if (proxied) out.push(viaProxy, direct);
        else out.push(direct, viaProxy);
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

/**
 * Subtitle files the player can draw. The API's `format` isn't trusted (icarus labels ASS files
 * "vtt"); the content decides (lib/subtitles.ts). Forced-only tracks hold just signs and songs.
 */
export function usableSubtitles(list: PlaySubtitle[]) {
  return list.filter((s) => !/forced/i.test(s.label) && /^https:\/\//.test(s.file));
}

/** The subtitle file to show first: the language asked for, else the one marked default, else English, else the first. */
export function defaultSubtitle(list: PlaySubtitle[], preferLang?: string | null) {
  const usable = usableSubtitles(list);
  const lang = preferLang?.toLowerCase();
  return (
    (lang ? usable.find((s) => s.language.toLowerCase() === lang) ?? usable.find((s) => s.language.toLowerCase().startsWith(lang.slice(0, 2))) : undefined) ??
    usable.find((s) => s.default) ??
    usable.find((s) => /^en/i.test(s.language)) ??
    usable[0]
  );
}

/**
 * Where to fetch a subtitle file from, in order. The site fetches them through its proxy for
 * proxied providers and directly otherwise; icarus's host only answers with the listed headers.
 */
export function subtitleSources(sub: PlaySubtitle, c: Pick<Candidate, 'proxied' | 'headers' | 'referer'>, env: ProxyEnv | null): { uri: string; headers?: Record<string, string> }[] {
  const direct = { uri: sub.file, headers: c.headers };
  const proxied = env ? { uri: proxyUrl(env.a, env.key, sub.file, c.referer, '/sub.vtt') } : null;
  if (!proxied) return [direct];
  return c.proxied ? [proxied, direct] : [direct, proxied];
}

/**
 * The master playlist's text if it answers at all, else null. A quick look before handing a URL to
 * the player, which otherwise takes far longer to give up on a dead server.
 */
export async function probe(c: Candidate, timeout = 4000): Promise<string | null> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(c.uri, { headers: c.headers, signal: ctrl.signal });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trimStart().startsWith('#EXTM3U') ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}
