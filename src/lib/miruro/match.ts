import { useStore } from '../store';
import { byAnilist } from './api';
import { type AnilistMedia, pick, type ShowFacts } from './score';

/**
 * anime.nexus shows carry no AniList or MAL id, and miruro.cx looks shows up by AniList id. So a
 * show is matched on AniList's public API by title (checked against year, format and episode
 * count), then looked up on miruro. A match is kept for good; a miss is retried after a while.
 */

export type Link = { anilist: number; miruro: string };

export class UnmatchedError extends Error {
  constructor(readonly where: 'anilist' | 'miruro') {
    super(where === 'anilist' ? 'No confident AniList match' : 'Not on miruro.cx');
    this.name = 'UnmatchedError';
  }
}

const QUERY = `query ($q: String) {
  Page(perPage: 8) {
    media(search: $q, type: ANIME) {
      id
      title { romaji english native }
      synonyms
      format
      startDate { year }
      episodes
    }
  }
}`;

const MISS_TTL = 10 * 60_000;
const misses = new Map<string, number>();

async function anilistSearch(q: string, signal?: AbortSignal): Promise<AnilistMedia[]> {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { q } }),
    signal,
  });
  if (!res.ok) throw new Error(`AniList answered ${res.status}`);
  const json = (await res.json()) as { data?: { Page?: { media?: AnilistMedia[] } } };
  return json.data?.Page?.media ?? [];
}

export async function linkShow(show: ShowFacts & { id: string }, signal?: AbortSignal): Promise<Link> {
  const known = useStore.getState().links[show.id];
  if (known) return known;
  const missedAt = misses.get(show.id);
  if (missedAt && Date.now() - missedAt < MISS_TTL) throw new UnmatchedError('anilist');

  let media: AnilistMedia | undefined;
  for (const q of [show.name, show.name_alt].filter((t): t is string => !!t?.trim())) {
    media = pick(show, await anilistSearch(q, signal), q);
    if (media) break;
  }
  if (!media) {
    misses.set(show.id, Date.now());
    throw new UnmatchedError('anilist');
  }
  const entry = await byAnilist(media.id, signal);
  if (!entry) {
    misses.set(show.id, Date.now());
    throw new UnmatchedError('miruro');
  }
  const link = { anilist: media.id, miruro: entry.id };
  useStore.getState().setLink(show.id, link);
  return link;
}
