import { useMemo, useState } from 'preact/hooks';
import type { Episode, Show, Stats } from '@/lib/api';
import { clock, compact, minutes, year } from '@/lib/format';
import { imgUrl } from '@/lib/img';
import { api, useData } from '../api';
import { playEpisode, previewOf } from '../nav';
import { type EpisodeLite, fraction, resumePoint, store, useStore } from '../store';
import { Btn, Icon, Img, on, ProgressBar, Spinner } from './kit';

const PER_PAGE = 100;
/** Episode rows render in batches as focus nears the end, so a 100-episode page stays light. */
const BATCH = 24;

export function ShowScreen({ id }: { id: string }) {
  const detail = useData(`show:${id}`, () => api.show(id));
  const stats = useData(`stats:${id}`, () => api.stats(id));
  const show = detail.data ?? previewOf(id);

  return (
    <div className="k-screen">
      <Backdrop show={show} />
      <div className="k-page" data-page="150">
        {show ? (
          <Body show={show} stats={stats.data} />
        ) : detail.error ? (
          <div className="k-error" style={{ paddingTop: 300 }}>
            <div className="t-title">Couldn’t load this show</div>
            <div className="t-body k-dim">Press Back and try again in a moment.</div>
          </div>
        ) : (
          <div style={{ padding: '420px 0 0 900px' }}>
            <Spinner />
          </div>
        )}
      </div>
    </div>
  );
}

function Backdrop({ show }: { show?: Show }) {
  const src = imgUrl(show?.background ?? show?.backdrop, 'background', '1920x1080') ?? imgUrl(show?.poster, 'poster', '1560x2340');
  return (
    <div className="k-backdrop">
      <Img src={src} />
      <div className="fade" />
      <div className="floor" />
    </div>
  );
}

function Body({ show, stats }: { show: Show; stats?: Stats }) {
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [shown, setShown] = useState(BATCH);
  const episodes = useData(`episodes:${show.id}:${page}:${order}`, () => api.episodes(show.id, page, order), { stale: 2 * 60_000 });
  const entry = useStore((s) => s.history[show.id]);
  const lastProgress = useStore((s) => (entry ? s.progress[entry.episode.id] : undefined));
  const inList = useStore((s) => s.myList.some((m) => m.id === show.id));

  const total = episodes.data?.meta.total ?? 0;
  const pages = Math.ceil(total / PER_PAGE);
  const list = episodes.data?.data;

  const upNext: EpisodeLite | undefined = useMemo(() => {
    if (entry) {
      if (lastProgress && fraction(lastProgress) > 0.92) return list?.find((e) => e.number === entry.episode.number + 1) ?? entry.episode;
      return entry.episode;
    }
    return order === 'asc' && page === 1 ? list?.[0] : undefined;
  }, [entry, lastProgress, list, order, page]);
  const resumeAt = upNext && entry && upNext.id === entry.episode.id ? resumePoint(lastProgress) : 0;

  const score = stats?.average?.score ?? show.average?.score;
  const eps = show.episode_count_current ?? show.episode_count;
  const dub = stats?.audio_languages?.some((l) => /^(eng|english)/i.test(l));
  const meta = [show.type, year(show.release_date), eps ? `${eps} Episodes` : undefined, stats?.audio_languages?.length ? (dub ? 'Sub & Dub' : 'Sub') : undefined].filter(Boolean);
  const logo = imgUrl(show.logo, 'logo', 'large');

  return (
    <div>
      <div className="k-show-top" data-row="">
        {logo ? <img className="k-show-logo" src={logo} alt={show.name} /> : <div className="t-hero k-clamp2">{show.name}</div>}
        <div className="k-meta">
          {score ? (
            <span className="score">
              <Icon name="star" size={24} />
              {score.toFixed(1)}
            </span>
          ) : null}
          {meta.join('   ·   ')}
        </div>
        {show.genres?.length ? (
          <div className="t-caption k-faint" style={{ marginTop: 8 }}>
            {show.genres
              .slice(0, 4)
              .map((g) => g.name)
              .join('   ·   ')}
          </div>
        ) : null}
        {show.description ? <div className="k-show-syn t-body k-dim k-clamp3">{show.description.trim()}</div> : null}
        <div className="k-btns">
          <Btn
            k="show:play"
            autofocus
            primary
            icon="play"
            label={upNext ? `${resumeAt ? 'Resume' : 'Play'} Episode ${upNext.number}` : 'Play'}
            sub={resumeAt && lastProgress ? `· ${clock(lastProgress.d - lastProgress.t)} left` : undefined}
            onClick={() => upNext && playEpisode(show, upNext)}
          />
          <Btn k="show:list" icon={inList ? 'check' : 'plus'} label={inList ? 'In My List' : 'My List'} onClick={() => store.toggleList(show)} />
          <Btn
            k="show:order"
            icon={order === 'asc' ? 'sortNumericAscending' : 'sortNumericDescending'}
            label={order === 'asc' ? 'Oldest first' : 'Newest first'}
            onClick={() => {
              setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
              setPage(1);
              setShown(BATCH);
            }}
          />
        </div>
        {resumeAt && lastProgress ? (
          <div className="k-play-bar">
            <i style={{ width: `${Math.round(fraction(lastProgress) * 100)}%` }} />
          </div>
        ) : null}
      </div>

      <div className="k-eps">
        <div className="t-title" style={{ marginBottom: 18 }}>
          Episodes <span className="t-heading k-faint">{total || ''}</span>
        </div>
        {pages > 1 ? (
          <div className="k-chips" data-row="" data-g="pages">
            {Array.from({ length: pages }, (_, i) => {
              const a = order === 'asc' ? i * PER_PAGE + 1 : total - i * PER_PAGE;
              const b = order === 'asc' ? Math.min(total, (i + 1) * PER_PAGE) : Math.max(1, total - (i + 1) * PER_PAGE + 1);
              return (
                <div
                  key={i}
                  className={`k-chip${page === i + 1 ? ' on' : ''}`}
                  data-f=""
                  data-k={`page:${i}`}
                  onClick={() => {
                    setPage(i + 1);
                    setShown(BATCH);
                  }}
                >
                  {a}–{b}
                </div>
              );
            })}
          </div>
        ) : null}
        <div
          style={{ opacity: episodes.loading && list ? 0.5 : 1 }}
          {...on('kfocus', (e) => {
            const i = Number((e.target as HTMLElement).getAttribute('data-i'));
            if (list && i >= shown - 6 && shown < list.length) setShown((n) => n + BATCH);
          })}
        >
          {list ? (
            list.slice(0, shown).map((ep, i) => <EpisodeRow key={ep.id} show={show} ep={ep} index={i} current={upNext?.id === ep.id} />)
          ) : episodes.error ? (
            <div className="t-body k-dim">Couldn’t load episodes. Press Back and try again.</div>
          ) : (
            <Spinner />
          )}
          {list && !list.length ? <div className="t-body k-dim">No episodes yet. Check back soon.</div> : null}
        </div>
        <Info show={show} stats={stats} />
      </div>
    </div>
  );
}

