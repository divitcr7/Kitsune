/**
 * Picks the AniList entry that is the same show as an anime.nexus one. Pure, so
 * `scripts/check-miruro.mjs` can test it in Node.
 */

export type AnilistMedia = {
  id: number;
  title: { romaji?: string | null; english?: string | null; native?: string | null };
  synonyms?: string[] | null;
  format?: string | null;
  startDate?: { year?: number | null } | null;
  episodes?: number | null;
};

export type ShowFacts = { name: string; name_alt?: string | null; type?: string | null; release_date?: string | null; episode_count?: number | null };

export function normalize(title: string) {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, ' ')
    .trim();
}

function tokens(s: string) {
  return normalize(s).split(' ').filter(Boolean);
}

/** Dice similarity of two titles' word sets. */
export function similarity(a: string, b: string) {
  const x = tokens(a);
  const y = new Set(tokens(b));
  if (!x.length || !y.size) return 0;
  const shared = x.filter((t) => y.has(t)).length;
  return (2 * shared) / (x.length + y.size);
}

// Numbers carry the season ("season 2", "2nd season", "part 2"); titles that disagree on them are
// different shows even when every other word matches.
function numbers(s: string) {
  return (normalize(s).match(/\d+/g) ?? []).join(' ');
}

const FORMATS: Record<string, string[]> = {
  tv: ['TV', 'TV_SHORT'],
  movie: ['MOVIE'],
  ova: ['OVA'],
  ona: ['ONA'],
  special: ['SPECIAL', 'TV_SHORT'],
  music: ['MUSIC'],
};

export function yearOf(date?: string | null) {
  const m = date?.match(/\d{4}/);
  return m ? Number(m[0]) : undefined;
}

export function score(show: ShowFacts, media: AnilistMedia, query: string) {
  const titles = [media.title.romaji, media.title.english, media.title.native, ...(media.synonyms ?? [])].filter((t): t is string => !!t);
  const q = normalize(query);
  let s = 0;
  if (titles.some((t) => normalize(t) === q)) s += 60;
  else {
    const best = Math.max(0, ...titles.map((t) => (numbers(t) === numbers(query) ? similarity(query, t) : 0)));
    if (best >= 0.6) s += 50 * best;
  }
  const year = yearOf(show.release_date);
  const y = media.startDate?.year;
  if (year && y) s += y === year ? 25 : Math.abs(y - year) === 1 ? 10 : -30;
  const fmt = show.type ? FORMATS[show.type.toLowerCase()] : undefined;
  if (fmt && media.format) s += fmt.includes(media.format) ? 10 : -10;
  if (show.episode_count && media.episodes && show.episode_count === media.episodes) s += 10;
  return s;
}

/** The confident best match, or undefined. */
export function pick(show: ShowFacts, list: AnilistMedia[], query: string): AnilistMedia | undefined {
  const ranked = list.map((m) => ({ m, s: score(show, m, query) })).sort((a, b) => b.s - a.s);
  const [top, next] = ranked;
  if (!top || top.s < 70) return undefined;
  if (next && top.s - next.s < 10) return undefined;
  return top.m;
}
