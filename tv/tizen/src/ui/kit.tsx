import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { LatestItem, Show } from '@/lib/api';
import { audioLabel, minutes } from '@/lib/format';
import { imgUrl } from '@/lib/img';
import { openShow, playEpisode } from '../nav';
import { fraction, type HistoryEntry, useStore } from '../store';
import { ICONS, type IconName } from './icons';

export function Icon({ name, size = 28, className: cls = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`k-icon ${cls}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** The Kitsune fox mask (same paths as the phone's Logo), as static markup. */
const FOX_SVG =
  '<defs><linearGradient id="kfox" x1="0" y1="0" x2="0.9" y2="1"><stop offset="0" stop-color="#FFB347"/><stop offset="0.55" stop-color="#FF5E7E"/><stop offset="1" stop-color="#B45CFF"/></linearGradient></defs>' +
  '<path fill="url(#kfox)" fill-rule="evenodd" d="M12,6 L40,30 L60,30 L88,6 L86,48 L66,72 L50,92 L34,72 L14,48 Z M27,48 L44,54 L41,59 L30,55 Z M73,48 L56,54 L59,59 L70,55 Z M45,80 L55,80 L50,86 Z"/>' +
  '<path fill="#fff" fill-opacity="0.32" d="M19,16 L35,30 L23,40 Z M81,16 L65,30 L77,40 Z"/>';

export function Fox({ size = 44 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="8 2 84 94" aria-hidden="true" dangerouslySetInnerHTML={{ __html: FOX_SVG }} />;
}

/** An image that simply disappears if it fails, leaving the dark tile behind it. */
export function Img({ src, className: cls, style }: { src?: string; className?: string; style?: JSX.CSSProperties }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) return null;
  return <img src={src} className={cls} style={style} alt="" onError={() => setBroken(true)} />;
}

/** For email and search fields: no spellcheck squiggles on a TV. */
export const plainText = { spellcheck: false } as const;

/** Listen for the focus engine's custom events (kfocus, kblur, kedge) on an element. */
export function on(event: 'kfocus' | 'kblur' | 'kedge', fn: (e: CustomEvent) => void): Record<string, unknown> {
  return { [`on${event}`]: fn };
}

type Focusable = { k: string; onClick?: () => void; autofocus?: boolean };

function focusProps({ k, onClick, autofocus }: Focusable) {
  return { 'data-f': '', 'data-k': k, onClick, ...(autofocus ? { 'data-autofocus': '' } : {}) };
}

export function Btn({
  label,
  icon,
  sub,
  primary,
  small,
  ...f
}: Focusable & { label: string; icon?: IconName; sub?: string; primary?: boolean; small?: boolean }) {
  return (
    <div className={`k-btn${primary ? ' primary' : ''}${small ? ' sm' : ''}`} {...focusProps(f)}>
      {icon ? <Icon name={icon} size={small ? 26 : 32} /> : null}
      {label}
      {sub ? <span className="sub">{sub}</span> : null}
    </div>
  );
}

export function Spinner() {
  return <div className="k-spin" />;
}

/** A titled shelf that scrolls sideways as focus moves along it. */
export function Rail<T>({
  id,
  title,
  items,
  keyOf,
  render,
  height,
  width,
  first,
}: {
  id: string;
  title: string;
  items: T[] | undefined;
  keyOf: (item: T) => string;
  render: (item: T, index: number, key: string) => ComponentChildren;
  height: number;
  width: number;
  first?: boolean;
}) {
  if (items && !items.length) return null;
  return (
    <section className={`k-rail${first ? ' first' : ''}`} data-row="" data-g={id}>
      <div className="k-rail-head t-title">{title}</div>
      <div className="k-rail-view">
        <div className="k-track" data-track="">
          {items
            ? items.map((it, i) => render(it, i, `${id}:${keyOf(it)}`))
            : [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="k-skel" style={{ width, height }} />)}
        </div>
      </div>
    </section>
  );
}

export function ProgressBar({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <div className="k-bar">
      <i style={{ width: `${Math.max(3, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function PosterArt({ show, width }: { show: Pick<Show, 'poster'>; width: number }) {
  return (
    <div className="k-art" style={{ width, height: Math.round(width * 1.5) }}>
      <Img src={imgUrl(show.poster, 'poster', width > 260 ? '640x960' : '480x720')} />
    </div>
  );
}

export function PosterCard({ show, width, k, caption, autofocus }: { show: Show; width: number; k: string; caption?: boolean; autofocus?: boolean }) {
  return (
    <div className="k-card" style={{ width }} {...focusProps({ k, onClick: () => openShow(show), autofocus })}>
      <PosterArt show={show} width={width} />
      {caption ? <div className="k-cap t-label k-one">{show.name}</div> : null}
    </div>
  );
}

/** Top 10: a huge outlined numeral with the poster overlapping it. */
export function RankCard({ show, rank, k }: { show: Show; rank: number; k: string }) {
  return (
    <div className="k-card k-rank" {...focusProps({ k, onClick: () => openShow(show) })}>
      <div className="k-rank-n">{rank}</div>
      <PosterArt show={show} width={200} />
    </div>
  );
}

function Thumb({ src, fallback, width, children }: { src?: string; fallback?: string; width: number; children?: ComponentChildren }) {
  return (
    <div className="k-art" style={{ width, height: Math.round((width * 9) / 16) }}>
      <Img src={src || fallback} />
      <div className="k-shade" />
      {children}
    </div>
  );
}

/** A freshly released episode: OK plays it. */
export function EpisodeCard({ item, k }: { item: LatestItem; k: string }) {
  const ep = item.episode;
  const progress = useStore((s) => fraction(s.progress[ep.id]));
  const audio = audioLabel(ep.video_meta?.audio_languages);
  return (
    <div className="k-card" style={{ width: 384 }} {...focusProps({ k, onClick: () => playEpisode(item, ep) })}>
      <Thumb src={imgUrl(ep.image, 'episode', '640x360')} fallback={imgUrl(item.background ?? item.poster, 'background', '960x540')} width={384}>
        <div className="k-ep-corner">
          <Icon name="play" size={22} />
          EP {ep.number}
          {audio ? <span style={{ opacity: 0.7, marginLeft: 6 }}>· {audio}</span> : null}
        </div>
        <ProgressBar value={progress} />
      </Thumb>
      <div className="k-cap">
        <div className="t-label k-one">{item.name}</div>
        <div className="t-caption k-dim k-one" style={{ marginTop: 4 }}>
          {ep.title || `Episode ${ep.number}`} · {minutes(ep.duration)}
        </div>
      </div>
    </div>
  );
}

/** Continue Watching: still frame, progress along the bottom, time left underneath. */
export function ContinueCard({ entry, k, autofocus }: { entry: HistoryEntry; k: string; autofocus?: boolean }) {
  const p = useStore((s) => s.progress[entry.episode.id]);
  const left = p && p.d ? Math.max(0, p.d - p.t) : 0;
  return (
    <div className="k-card" style={{ width: 400 }} {...focusProps({ k, onClick: () => playEpisode(entry.show, entry.episode), autofocus })}>
      <Thumb
        src={imgUrl(entry.episode.image, 'episode', '640x360')}
        fallback={imgUrl(entry.show.background ?? entry.show.poster, 'background', '960x540')}
        width={400}
      >
        <div className="k-ep-corner">
          <Icon name="play" size={24} />
        </div>
        <ProgressBar value={Math.max(0.03, fraction(p))} />
      </Thumb>
      <div className="k-cap">
        <div className="t-label k-one">{entry.show.name}</div>
        <div className="t-caption k-dim k-one" style={{ marginTop: 4 }}>
          Episode {entry.episode.number}
          {left > 60 ? `  ·  ${minutes(left)} left` : ''}
        </div>
      </div>
    </div>
  );
}

/** Poster grid in rows of six; each row is a scroll stop. */
export function Grid({
  id,
  shows,
  loading,
  onNearEnd,
}: {
  id: string;
  shows: Show[] | undefined;
  loading?: boolean;
  onNearEnd?: () => void;
}) {
  const W = 266;
  const rows: Show[][] = [];
  for (let i = 0; shows && i < shows.length; i += 6) rows.push(shows.slice(i, i + 6));
  if (loading && !shows) {
    return (
      <div className="k-gridrow" style={{ display: 'flex', padding: '0 96px' }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="k-skel" style={{ width: W, height: W * 1.5, marginRight: i < 5 ? 26 : 0 }} />
        ))}
      </div>
    );
  }
  return (
    <div
      {...on('kfocus', (e) => {
        const row = (e.target as HTMLElement).closest('[data-gridrow]');
        if (row && onNearEnd && Number(row.getAttribute('data-gridrow')) >= rows.length - 2) onNearEnd();
      })}
    >
      {rows.map((row, r) => (
        <div key={r} data-row="" data-gridrow={r} style={{ display: 'flex', padding: '0 96px', marginBottom: 40 }}>
          {row.map((s, i) => (
            <div key={s.id} style={{ marginRight: i < 5 ? 26 : 0 }}>
              <PosterCard show={s} width={W} k={`${id}:${s.id}`} caption />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