function EpisodeRow({ show, ep, index, current }: { show: Show; ep: Episode; index: number; current: boolean }) {
  const p = useStore((s) => s.progress[ep.id]);
  const tags = [ep.is_filler ? 'Filler' : null, ep.is_recap ? 'Recap' : null].filter(Boolean);
  return (
    <div className="k-ep" data-row="" data-f="" data-k={`ep:${ep.id}`} data-i={index} onClick={() => playEpisode(show, ep)}>
      <div className="k-art">
        <Img src={imgUrl(ep.image, 'episode', '640x360')} />
        <ProgressBar value={fraction(p)} />
      </div>
      <div className="k-ep-text">
        <div className={`t-micro ${current ? 'k-accent' : 'k-faint'}`}>
          {current ? 'Up next  ·  ' : ''}Episode {ep.number}
          {tags.length ? `  ·  ${tags.join(' · ')}` : ''}
        </div>
        <div className="t-heading k-clamp2" style={{ marginTop: 6, fontSize: 28, lineHeight: '36px' }}>
          {ep.title || `Episode ${ep.number}`}
        </div>
        <div className="t-caption k-faint" style={{ marginTop: 6 }}>
          {minutes(ep.duration)}
        </div>
      </div>
    </div>
  );
}

function Info({ show, stats }: { show: Show; stats?: Stats }) {
  const items = [
    { label: 'Status', value: show.status?.replace('Currently Airing', 'Airing').replace('Finished Airing', 'Finished') },
    { label: 'Premiered', value: show.premiered ? `${show.premiered[0].toUpperCase()}${show.premiered.slice(1)} ${year(show.release_date) ?? ''}` : undefined },
    { label: 'Rated', value: show.parental_rating?.split(' - ')[0] },
    { label: 'Subtitles', value: stats?.subtitle_languages?.length ? `${stats.subtitle_languages.length} languages` : undefined },
    { label: 'Followers', value: compact(stats?.followers) },
    { label: 'Also known as', value: show.name_alt && show.name_alt !== show.name ? show.name_alt : undefined },
  ].filter((f): f is { label: string; value: string } => !!f.value);
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 50 }}>
      <div className="t-title">Information</div>
      <div className="k-info">
        {items.map((f) => (
          <div key={f.label}>
            <div className="t-caption k-faint">{f.label}</div>
            <div className="t-label k-clamp2" style={{ marginTop: 6 }}>
              {f.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
