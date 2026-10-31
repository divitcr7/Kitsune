import { router } from 'expo-router';
import type { Show } from './api';
import { haptics } from './haptics';
import { imgUrl } from './img';
import { type Session, usePlayer } from './player';
import { queryClient, q } from './queries';
import { type EpisodeLite, lite, resumePoint, type ShowLite, useStore } from './store';

/**
 * Whatever we already know about a show (from the card that was tapped) so the
 * detail screen paints instantly instead of flashing a skeleton.
 */
const previews = new Map<string, Show>();

export function previewOf(id: string) {
  return previews.get(id);
}

const MAX_PREVIEWS = 60;

export function openShow(show: Show | ShowLite) {
  const merged = { ...previews.get(show.id), ...show };
  previews.delete(show.id);
  previews.set(show.id, merged);
  if (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value!);
  // Start both requests now; they're usually done before the push animation ends.
  queryClient.prefetchQuery(q.show(show.id));
  queryClient.prefetchQuery(q.episodes(show.id, 1, 'asc'));
  router.push({ pathname: '/show/[id]', params: { id: show.id } });
}

function session(show: Show | ShowLite, episode: EpisodeLite): Session {
  return {
    episodeId: episode.id,
    slug: episode.slug,
    showId: show.id,
    showName: show.name,
    number: episode.number,
    title: episode.title ?? '',
    thumb: imgUrl(episode.image, 'episode', '640x360') ?? imgUrl(show.background ?? show.poster, 'background', '960x540'),
    startAt: Math.floor(resumePoint(useStore.getState().progress[episode.id])),
  };
}

export function playEpisode(show: Show | ShowLite, episode: EpisodeLite) {
  useStore.getState().recordPlay(lite(show), episode);
  haptics.impact();
  usePlayer.getState().open(session(show, episode));
}

/** Loads `episode` in the hidden player so pressing Play on it is instant. */
export function preloadEpisode(show: Show | ShowLite, episode: EpisodeLite) {
  usePlayer.getState().preload(session(show, episode));
}

/** Episode `number` of a show (episodes come 100 to a page). */
export async function findEpisode(showId: string, number: number) {
  const page = await queryClient.fetchQuery(q.episodes(showId, Math.max(1, Math.ceil(number / 100)), 'asc'));
  return page.data.find((e) => e.number === number);
}

/** The episode "Play" should start: resume, the next one if the last was finished, or episode 1. */
export async function upNext(show: Show | ShowLite): Promise<EpisodeLite | undefined> {
  const { history, progress } = useStore.getState();
  const entry = history[show.id];
  if (entry) {
    const p = progress[entry.episode.id];
    if (p && p.d && p.t / p.d > 0.92) return (await findEpisode(show.id, entry.episode.number + 1)) ?? entry.episode;
    return entry.episode;
  }
  const first = await queryClient.fetchQuery(q.episodes(show.id, 1, 'asc'));
  return first.data[0];
}

export async function playShow(show: Show | ShowLite) {
  const ep = await upNext(show).catch(() => undefined);
  if (ep) playEpisode(useStore.getState().history[show.id]?.show ?? show, ep);
  else openShow(show);
}
