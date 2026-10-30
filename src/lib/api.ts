const API = 'https://api.anime.nexus/api/anime';

export type Resized = Record<string, string>;
export type ImageSet = { resized?: Resized; resized_blur?: Resized; original?: string };
export type Genre = { id: string; name: string; code: string; type?: string };

export type Show = {
  id: string;
  slug: string;
  name: string;
  name_alt?: string | null;
  description?: string;
  type?: string;
  status?: string;
  release_date?: string | null;
  end_date?: string | null;
  premiered?: string | null;
  release_day?: string | null;
  broadcast?: string | null;
  episode_count?: number | null;
  episode_count_current?: number | null;
  parental_rating?: string | null;
  average?: { score: number; users: string | number } | null;
  trailer?: string | null;
  poster?: ImageSet;
  background?: ImageSet;
  backdrop?: ImageSet;
  logo?: ImageSet;
  genres?: Genre[];
  views?: string | number;
};

export type VideoMeta = {
  subtitle_languages?: string[];
  audio_languages?: string[];
  qualities?: Record<string, number>;
  status?: string;
};

export type Episode = {
  id: string;
  slug: string;
  title: string | null;
  number: number;
  duration: number;
  image?: ImageSet;
  video_meta?: VideoMeta;
  is_filler?: number;
  is_recap?: number;
};

export type LatestItem = Show & { episode: Episode };

export type Page<T> = {
  data: T[];
  meta: { current_page: number; last_page: number; total: number; per_page: number };
};

export type Stats = {
  average?: { score: number; users: string | number };
  followers?: number;
  episodes?: number;
  episodes_total?: number;
  audio_languages?: string[];
  subtitle_languages?: string[];
};

type Params = Record<string, string | number | boolean | string[] | undefined>;

function query(params: Params) {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => parts.push(`${k}[]=${encodeURIComponent(x)}`));
    else parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function get<T>(path: string, params: Params = {}, signal?: AbortSignal): Promise<T> {
  const res = await fetch(API + path + query(params), {
    headers: { Accept: 'application/json' },
    signal,
  });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('json')) {
    throw new ApiError(res.status, res.status === 429 ? 'Slow down a little' : 'Could not reach Anime Nexus');
  }
  return res.json() as Promise<T>;
}

const ART = ['poster', 'genres', 'background', 'backdrop'];

export const api = {
  featured: () => get<{ data: Show[] }>('/featured').then((r) => r.data),
  popular: () => get<{ data: Show[] }>('/popular').then((r) => r.data),
  latest: () => get<Page<LatestItem>>('/latest').then((r) => r.data),
  recent: () => get<Page<Show>>('/recent').then((r) => r.data),
  seasonal: () => get<{ data: Show[] }>('/seasonal').then((r) => r.data),
  schedule: () => get<Page<Show>>('/schedule').then((r) => r.data),
  genres: () => get<{ data: Genre[] }>('/genres').then((r) => r.data),

  discover: (sort: 'trending' | 'popular', page: number, period = 'week') =>
    get<Page<Show>>('/discover', {
      sort,
      period: sort === 'popular' ? period : undefined,
      page,
      perPage: 30,
      includes: ART,
    }),

  shows: (opts: { search?: string; genre?: string; page: number }, signal?: AbortSignal) =>
    get<Page<Show>>(
      '/shows',
      {
        search: opts.search || undefined,
        genres: opts.genre ? [opts.genre] : undefined,
        hasVideos: true,
        sortBy: 'name asc',
        page: opts.page,
        perPage: 30,
        includes: ['poster', 'genres'],
      },
      signal,
    ),

  show: (id: string) =>
    get<{ data: Show }>('/details', { id, includes: [...ART, 'logo'] }).then((r) => r.data),

  stats: (id: string) => get<{ data: Stats }>('/details/statistics', { id }).then((r) => r.data),

  episodes: (id: string, page: number, order: 'asc' | 'desc', perPage = 100) =>
    get<Page<Episode>>('/details/episodes', { id, page, perPage, order, fillers: true, recaps: true }),
};
