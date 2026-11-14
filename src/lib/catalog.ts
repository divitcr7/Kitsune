/**
 * Kitsune's catalog, from miruro.cx. The screens use the shapes below (`Show`, `Episode`, `Page`, …);
 * `createCatalog` fills them from miruro's API through whatever `get` the platform has: the app's
 * hidden browser tab (lib/miruro/bridge.ts) or, on a Samsung TV, a same-origin request from a page
 * on the site. Nothing here touches the network itself, so `scripts/check-miruro.mjs` tests it in
 * Node with recorded responses.
 *
 * miruro's catalog only answers the exact query shapes its own site sends ("Unsupported catalog
 * request" otherwise), so every path below is one the site uses. Check a new one in a browser on
 * www.miruro.cx before relying on it.
 */

export type Resized = Record<string, string>;
/** Artwork. `original` is a full URL; `resized` is from anime.nexus and only in data saved before 1.3. */
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
  /** miruro has the English dub. */
  hasDub?: boolean;
  /** For the schedule: the episode airing at `broadcast`. */
  airing?: { episode: number; at: string } | null;
  /** Typical episode length in seconds. */
  runtime?: number;
};

export type VideoMeta = { subtitle_languages?: string[]; audio_languages?: string[]; qualities?: Record<string, number>; status?: string };

export type Episode = {
  /** `${showId}:${number}` (miruro's episodes have no ids of their own). */
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
  /** Cursor for the next page, for lists miruro pages with cursors. */
  next?: string;
};

export type Stats = {
  average?: { score: number; users: string | number };
  followers?: number;
  episodes?: number;
  episodes_total?: number;
  audio_languages?: string[];
  subtitle_languages?: string[];
};

/** What miruro sends for a show (list items carry a subset). */
export type MiruroShow = {
  id: string;
  title?: { romaji?: string | null; english?: string | null; native?: string | null };
  format?: string | null;
  status?: string | null;
  season?: string | null;
  season_year?: number | null;
  episode_count?: number | null;
  episode_counts?: { raw?: number | null; sub?: number | null; dub?: number | null } | null;
  episode_duration_minutes?: number | null;
  started_on?: string | null;
  ended_on?: string | null;
  average_score?: number | null;
  popularity?: number | null;
  cover_url?: string | null;
  banner_url?: string | null;
  background_url?: string | null;
  logo_url?: string | null;
  description?: string | null;
  trailer_youtube_id?: string | null;
  genres?: string[] | null;
  is_adult?: boolean | null;
};

export type MiruroEpisodeRow = {
  episode_number: number;
  title?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
  kind?: string | null;
  canon_type?: string | null;
  aired_on?: string | null;
};

export type ScheduleRow = { anime_id: string; air_at: string; episode_number: number; track: string };

type List<T> = { data: T[]; has_more?: boolean; next_cursor?: string | null };

/** AniList's genres, which miruro uses (its genre list itself isn't served). */
export const GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Horror',
  'Mahou Shoujo',
  'Mecha',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller',
];

export const genreList = (): Genre[] => GENRES.map((g) => ({ id: g, name: g, code: g, type: 'genre' }));

