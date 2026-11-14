import { miruroGet } from './bridge';
import { FALLBACK_ENV, parseEnv, type ProxyEnv } from './codec';

/**
 * miruro.cx's API, as its own site uses it. The catalog answers only the exact query shapes the
 * site sends (anything else is "Unsupported catalog request"), so keep these paths as they are.
 */

export type ProviderConfig = {
  label?: string;
  visible?: boolean;
  variantOrder?: string[];
  parent?: string | null;
  relationship?: string | null;
  proxy?: false | { rotate?: boolean; segments?: boolean };
};

export type MiruroConfig = {
  streaming: Record<string, ProviderConfig>;
  providerOrder: string[];
};

export type MiruroAnime = {
  id: string;
  external_ids: Record<string, string[] | undefined>;
  title: { romaji?: string | null; english?: string | null; native?: string | null };
  format?: string | null;
  episode_count?: number | null;
  episode_counts?: { raw?: number | null; sub?: number | null; dub?: number | null };
};

export type SkipTime = { kind: 'op' | 'ed' | string; start_seconds: number; end_seconds: number };

export type MiruroEpisode = {
  episode_number: number;
  title?: string | null;
  duration_seconds?: number | null;
  skip_times?: SkipTime[];
};

export type PlaySubtitle = { language: string; label: string; file: string; format: 'vtt' | 'srt' | string; default?: boolean };
export type PlayStream = { url: string; format: string };
export type PlayServer = { server: string; headers?: Record<string, string>; streams: PlayStream[] };
export type PlayProvider = { provider: string; subtitles?: PlaySubtitle[]; servers: PlayServer[] };
export type PlayTrack = { track: 'sub' | 'ssub' | 'dub' | string; providers: PlayProvider[] };
export type PlayInfo = { episode_number: number; tracks: PlayTrack[] };

type List<T> = { data: T[]; has_more?: boolean; next_cursor?: string | null };

export function config(signal?: AbortSignal): Promise<MiruroConfig> {
  return miruroGet<MiruroConfig>('/api/config', signal);
}

export async function env(signal?: AbortSignal): Promise<ProxyEnv> {
  try {
    return parseEnv(await miruroGet<string>('/env2.js', signal));
  } catch {
    // The values change rarely.
    return FALLBACK_ENV;
  }
}

/** The miruro entry for an AniList id. */
export async function byAnilist(anilistId: number, signal?: AbortSignal): Promise<MiruroAnime | undefined> {
  const res = await miruroGet<List<MiruroAnime>>(`/api/v1/anime?anilist_id_in=${anilistId}&limit=100`, signal);
  return res.data.find((a) => (a.external_ids.anilist ?? []).includes(String(anilistId)));
}

export async function episodes(id: string, signal?: AbortSignal): Promise<MiruroEpisode[]> {
  const res = await miruroGet<List<MiruroEpisode>>(`/api/v1/anime/${encodeURIComponent(id)}/episodes?limit=10000`, signal);
  return res.data;
}

export function play(id: string, episode: number, signal?: AbortSignal): Promise<PlayInfo> {
  return miruroGet<PlayInfo>(`/api/v1/anime/${encodeURIComponent(id)}/episodes/${episode}/play`, signal);
}
