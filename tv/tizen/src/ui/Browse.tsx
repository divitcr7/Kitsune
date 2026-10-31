/* eslint-disable react-hooks/immutability -- false positives: the React Compiler lint does not recognise preact/hooks' useRef, so it treats ref writes (even inside effects) as mutating a frozen hook value. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Genre, Page, Show } from '@/lib/api';
import { broadcastTime, WEEKDAYS } from '@/lib/format';
import { imgUrl } from '@/lib/img';
import { api, useData } from '../api';
import { focus, focused } from '../focus';
import { openShow, router } from '../nav';
import { Grid, Icon, Img, on, plainText, Rail, Spinner } from './kit';

// Deep, low-key gradients for the category tiles (same as the phone).
const TILES: [string, string][] = [
  ['#6B2A16', '#1C0C07'],
  ['#2A2870', '#0B0B20'],
  ['#0F5552', '#061817'],
  ['#5A1F57', '#170818'],
  ['#6A1A2C', '#1C070C'],
  ['#2B4060', '#0B1119'],
  ['#6A4C14', '#1C1406'],
  ['#3E4A18', '#111506'],
];

/** Infinite list of pages: `more()` asks for the next one, an effect fetches it. */
function usePages(key: string, enabled: boolean, fetchPage: (page: number) => Promise<Page<Show>>) {
  // Pages are kept with the query they belong to, so a new query never shows the old results.
  const [state, setState] = useState<{ key: string; pages: Page<Show>[]; want: number }>({ key, pages: [], want: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fetcher = useRef(fetchPage);
  useEffect(() => {
    fetcher.current = fetchPage;
  });

  const current = state.key === key ? state : { key, pages: [] as Page<Show>[], want: 1 };
  const { pages, want } = current;
  const last = pages[pages.length - 1];
  const done = !!last && last.meta.current_page >= last.meta.last_page;

  useEffect(() => {
    if (!enabled || done || pages.length >= want) return;
    let live = true;
    setLoading(true);
    fetcher.current(pages.length + 1).then(
      (p) => {
        if (!live) return;
        setState((s) => {
          const base = s.key === key ? s : { key, pages: [], want: 1 };
          return { ...base, pages: base.pages.concat(p) };
        });
        setLoading(false);
        setError(false);
      },
      () => {
        if (!live) return;
        setLoading(false);
        setError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [key, enabled, done, pages.length, want]);

  const shows = useMemo(() => (pages.length ? pages.reduce<Show[]>((all, p) => all.concat(p.data), []) : undefined), [pages]);
  const more = () => {
    if (!done && !loading) setState((s) => (s.key === key ? { ...s, want: Math.max(s.want, s.pages.length + 1) } : { key, pages: [], want: 1 }));
  };
  return { shows, total: pages[0]?.meta.total, loading, error, more };
}

export function Search() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const genres = useData('genres', api.genres, { persist: true, stale: 24 * 60 * 60_000 });

  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);

  const searching = query.length > 1;
  const results = usePages(`search:${query}`, searching, (page) => api.shows({ search: query, page }));
  const popular = usePages('popular-week', !searching, (page) => api.discover('popular', page));
  const source = searching ? results : popular;
  const main = useMemo(() => genres.data?.filter((g) => g.type === 'genre'), [genres.data]);

  return (
    <div className="k-screen">
      <div className="k-page" data-page="150">
        <div className="k-head" data-row="">
          <div className="t-display">Search</div>
          <div
            className="k-search"
            data-f=""
            data-k="search:field"
            data-autofocus=""
            onClick={() => input.current?.focus()}
          >
            <Icon name="magnify" size={34} />
            <input
              ref={input}
              value={text}
              placeholder="Shows, movies, Japanese titles"
              autoComplete="off"
              autoCorrect="off"
              {...plainText}
              onInput={(e) => setText((e.target as HTMLInputElement).value)}
              onBlur={() => {
                // Back on the remote's focus ring once the keyboard closes.
                const wrap = input.current?.parentElement as HTMLElement | null;
                if (wrap && focused() !== wrap) focus(wrap);
              }}
            />
          </div>
        </div>

        {!searching && main?.length ? (
          <Rail
            id="genres"
            title="Browse Categories"
            items={main}
            keyOf={(g) => g.id}
            width={330}
            height={150}
            render={(g: Genre, i, k) => (
              <div
                key={k}
                className="k-tile"
                data-f=""
                data-k={k}
                style={{ background: `linear-gradient(135deg, ${TILES[i % TILES.length][0]}, ${TILES[i % TILES.length][1]})` }}
                onClick={() => router.go({ name: 'genre', id: g.id, title: g.name })}
              >
                {g.name}
              </div>
            )}
          />
        ) : null}

        <div className="k-rail-head t-title" style={{ marginTop: 46 }} data-row="">
          {searching ? (results.shows ? `${results.total ?? results.shows.length} Results` : 'Searching…') : 'Popular This Week'}
        </div>
        {searching && results.shows && !results.shows.length ? (
          <div className="k-empty">
            Nothing for “{query}”. Try the English or Japanese title.
          </div>
        ) : (
          <Grid id={searching ? 'results' : 'popular'} shows={source.shows} loading={source.loading} onNearEnd={source.more} />
        )}
        {source.loading && source.shows ? (
          <div style={{ padding: '10px 0 40px 930px' }}>
            <Spinner />
          </div>
        ) : null}
        {source.error && !source.shows ? <div className="k-empty">Couldn’t reach anime.nexus. Try again in a moment.</div> : null}
        <div style={{ height: 120 }} />
      </div>
    </div>
  );
}

export function GenreScreen({ id, title }: { id: string; title: string }) {
  const shows = usePages(`genre:${id}`, true, (page) => api.shows({ genre: id, page }));
  return (
    <div className="k-screen">
      <div className="k-page" data-page="80">
        <div className="k-head" style={{ paddingTop: 80, marginBottom: 36 }} data-row="">
          <div className="t-display">{title}</div>
          {shows.total ? <div className="t-body k-dim k-sub">{shows.total} shows</div> : null}
        </div>
        <Grid id="genre" shows={shows.shows} loading={shows.loading} onNearEnd={shows.more} />
        {shows.error && !shows.shows ? <div className="k-empty">Couldn’t reach anime.nexus. Press Back and try again.</div> : null}
        <div style={{ height: 120 }} />
      </div>
    </div>
  );
}

// Monday-first week, like the phone.
const DAYS = [1, 2, 3, 4, 5, 6, 0].map((d) => WEEKDAYS[d]);

export function Schedule() {
  const today = DAYS.indexOf(WEEKDAYS[new Date().getDay()]);
  const [day, setDay] = useState(today);
  const schedule = useData('schedule', api.schedule, { persist: true });

  const byDay = useMemo(() => {
    const map: Record<string, Show[]> = {};
    for (const s of schedule.data ?? []) (map[s.release_day ?? ''] = map[s.release_day ?? ''] || []).push(s);
    for (const list of Object.values(map)) list.sort((a, b) => (a.broadcast ?? '99').localeCompare(b.broadcast ?? '99'));
    return map;
  }, [schedule.data]);
  const shows = byDay[DAYS[day]] ?? [];

  return (
    <div className="k-screen">
      <div className="k-page" data-page="150">
        <div className="k-head" data-row="">
          <div className="t-display">Schedule</div>
          <div className="k-days" data-g="days">
            {DAYS.map((d, i) => (
              <div
                key={d}
                className={`k-day${i === day ? ' on' : ''}${i === today ? ' today' : ''}`}
                data-f=""
                data-k={`day:${d}`}
                {...(i === today ? { 'data-autofocus': '' } : {})}
                {...on('kfocus', () => setDay(i))}
              >
                {d.slice(0, 3)}
              </div>
            ))}
          </div>
        </div>
        <div className="k-pad" style={{ marginTop: 30 }}>
          {schedule.loading && !schedule.data ? (
            <Spinner />
          ) : shows.length ? (
            shows.map((s) => <ScheduleRow key={s.id} show={s} />)
          ) : (
            <div className="t-body k-dim" style={{ paddingTop: 20 }}>
              <Icon name="weatherNight" size={36} /> Nothing airing this day.
            </div>
          )}
        </div>
        <div style={{ height: 120 }} />
      </div>
    </div>
  );
}

/** TV-guide row: air time on the left, then the show. */
function ScheduleRow({ show }: { show: Show }) {
  const time = broadcastTime(show.broadcast);
  return (
    <div className="k-row" data-row="" data-f="" data-k={`sched:${show.id}`} onClick={() => openShow(show)}>
      <div className="k-time">
        <div className="t-title">{time ?? 'TBA'}</div>
        {time ? <div className="t-micro k-faint">JST</div> : null}
      </div>
      <div className="k-art">
        <Img src={imgUrl(show.poster, 'poster', '240x360')} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-heading k-one" style={{ fontSize: 30, lineHeight: '38px' }}>
          {show.name}
        </div>
        <div className="t-caption k-faint k-one" style={{ marginTop: 6 }}>
          {[show.type, show.genres?.slice(0, 2).map((g) => g.name).join(', ')].filter(Boolean).join('  ·  ')}
        </div>
      </div>
      <Icon name="chevronRight" size={40} className="go" />
    </div>
  );
}
