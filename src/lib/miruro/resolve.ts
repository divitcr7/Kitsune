import { queryClient, q } from '../queries';
import type { MiruroConfig, MiruroEpisode, PlayInfo } from './api';
import type { ProxyEnv } from './codec';
import type { Link } from './match';
import { mapEpisode } from './map';

export { mapEpisode };

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
