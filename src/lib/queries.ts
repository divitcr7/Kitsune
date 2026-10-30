import { infiniteQueryOptions, keepPreviousData, QueryClient, queryOptions } from '@tanstack/react-query';
import { api } from './api';

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

  genre: (genreId: string) =>
    infiniteQueryOptions({
      queryKey: ['genre', genreId],
      queryFn: ({ pageParam }) => api.shows({ genre: genreId, page: pageParam }),
      initialPageParam: 1,
      getNextPageParam: (last) => (last.meta.current_page < last.meta.last_page ? last.meta.current_page + 1 : undefined),
    }),
};
