import { queryClient, q } from '../queries';
import type { MiruroConfig, MiruroEpisode, PlayInfo } from './api';
import type { ProxyEnv } from './codec';

export class MissingEpisodeError extends Error {
  constructor(
    readonly number: number,
    readonly available: number,
  ) {
    super(`Episode ${number} isn’t on miruro.cx`);
    this.name = 'MissingEpisodeError';
  }
}

/** `id` is the miruro show id (the catalog is miruro's, so shows need no matching). */
export type Resolved = { id: string; episode: MiruroEpisode; play: PlayInfo; config: MiruroConfig | null; env: ProxyEnv };

/** Everything the player needs for one episode: miruro's episode (skip times) and its streams. */
export async function resolveEpisode(showId: string, number: number): Promise<Resolved> {
  const [list, config, env] = await Promise.all([
    queryClient.fetchQuery(q.miruroEpisodes(showId)),
    queryClient.fetchQuery(q.miruroConfig).catch(() => null),
    queryClient.fetchQuery(q.miruroEnv),
  ]);
  const episode = list.find((e) => e.episode_number === number);
  if (!episode) throw new MissingEpisodeError(number, list.length);
  const play = await queryClient.fetchQuery(q.play(showId, number));
  return { id: showId, episode, play, config, env };
}

/** Look an episode up ahead of time so pressing Play doesn't wait on it. Failures stay quiet. */
export function prefetchEpisode(showId: string, number: number) {
  resolveEpisode(showId, number).catch(() => {});
}
