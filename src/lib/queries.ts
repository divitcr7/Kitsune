import { infiniteQueryOptions, keepPreviousData, QueryClient, queryOptions } from '@tanstack/react-query';
import { api } from './api';
import * as miruro from './miruro/api';
import { MiruroError } from './miruro/bridge';

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
  if (error instanceof MiruroError && (error.kind === 'blocked' || error.kind === 'timeout' || (error.status >= 400 && error.status < 500))) return false;
  return count < 1;
}

/** Home rails are persisted to disk so a cold start paints instantly from cache. */
const persist = { persist: true };

export const q = {
  featured: queryOptions({ queryKey: ['home', 'featured'], queryFn: ({ signal }) => api.featured(signal), meta: persist, staleTime: 10 * 60_000, retry: noRetryWhenFinal }),
  popular: queryOptions({ queryKey: ['home', 'season'], queryFn: ({ signal }) => api.popular(signal), meta: persist, staleTime: 30 * 60_000, retry: noRetryWhenFinal }),
  latest: queryOptions({ queryKey: ['home', 'latest'], queryFn: ({ signal }) => api.latest(signal), meta: persist, staleTime: 10 * 60_000, retry: noRetryWhenFinal }),
  recent: queryOptions({ queryKey: ['home', 'upcoming'], queryFn: ({ signal }) => api.recent(signal), meta: persist, staleTime: 30 * 60_000, retry: noRetryWhenFinal }),
  seasonal: queryOptions({ queryKey: ['home', 'season'], queryFn: ({ signal }) => api.seasonal(signal), meta: persist, staleTime: 30 * 60_000, retry: noRetryWhenFinal }),
  trending: queryOptions({ queryKey: ['home', 'featured'], queryFn: ({ signal }) => api.trending(signal), meta: persist, staleTime: 10 * 60_000, retry: noRetryWhenFinal }),
  movies: queryOptions({ queryKey: ['home', 'movies'], queryFn: ({ signal }) => api.movies(signal), meta: persist, staleTime: 60 * 60_000, retry: noRetryWhenFinal }),
  allTime: queryOptions({ queryKey: ['home', 'allTime'], queryFn: ({ signal }) => api.allTime(signal), meta: persist, staleTime: 60 * 60_000, retry: noRetryWhenFinal }),
  schedule: queryOptions({ queryKey: ['schedule'], queryFn: ({ signal }) => api.schedule(signal), meta: persist, staleTime: 15 * 60_000, retry: noRetryWhenFinal }),
  genres: queryOptions({ queryKey: ['genres'], queryFn: () => api.genres(), staleTime: Infinity }),

  show: (id: string) => queryOptions({ queryKey: ['show', id], queryFn: ({ signal }) => api.show(id, signal), staleTime: 10 * 60_000, retry: noRetryWhenFinal }),
  stats: (id: string) => queryOptions({ queryKey: ['stats', id], queryFn: ({ signal }) => api.stats(id, signal), staleTime: 10 * 60_000, retry: noRetryWhenFinal }),
  episodes: (id: string, page: number, order: 'asc' | 'desc') =>
    queryOptions({
      queryKey: ['episodes', id, page, order],
      queryFn: ({ signal }) => api.episodes(id, page, order, 100, signal),
      placeholderData: keepPreviousData,
      staleTime: 2 * 60_000,
      retry: noRetryWhenFinal,
    }),

  popularWeek: infiniteQueryOptions({
    queryKey: ['discover', 'season'],
    queryFn: ({ pageParam, signal }) => api.discover('popular', pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined),
    retry: noRetryWhenFinal,
  }),

  // Search and genres page with miruro's cursors.
  search: (text: string) =>
    infiniteQueryOptions({
      queryKey: ['search', text],
      queryFn: ({ pageParam, signal }) => api.shows({ search: text, cursor: pageParam || undefined }, signal),
      initialPageParam: '',
      getNextPageParam: (last) => last.next,
      enabled: text.length > 1,
      placeholderData: keepPreviousData,
      retry: noRetryWhenFinal,
    }),

  genre: (genre: string) =>
    infiniteQueryOptions({
      queryKey: ['genre', genre],
      queryFn: ({ pageParam, signal }) => api.shows({ genre, cursor: pageParam || undefined }, signal),
      initialPageParam: '',
      getNextPageParam: (last) => last.next,
      retry: noRetryWhenFinal,
    }),

  // ---- miruro.cx, for playback (see lib/miruro) ----
  miruroConfig: queryOptions({ queryKey: ['miruro', 'config'], queryFn: ({ signal }) => miruro.config(signal), staleTime: 30 * 60_000, retry: noRetryWhenFinal }),
  miruroEnv: queryOptions({ queryKey: ['miruro', 'env'], queryFn: ({ signal }) => miruro.env(signal), staleTime: 24 * 60 * 60_000, retry: noRetryWhenFinal }),
  miruroEpisodes: (id: string) =>
    queryOptions({ queryKey: ['miruro', 'episodes', id], queryFn: ({ signal }) => api.episodeRows(id, signal), staleTime: 10 * 60_000, retry: noRetryWhenFinal }),
  // Stream URLs carry tokens that expire, so play info is short-lived.
  play: (id: string, episode: number) =>
    queryOptions({
      queryKey: ['miruro', 'play', id, episode],
      queryFn: ({ signal }) => miruro.play(id, episode, signal),
      staleTime: 4 * 60_000,
      gcTime: 10 * 60_000,
      retry: noRetryWhenFinal,
    }),

};
