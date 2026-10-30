export function minutes(seconds: number) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function year(date?: string | null) {
  return date ? date.slice(0, 4) : undefined;
}

export function compact(n?: number | string | null) {
  const v = Number(n);
  if (!Number.isFinite(v)) return undefined;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(v);
}

/** "16:00:00" → "16:00". Broadcast times come from MyAnimeList and are in JST. */
export function broadcastTime(b?: string | null) {
  return b ? b.slice(0, 5) : undefined;
}

export function audioLabel(langs?: string[]) {
  if (!langs?.length) return undefined;
  const dub = langs.some((l) => /^(eng|english)/i.test(l));
  const sub = langs.some((l) => /^(jpn|japanese)/i.test(l));
  if (dub && sub) return 'SUB · DUB';
  if (dub) return 'DUB';
  return 'SUB';
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function timeAgo(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
