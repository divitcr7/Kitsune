import { queryClient, q } from '../queries';
import type { MiruroConfig, MiruroEpisode, PlayInfo } from './api';
import type { ProxyEnv } from './codec';
import type { Link } from './match';

export class MissingEpisodeError extends Error {
  constructor(
    readonly number: number,
    readonly available: number,
  ) {
    super(`Episode ${number} isn’t on miruro.cx`);
    this.name = 'MissingEpisodeError';
  }
}

export type Resolved = { link: Link; episode: MiruroEpisode; play: PlayInfo; config: MiruroConfig | null; env: ProxyEnv };

/**
 * miruro's episode for an anime.nexus episode number. Both usually count from 1; when a later
 * season continues the count on one side (13, 14, … against 1, 2, …), line the first ones up.
 */
export function mapEpisode(list: MiruroEpisode[], number: number, nexusFirst: number): MiruroEpisode | undefined {
  if (!list.length) return undefined;
  const sorted = [...list].sort((a, b) => a.episode_number - b.episode_number);
  const miruroFirst = sorted[0].episode_number;
  const exact = sorted.find((e) => e.episode_number === number);
  if (nexusFirst === miruroFirst) return exact;
  return sorted.find((e) => e.episode_number === number - nexusFirst + miruroFirst) ?? exact;
}

/** Everything the player needs for one episode: the show link, miruro's episode, and its streams. */
export async function resolveEpisode(showId: string, number: number): Promise<Resolved> {
  const link = await queryClient.fetchQuery(q.link(showId));
  const [list, nexusFirst, config, env] = await Promise.all([
    queryClient.fetchQuery(q.miruroEpisodes(link.miruro)),
    queryClient
      .fetchQuery(q.episodes(showId, 1, 'asc'))
      .then((p) => p.data[0]?.number ?? 1)
      .catch(() => 1),
    queryClient.fetchQuery(q.miruroConfig).catch(() => null),
    queryClient.fetchQuery(q.miruroEnv),
  ]);
  const episode = mapEpisode(list, number, nexusFirst);
  if (!episode) throw new MissingEpisodeError(number, list.length);
  const play = await queryClient.fetchQuery(q.play(link.miruro, episode.episode_number));
  return { link, episode, play, config, env };
}

/** Look an episode up ahead of time so pressing Play doesn't wait on it. Failures stay quiet. */
export function prefetchEpisode(showId: string, number: number) {
  resolveEpisode(showId, number).catch(() => {});
}
