import type { MiruroEpisode } from './api';

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
