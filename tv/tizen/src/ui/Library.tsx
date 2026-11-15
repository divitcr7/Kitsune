import { useMemo } from 'preact/hooks';
import type { Show } from '@/lib/catalog';
import { minutes, timeAgo } from '@/lib/format';
import { imgUrl } from '@/lib/img';
import { openShow, playEpisode } from '../nav';
import { byRecent, fraction, type HistoryEntry, orderOf, store, useStore } from '../store';
import { Btn, ContinueCard, Fox, Grid, Icon, Img, Rail } from './kit';
import { useShowing } from './showing';

declare const KITSUNE_VERSION: string;

export function Library() {
  // Redrawn each time it comes back into view, so "time ago" is current.
  useShowing();
  // Selected as strings, so progress saved during playback redraws this screen only when what it shows changes.
  const order = useStore((s) => orderOf(byRecent(s.history)));
  const unfinished = useStore((s) => orderOf(byRecent(s.history).filter((e) => fraction(s.progress[e.episode.id]) < 0.92).slice(0, 10)));
  const totals = useStore((s) => {
    let done = 0;
    let seconds = 0;
    for (const p of Object.values(s.progress)) {
      if (p.d && p.t / p.d > 0.85) done++;
      seconds += Math.min(p.t, p.d || p.t);
    }
    const hours = seconds / 3600;
    return [Object.keys(s.history).length, done, hours < 10 ? hours.toFixed(1) : Math.round(hours)].join(' ');
  });
  const myList = useStore((s) => s.myList);
  const entries = useMemo(() => (order ? byRecent(store.get().history) : []), [order]);
  const inProgress = useMemo(
    () => (unfinished ? entries.filter((e) => fraction(store.get().progress[e.episode.id]) < 0.92).slice(0, 10) : []),
    [entries, unfinished],
  );
  const [shows, done, hours] = totals.split(' ');

  return (
    <div className="k-screen">
      <div className="k-page" data-page="150">
        <div className="k-head" data-row="">
          <div className="t-display">My Stuff</div>
          <div className="k-stats">
            <Stat value={shows} label="Shows" />
            <Stat value={done} label="Episodes" />
            <Stat value={hours} label="Hours" />
          </div>
        </div>

        {inProgress.length ? (
          <Rail
            id="lib-continue"
            title="Continue Watching"
            items={inProgress}
            keyOf={(e) => e.show.id}
            width={400}
            height={225}
            render={(e, i, k) => <ContinueCard key={k} entry={e} k={k} autofocus={i === 0} />}
          />
        ) : null}

        <div className="k-rail-head t-title k-section" data-row="">
          My List <span className="t-heading k-faint">{myList.length || ''}</span>
        </div>
        {myList.length ? (
          <Grid id="mylist" shows={myList as Show[]} />
        ) : (
          <div className="k-empty">Press My List on any show to keep it here.</div>
        )}

        <div className="k-rail-head t-title k-section" data-row="">
          History <span className="t-heading k-faint">{entries.length || ''}</span>
        </div>
        <div className="k-pad">
          {entries.length ? (
            entries.map((e) => <HistoryRow key={e.show.id} entry={e} />)
          ) : (
            <div className="t-body k-dim">Everything you watch shows up here, so you can jump right back in.</div>
          )}
        </div>

        <About />
        <div style={{ height: 120 }} />
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="k-stat">
      <div className="t-display">{value}</div>
      <div className="t-caption k-faint">{label}</div>
    </div>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const p = useStore((s) => s.progress[entry.episode.id]);
  const f = fraction(p);
  const left = p && p.d ? Math.max(0, p.d - p.t) : 0;
  const status = f > 0.92 ? 'Watched' : left > 60 ? `${minutes(left)} left` : 'Started';
  return (
    <div className="k-hist" data-row="">
      <div className="k-row" data-f="" data-k={`hist:${entry.show.id}`} onClick={() => playEpisode(entry.show, entry.episode)}>
        <div className="k-art" style={{ width: 72, height: 108 }}>
          <Img src={imgUrl(entry.show.poster, 'poster', '240x360')} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-heading k-one">{entry.show.name}</div>
          <div className="t-caption k-faint k-one" style={{ marginTop: 6 }}>
            Episode {entry.episode.number}  ·  {status}  ·  {timeAgo(entry.at)}
          </div>
          <div className="k-play-bar" style={{ width: 520 }}>
            <i style={{ width: `${Math.max(3, Math.round(f * 100))}%` }} />
          </div>
        </div>
        <Icon name="playCircleOutline" size={44} />
      </div>
      <Btn k={`hist-show:${entry.show.id}`} small icon="informationOutline" label="Show" onClick={() => openShow(entry.show)} />
      <Btn k={`hist-del:${entry.show.id}`} small icon="trashCanOutline" label="Remove" onClick={() => store.removeHistory(entry.show.id)} />
    </div>
  );
}

function About() {
  return (
    <div className="k-pad k-section" data-row="">
      <div style={{ display: 'flex', alignItems: 'center', paddingTop: 30, borderTop: '1px solid rgba(255,255,255,.08)', width: 1100 }}>
        <Fox size={60} />
        <div style={{ marginLeft: 20 }}>
          <div className="t-heading" style={{ fontWeight: 700 }}>
            Kitsune for Samsung TV
          </div>
          <div className="t-caption k-faint">Version {KITSUNE_VERSION}  ·  Open source  ·  github.com/divitcr7/Kitsune</div>
        </div>
      </div>
      <div className="t-caption k-faint" style={{ marginTop: 20, width: 1100, lineHeight: '30px' }}>
        Catalog and streams come from miruro.cx and play in Kitsune’s own player, with no ads. Kitsune isn’t affiliated with miruro.cx and hosts no content.
        Your list and history stay on this TV.
      </div>
    </div>
  );
}
