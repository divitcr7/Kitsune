import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Show } from '@/lib/api';
import { minutes, timeAgo } from '@/lib/format';
import { imgUrl } from '@/lib/img';
import { checkSignedIn, openShow, playEpisode, router } from '../nav';
import { fraction, type HistoryEntry, store, useStore } from '../store';
import { Btn, ContinueCard, Fox, Grid, Icon, Img, Rail } from './kit';

declare const KITSUNE_VERSION: string;

export function Library() {
  const history = useStore((s) => s.history);
  const progress = useStore((s) => s.progress);
  const myList = useStore((s) => s.myList);
  const entries = useMemo(() => Object.values(history).sort((a, b) => b.at - a.at), [history]);
  const inProgress = useMemo(() => entries.filter((e) => fraction(progress[e.episode.id]) < 0.92).slice(0, 10), [entries, progress]);

  const stats = useMemo(() => {
    let done = 0;
    let seconds = 0;
    for (const p of Object.values(progress)) {
      if (p.d && p.t / p.d > 0.85) done++;
      seconds += Math.min(p.t, p.d || p.t);
    }
    const hours = seconds / 3600;
    return { shows: entries.length, done, hours: hours < 10 ? hours.toFixed(1) : String(Math.round(hours)) };
  }, [progress, entries.length]);

  return (
    <div className="k-screen">
      <div className="k-page" data-page="150">
        <div className="k-head" data-row="">
          <div className="t-display">My Stuff</div>
          <div className="k-stats">
            <Stat value={String(stats.shows)} label="Shows" />
            <Stat value={String(stats.done)} label="Episodes" />
            <Stat value={stats.hours} label="Hours" />
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

        <div className="k-rail-head t-title k-section" data-row="">
          Account
        </div>
        <div className="k-pad" data-row="">
          <AccountRow />
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

function AccountRow() {
  const signedIn = useStore((s) => s.signedIn);
  return (
    <div className="k-row" data-f="" data-k="lib:account" onClick={() => router.go({ name: 'account' })} style={{ borderTop: 0 }}>
      <Icon name="accountCircleOutline" size={56} />
      <div style={{ flex: 1, marginLeft: 24 }}>
        <div className="t-heading">anime.nexus account</div>
        <div className="t-caption k-faint" style={{ marginTop: 4 }}>
          {signedIn ? 'Signed in  ·  manage or sign out' : 'Sign in so streams don’t get interrupted'}
        </div>
      </div>
      <Icon name="chevronRight" size={40} className="go" />
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
        Catalog and streams come from anime.nexus and play in its own player. Kitsune isn’t affiliated with anime.nexus and hosts no content.
        Your list and history stay on this TV.
      </div>
    </div>
  );
}

export function Account() {
  const signedIn = useStore((s) => s.signedIn);
  const [checking, setChecking] = useState(false);

  const check = () => {
    setChecking(true);
    checkSignedIn().then(
      () => setChecking(false),
      () => setChecking(false),
    );
  };
  useEffect(check, []);

  const go = (path: string) => {
    if (window.__kitsuneDev) return console.log('[dev] open', path);
    location.replace(path);
  };

  return (
    <div className="k-screen">
      <div className="k-head" style={{ paddingTop: 120 }}>
        <div className="t-display">anime.nexus account</div>
        <div className={`t-heading ${signedIn ? 'k-accent' : 'k-faint'}`} style={{ marginTop: 10 }}>
          {checking && signedIn === null ? 'Checking…' : signedIn ? 'Signed in' : 'Not signed in'}
        </div>
        <div className="t-body k-dim" style={{ marginTop: 26, width: 1100 }}>
          {signedIn
            ? 'Streams play as you, with no guest limits. You can manage your account or sign out on anime.nexus’s settings page.'
            : 'anime.nexus limits how many guest streams a TV can start. Sign in once with your anime.nexus email and password and Kitsune streams as you. Your login is only sent to anime.nexus.'}
        </div>
        <div className="k-btns" style={{ marginTop: 40 }}>
          {signedIn ? (
            <Btn k="acct:manage" autofocus primary icon="accountCircleOutline" label="Account settings" onClick={() => go('/user/settings')} />
          ) : (
            <Btn k="acct:signin" autofocus primary icon="login" label="Sign in" onClick={() => go('/login')} />
          )}
          <Btn k="acct:check" icon="refresh" label={checking ? 'Checking…' : 'Check again'} onClick={check} />
        </div>
        <div className="t-caption k-faint" style={{ marginTop: 34, width: 1100, lineHeight: '30px' }}>
          Signed up with Google? Google doesn’t allow its sign-in on TVs. Add a password to your account on anime.nexus in a browser, then sign in here with your email.
        </div>
      </div>
    </div>
  );
}