const FORMAT: Record<string, string> = { TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' };
const STATUS: Record<string, string> = {
  RELEASING: 'Currently Airing',
  FINISHED: 'Finished Airing',
  NOT_YET_RELEASED: 'Not yet aired',
  CANCELLED: 'Cancelled',
  HIATUS: 'On Hiatus',
};
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Strict URI encoding: the bridge only passes `[A-Za-z0-9_-/?=&%.,]`, so `! ' ( ) * ~` are escaped too. */
export function enc(s: string) {
  return encodeURIComponent(s).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Descriptions come with AniList's HTML (<br>, <i>); plain text with paragraph breaks is wanted. */
export function stripHtml(s?: string | null) {
  if (!s) return '';
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, '’')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function displayName(t?: MiruroShow['title']) {
  return t?.english || t?.romaji || t?.native || 'Untitled';
}

function img(url?: string | null): ImageSet | undefined {
  return url ? { original: url } : undefined;
}

export function toShow(m: MiruroShow): Show {
  const name = displayName(m.title);
  const alt = m.title?.romaji && m.title.romaji !== name ? m.title.romaji : m.title?.native && m.title.native !== name ? m.title.native : null;
  const season = m.season ? `${m.season[0]}${m.season.slice(1).toLowerCase()}` : null;
  const counts = m.episode_counts ?? undefined;
  return {
    id: m.id,
    slug: m.id,
    name,
    name_alt: alt,
    description: stripHtml(m.description),
    type: m.format ? (FORMAT[m.format] ?? m.format) : undefined,
    status: m.status ? (STATUS[m.status] ?? m.status) : undefined,
    release_date: m.started_on ?? (m.season_year ? `${m.season_year}-01-01` : null),
    end_date: m.ended_on ?? null,
    premiered: season ? season.toLowerCase() : null,
    episode_count: m.episode_count ?? null,
    episode_count_current: counts?.sub ?? counts?.raw ?? null,
    average: typeof m.average_score === 'number' ? { score: Math.round(m.average_score) / 10, users: '' } : null,
    trailer: m.trailer_youtube_id ? `https://www.youtube.com/watch?v=${m.trailer_youtube_id}` : null,
    poster: img(m.cover_url),
    background: img(m.background_url ?? m.banner_url),
    backdrop: img(m.banner_url ?? m.background_url),
    logo: img(m.logo_url),
    genres: (m.genres ?? []).map((g) => ({ id: g, name: g, code: g, type: 'genre' })),
    views: m.popularity ?? undefined,
    hasDub: !!counts?.dub,
    runtime: m.episode_duration_minutes ? m.episode_duration_minutes * 60 : undefined,
  };
}

export function episodeId(showId: string, n: number) {
  return `${showId}:${n}`;
}

export function toEpisode(showId: string, e: MiruroEpisodeRow, fallbackSeconds = 0): Episode {
  return {
    id: episodeId(showId, e.episode_number),
    slug: String(e.episode_number),
    title: e.title?.trim() || null,
    number: e.episode_number,
    duration: e.duration_seconds ?? fallbackSeconds,
    image: img(e.thumbnail_url),
    is_filler: e.canon_type === 'filler' ? 1 : 0,
    is_recap: e.kind === 'recap' || e.canon_type === 'recap' ? 1 : 0,
  };
}

/** The anime season a date falls in (December belongs to next year's winter). */
export function seasonOf(d: Date): { season: string; year: number } {
  const m = d.getMonth();
  if (m === 11) return { season: 'WINTER', year: d.getFullYear() + 1 };
  if (m <= 1) return { season: 'WINTER', year: d.getFullYear() };
  if (m <= 4) return { season: 'SPRING', year: d.getFullYear() };
  if (m <= 7) return { season: 'SUMMER', year: d.getFullYear() };
  return { season: 'FALL', year: d.getFullYear() };
}

function day(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Aired episodes from the schedule, newest first, one per show and episode (sub preferred). */
export function latestFrom(rows: ScheduleRow[], shows: Map<string, Show>, now: number, hours = 72): LatestItem[] {
  const since = now - hours * 3600_000;
  const best = new Map<string, ScheduleRow>();
  for (const r of rows) {
    const at = Date.parse(r.air_at);
    if (!(at <= now && at >= since) || r.track === 'dub') continue;
    const key = `${r.anime_id}:${r.episode_number}`;
    const had = best.get(key);
    // The sub release is when it's watchable in Kitsune; the raw broadcast is a fallback.
    if (!had || (had.track !== 'sub' && r.track === 'sub')) best.set(key, r);
  }
  const seen = new Set<string>();
  return [...best.values()]
    .sort((a, b) => Date.parse(b.air_at) - Date.parse(a.air_at))
    .filter((r) => {
      if (seen.has(r.anime_id) || !shows.has(r.anime_id)) return false;
      seen.add(r.anime_id);
      return true;
    })
    .map((r) => {
      const show = shows.get(r.anime_id)!;
      return { ...show, episode: toEpisode(show.id, { episode_number: r.episode_number }, show.runtime ?? 0) };
    });
}

/**
 * The week ahead as the schedule screen wants it: one entry per show and weekday, at its local air
 * time (`broadcast` "HH:MM", `release_day` the weekday's name), earliest airing that day.
 */
export function weekFrom(rows: ScheduleRow[], shows: Map<string, Show>, now: number): Show[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = start.getTime() + 7 * 86400_000;
  const best = new Map<string, ScheduleRow>();
  for (const r of rows) {
    const at = Date.parse(r.air_at);
    if (at < start.getTime() || at >= end || r.track === 'dub') continue;
    const key = `${r.anime_id}:${new Date(at).getDay()}`;
    const had = best.get(key);
    if (!had || at < Date.parse(had.air_at)) best.set(key, r);
  }
  const out: Show[] = [];
  for (const r of best.values()) {
    const show = shows.get(r.anime_id);
    if (!show) continue;
    const at = new Date(r.air_at);
    out.push({
      ...show,
      release_day: WEEKDAY_NAMES[at.getDay()],
      broadcast: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
      airing: { episode: r.episode_number, at: r.air_at },
    });
  }
  return out;
}

function page<T>(all: T[], n: number, per: number): Page<T> {
  const last = Math.max(1, Math.ceil(all.length / per));
  return { data: all.slice((n - 1) * per, n * per), meta: { current_page: n, last_page: last, total: all.length, per_page: per } };
}

function cursorPage<T>(res: { has_more?: boolean; next_cursor?: string | null }, mapped: T[]): Page<T> {
  return { data: mapped, meta: { current_page: 1, last_page: res.has_more ? 2 : 1, total: 0, per_page: mapped.length }, next: res.has_more && res.next_cursor ? res.next_cursor : undefined };
}

export type Getter = <T>(path: string, signal?: AbortSignal) => Promise<T>;

const SCHEDULE_TTL = 10 * 60_000;
const EPISODES_TTL = 5 * 60_000;
const SHOW_TTL = 30 * 60_000;

export function createCatalog(get: Getter, clock: () => number = Date.now) {
  const shows = new Map<string, { at: number; show: Show }>();
  const episodeLists = new Map<string, { at: number; list: MiruroEpisodeRow[] }>();
  let schedule: { at: number; rows: ScheduleRow[] } | null = null;
  let scheduling: Promise<ScheduleRow[]> | null = null;

  const remember = (list: Show[]) => {
    const at = clock();
    for (const s of list) shows.set(s.id, { at, show: s });
    return list;
  };

  const list = (path: string, signal?: AbortSignal) => get<List<MiruroShow>>(path, signal).then((r) => remember((r.data ?? []).filter((m) => !m.is_adult).map(toShow)));

  /** Details for many shows at once, from memory where fresh. */
  async function byIds(ids: string[], signal?: AbortSignal): Promise<Map<string, Show>> {
    const out = new Map<string, Show>();
    const missing: string[] = [];
    for (const id of new Set(ids)) {
      const hit = shows.get(id);
      if (hit && clock() - hit.at < SHOW_TTL) out.set(id, hit.show);
      else missing.push(id);
    }
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const res = await get<List<MiruroShow>>(`/api/v1/anime?id_in=${chunk.map(enc).join('%2C')}&limit=200`, signal);
      for (const s of remember((res.data ?? []).map(toShow))) out.set(s.id, s);
    }
    return out;
  }

  /** The schedule from a week back to a week ahead: one request feeds New Episodes, the Schedule tab and alerts. */
  function scheduleRows(signal?: AbortSignal): Promise<ScheduleRow[]> {
    if (schedule && clock() - schedule.at < SCHEDULE_TTL) return Promise.resolve(schedule.rows);
    if (scheduling) return scheduling;
    const now = new Date(clock());
    const from = day(new Date(now.getTime() - 7 * 86400_000));
    const to = day(new Date(now.getTime() + 8 * 86400_000));
    // (No Promise.finally: the Samsung TV build targets browsers from before it.)
    const req = get<List<ScheduleRow>>(`/api/v1/schedule?from=${from}&to=${to}&track=raw%2Csub&limit=10000`, signal).then(
      (r) => {
        scheduling = null;
        schedule = { at: clock(), rows: r.data ?? [] };
        return schedule.rows;
      },
      (e: unknown) => {
        scheduling = null;
        throw e;
      },
    );
    scheduling = req;
    return req;
  }

  async function episodeRows(id: string, signal?: AbortSignal): Promise<MiruroEpisodeRow[]> {
    const hit = episodeLists.get(id);
    if (hit && clock() - hit.at < EPISODES_TTL) return hit.list;
    const res = await get<List<MiruroEpisodeRow>>(`/api/v1/anime/${enc(id)}/episodes?limit=10000`, signal);
    // Specials come numbered 20001 and up; they'd show as "Episode 20001", so they're left out.
    // Episodes announced but not aired yet are listed too; they can't play, so they wait.
    const soon = clock() + 36 * 3600_000;
    const rows = (res.data ?? [])
      .filter((e) => typeof e.episode_number === 'number' && e.episode_number < 10000 && !(e.aired_on && Date.parse(e.aired_on) > soon))
      .sort((a, b) => a.episode_number - b.episode_number);
    episodeLists.set(id, { at: clock(), list: rows });
    return rows;
  }

  async function show(id: string, signal?: AbortSignal): Promise<Show> {
    const m = await get<MiruroShow>(`/api/v1/anime/${enc(id)}`, signal);
    return remember([toShow(m)])[0];
  }

  const seasonNow = () => seasonOf(new Date(clock()));
  const seasonList = (signal?: AbortSignal) => {
    const { season, year } = seasonNow();
    return list(`/api/v1/anime/trending?limit=200&season=${season}&season_year=${year}`, signal);
  };

  return {
    /** Airing now and trending: the billboard and "Trending Now". */
    featured: (signal?: AbortSignal) => list('/api/v1/anime/trending?limit=12&status=RELEASING', signal),
    trending: (signal?: AbortSignal) => list('/api/v1/anime/trending?limit=12&status=RELEASING', signal),
    /** This season's most watched: Top 10 and "Airing This Season". */
    popular: seasonList,
    seasonal: seasonList,
    /** Coming soon. */
    recent: (signal?: AbortSignal) => list('/api/v1/anime?status=NOT_YET_RELEASED&sort=-popularity&limit=12', signal),
    movies: (signal?: AbortSignal) => list('/api/v1/anime?format=MOVIE&sort=-score&limit=12', signal),
    allTime: (signal?: AbortSignal) => list('/api/v1/anime?status=FINISHED&format=TV%2CTV_SHORT%2CONA%2COVA&sort=-popularity&limit=12', signal),

    latest: async (signal?: AbortSignal): Promise<LatestItem[]> => {
      const rows = await scheduleRows(signal);
      const now = clock();
      const recent = rows.filter((r) => Date.parse(r.air_at) <= now && Date.parse(r.air_at) >= now - 72 * 3600_000);
      return latestFrom(rows, await byIds(recent.map((r) => r.anime_id), signal), now);
    },

    schedule: async (signal?: AbortSignal): Promise<Show[]> => {
      const rows = await scheduleRows(signal);
      const now = clock();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const week = rows.filter((r) => Date.parse(r.air_at) >= start.getTime() && Date.parse(r.air_at) < start.getTime() + 7 * 86400_000);
      return weekFrom(rows, await byIds(week.map((r) => r.anime_id), signal), now);
    },

    scheduleRows,
    byIds,

    genres: async (): Promise<Genre[]> => genreList(),

    /** Popular this season, paged 30 at a time (miruro sends the whole season at once). */
    discover: async (_sort: 'trending' | 'popular', n: number, signal?: AbortSignal): Promise<Page<Show>> => page(await seasonList(signal), n, 30),

    /** Search or a genre, a cursor page at a time. */
    shows: async (opts: { search?: string; genre?: string; cursor?: string }, signal?: AbortSignal): Promise<Page<Show>> => {
      const c = opts.cursor ? `&cursor=${enc(opts.cursor)}` : '';
      const path = opts.search
        ? `/api/v1/anime?q=${enc(opts.search)}&limit=15&sort=-popularity${c}`
        : `/api/v1/anime?limit=15&genre_all=${enc(opts.genre ?? '')}&sort=-popularity${c}`;
      const res = await get<List<MiruroShow>>(path, signal);
      return cursorPage(res, remember((res.data ?? []).filter((m) => !m.is_adult).map(toShow)));
    },

    show,

    /** Numbers for the show page (from the show itself; miruro has no separate statistics). */
    stats: async (id: string, signal?: AbortSignal): Promise<Stats> => {
      const s = shows.get(id)?.show ?? (await show(id, signal));
      return {
        average: s.average ?? undefined,
        episodes: s.episode_count_current ?? undefined,
        episodes_total: s.episode_count ?? undefined,
        audio_languages: s.hasDub ? ['Japanese', 'English'] : ['Japanese'],
      };
    },

    episodeRows,

    /** A page of episodes (100 to a page), in either order, from the show's full list. */
    episodes: async (id: string, n: number, order: 'asc' | 'desc', perPage = 100, signal?: AbortSignal): Promise<Page<Episode>> => {
      const rows = await episodeRows(id, signal);
      const eps = rows.map((e) => toEpisode(id, e));
      return page(order === 'asc' ? eps : [...eps].reverse(), n, perPage);
    },
  };
}

export type Catalog = ReturnType<typeof createCatalog>;
