import { api } from './api';
import { useDownloads } from './downloads/store';
import { epKey, sameTitle } from './migrate';
import { normalize } from './miruro/title';
import { displayName, enc, type MiruroShow } from './catalog';
import { miruroGet } from './miruro/bridge';
import { lite, useStore } from './store';

/**
 * The online half of moving data saved before 1.3 (lib/migrate.ts has the offline half): fill in
 * miruro's names and artwork for moved shows, and look for the shows that couldn't be moved by id,
 * by title on miruro.cx. A few per launch, and only an exact title match counts; a show that
 * isn't found stays listed in My Stuff ("From the old catalog") for the person to find.
 */

const PER_LAUNCH = 5;
const MAX_TRIES = 3;
const DAY = 24 * 60 * 60_000;
let ran = false;

export async function runMigration() {
  if (ran) return;
  ran = true;
  try {
    await refreshArt();
    await findPending();
  } catch {
    // Offline or miruro.cx busy: next launch tries again.
  }
}

/** Moved shows have only an id and a name: give them miruro's names and artwork. */
async function refreshArt() {
  const st = useStore.getState();
  const dl = useDownloads.getState();
  const ids = new Set<string>();
  for (const s of st.myList) if (!s.poster?.original) ids.add(s.id);
  for (const h of Object.values(st.history)) if (!h.show.poster?.original) ids.add(h.show.id);
  for (const d of Object.values(dl.items)) if (!d.legacy && !d.show.poster?.original) ids.add(d.show.id);
  // Ids from before 1.3 that weren't moved have no ':' episodes and aren't miruro's; skip them.
  const wanted = [...ids].filter((id) => !st.pending[id]);
  if (!wanted.length) return;
  const found = await api.byIds(wanted);
  if (!found.size) return;
  const fix = <T extends { id: string }>(s: T): T => {
    const f = found.get(s.id);
    return f ? { ...s, ...lite(f) } : s;
  };
  const now = useStore.getState();
  const history = { ...now.history };
  for (const [k, h] of Object.entries(history)) history[k] = { ...h, show: fix(h.show) };
  useStore.setState({ myList: now.myList.map(fix), history });
  const items = { ...useDownloads.getState().items };
  for (const [k, d] of Object.entries(items)) if (!d.legacy) items[k] = { ...d, show: fix(d.show) };
  useDownloads.setState({ items });
}

/** A few saved shows a launch, by title; exactly one exact match moves it. */
async function findPending() {
  const now = Date.now();
  const due = Object.entries(useStore.getState().pending)
    .filter(([, p]) => p.tries < MAX_TRIES && now - p.lastTry > DAY / 2)
    .slice(0, PER_LAUNCH);
  for (const [oldId, p] of due) {
    let match: MiruroShow | undefined;
    try {
      const res = await miruroGet<{ data?: MiruroShow[] }>(`/api/v1/anime?q=${enc(p.name)}&limit=5&sort=-popularity`);
      const hits = (res.data ?? []).filter((m) => !m.is_adult && sameTitle(p.name, [m.title?.english, m.title?.romaji, m.title?.native], normalize));
      if (hits.length === 1) match = hits[0];
    } catch {
      return; // Try the rest another time.
    }
    const st = useStore.getState();
    if (!match) {
      st.patchPending(oldId, { ...p, tries: p.tries + 1, lastTry: now });
      continue;
    }
    const show = lite((await api.byIds([match.id])).get(match.id) ?? { id: match.id, slug: match.id, name: displayName(match.title) });
    const myList = [...st.myList];
    if (p.listIndex !== null && !myList.some((s) => s.id === show.id)) myList.splice(Math.min(p.listIndex, myList.length), 0, show);
    const history = { ...st.history };
    const progress = { ...st.progress };
    if (p.history && (!history[show.id] || history[show.id].at < p.history.at)) {
      const n = p.history.number;
      history[show.id] = { show, episode: { id: epKey(show.id, n), slug: String(n), number: n, title: p.history.title, duration: p.history.d ?? 0 }, at: p.history.at };
      if (p.history.t !== undefined && p.history.d) progress[epKey(show.id, n)] = { t: p.history.t, d: p.history.d, at: p.history.at };
      for (let i = Math.max(1, n - 200); i < n; i++) progress[epKey(show.id, i)] ??= { t: 1, d: 1, at: p.history.at };
    }
    const pending = { ...st.pending };
    delete pending[oldId];
    useStore.setState({ myList, history, progress, pending, moved: { ...st.moved, [oldId]: show.id } });
    moveLegacyDownloads(oldId, show);
  }
}

/** Downloads of a show that's just been found move onto its new id (their files stay put). */
function moveLegacyDownloads(oldShowId: string, show: ReturnType<typeof lite>) {
  const dl = useDownloads.getState();
  const items = { ...dl.items };
  let order = [...dl.order];
  for (const [id, d] of Object.entries(dl.items)) {
    if (!d.legacy || d.show.id !== oldShowId) continue;
    const newId = epKey(show.id, d.episode.number);
    if (items[newId]) continue;
    delete items[id];
    items[newId] = {
      ...d,
      id: newId,
      show,
      episode: { ...d.episode, id: newId, slug: String(d.episode.number) },
      legacy: undefined,
      // Unfinished ones can carry on now that the show is known.
      ...(d.status === 'failed' && d.fail === 'unmatched' ? { status: 'queued' as const, fail: undefined } : {}),
    };
    order = order.map((x) => (x === id ? newId : x));
  }
  useDownloads.setState({ items, order });
}
