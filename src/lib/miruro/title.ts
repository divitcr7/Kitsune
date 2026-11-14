/**
 * Comparing show titles, for moving shows saved before 1.3 (keyed by anime.nexus) onto miruro.cx.
 * Pure, so `scripts/check-miruro.mjs` can test it.
 */

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
export function numbers(s: string) {
  return (normalize(s).match(/\d+/g) ?? []).join(' ');
}
