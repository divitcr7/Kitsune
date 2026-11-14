import { infiniteQueryOptions, keepPreviousData, QueryClient, queryOptions } from '@tanstack/react-query';
import { api } from './api';
import * as miruro from './miruro/api';
import { MiruroError } from './miruro/bridge';
import { linkShow, UnmatchedError } from './miruro/match';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 24 * 60 * 60_000,
      retry: 2,
      retryDelay: (n) => 600 * 2 ** n,
    },
  },
});

/** Retry a miruro.cx request only when another try could change the answer. */
function noRetryWhenFinal(count: number, error: Error) {
  if (error instanceof UnmatchedError) return false;
  if (error instanceof MiruroError && (error.kind === 'blocked' || error.kind === 'timeout' || (error.status >= 400 && error.status < 500))) return false;
  return count < 1;
}

/** Home rails are persisted to disk so a cold start paints instantly from cache. */
const persist = { persist: true };

export const q = {
  featured: queryOptions({ queryKey: ['featured'], queryFn: api.featured, meta: persist }),
  popular: queryOptions({ queryKey: ['popular'], queryFn: api.popular, meta: persist }),
  latest: queryOptions({ queryKey: ['latest'], queryFn: api.latest, meta: persist, staleTime: 2 * 60_000 }),
  recent: queryOptions({ queryKey: ['recent'], queryFn: api.recent, meta: persist }),
  seasonal: queryOptions({ queryKey: ['seasonal'], queryFn: api.seasonal, meta: persist }),
  trending: queryOptions({
    queryKey: ['discover', 'trending'],
    queryFn: () => api.discover('trending', 1).then((r) => r.data),
    meta: persist,
  }),
  schedule: queryOptions({ queryKey: ['schedule'], queryFn: api.schedule, meta: persist }),
  genres: queryOptions({ queryKey: ['genres'], queryFn: api.genres, meta: persist, staleTime: 24 * 60 * 60_000 }),

  show: (id: string) => queryOptions({ queryKey: ['show', id], queryFn: () => api.show(id) }),
  stats: (id: string) => queryOptions({ queryKey: ['stats', id], queryFn: () => api.stats(id) }),
  episodes: (id: string, page: number, order: 'asc' | 'desc') =>
    queryOptions({
      queryKey: ['episodes', id, page, order],
      queryFn: () => api.episodes(id, page, order),
      placeholderData: keepPreviousData,
      staleTime: 2 * 60_000,
    }),

  popularWeek: infiniteQueryOptions({
    queryKey: ['discover', 'popular', 'week'],
    queryFn: ({ pageParam }) => api.discover('popular', pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined),
  }),

  search: (text: string) =>
    infiniteQueryOptions({
      queryKey: ['search', text],
      queryFn: ({ pageParam, signal }) => api.shows({ search: text, page: pageParam }, signal),
      initialPageParam: 1,
      getNextPageParam: (last) => (last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined),
      enabled: text.length > 1,
      placeholderData: keepPreviousData,
    }),

  // ---- miruro.cx, for playback (see lib/miruro) ----
  miruroConfig: queryOptions({ queryKey: ['miruro', 'config'], queryFn: ({ signal }) => miruro.config(signal), staleTime: 30 * 60_000, retry: noRetryWhenFinal }),
  miruroEnv: queryOptions({ queryKey: ['miruro', 'env'], queryFn: ({ signal }) => miruro.env(signal), staleTime: 24 * 60 * 60_000, retry: noRetryWhenFinal }),
  link: (showId: string) =>
    queryOptions({
      queryKey: ['miruro', 'link', showId],
      queryFn: async ({ signal }) => linkShow(await queryClient.fetchQuery(q.show(showId)), signal),
      staleTime: Infinity,
      gcTime: 60 * 60_000,
      retry: noRetryWhenFinal,
    }),
  miruroEpisodes: (id: string) =>
    queryOptions({ queryKey: ['miruro', 'episodes', id], queryFn: ({ signal }) => miruro.episodes(id, signal), staleTime: 10 * 60_000, retry: noRetryWhenFinal }),
  // Stream URLs carry tokens that expire, so play info is short-lived.
  play: (id: string, episode: number) =>
    queryOptions({
      queryKey: ['miruro', 'play', id, episode],
      queryFn: ({ signal }) => miruro.play(id, episode, signal),
      staleTime: 4 * 60_000,
      gcTime: 10 * 60_000,
      retry: noRetryWhenFinal,
    }),

  genre: (genreId: string) =>
    infiniteQueryOptions({
      queryKey: ['genre', genreId],
      queryFn: ({ pageParam }) => api.shows({ genre: genreId, page: pageParam }),
      initialPageParam: 1,
      getNextPageParam: (last) => (last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined),
    }),
};
