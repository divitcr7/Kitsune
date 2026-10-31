/* eslint-disable react-hooks/immutability -- false positives: the React Compiler lint does not recognise preact/hooks' useRef, so it treats ref writes (even inside effects) as mutating a frozen hook value. */
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { clock } from '@/lib/format';
import { flushScript, playerScript } from '@/lib/inject';
import { installBridge, type Msg, onMessage, runScript } from './bridge';
import { activate, focusInitial, move } from './focus';
import { type Action, onKeys } from './keys';
import { backToUi, findEpisode, resumeAt, watchUrl } from './nav';
import { addStyles, fit, isChallenge, whenParsed } from './shell';
import { type Playing, session, store } from './store';
import { Btn, Icon, Spinner } from './ui/kit';
import type { IconName } from './ui/icons';

const READY_TIMEOUT = 15_000;
const OSD_HIDE = 4000;
/** Seek steps grow while the same direction is pressed again within STREAK_GAP. */
const STREAK_GAP = 700;
export const seekStep = (streak: number) => (streak < 3 ? 10 : streak < 6 ? 30 : 60);

type Tick = { t: number; d: number; paused: boolean; buffering: boolean; audio: string | null; subs: string | null; fill: boolean; number?: number };

/** Keys arrive from the very start; the overlay picks them up once it has mounted. */
let handle: ((a: Action) => boolean) | null = null;

export function startPlayer(episode: { id: string; slug: string }) {
  installBridge();
  // The site's own player page, with the shared guard and TV remote control (src/lib/inject.ts).
  runScript(playerScript({ id: episode.id, t: resumeAt(episode.id), preload: false, tv: true }));
  onKeys((a) => (handle ? handle(a) : a === 'back' ? (leave(), true) : false));
  whenParsed(() => {
    if (isChallenge()) return; // Cloudflare reloads into the player once it's satisfied.
    addStyles();
    const host = document.createElement('div');
    host.id = 'kitsune-player';
    // The shared script hides unknown full-screen overlays as ads; this one stays.
    host.setAttribute('data-kitsune-keep', '');
    document.body.appendChild(host);
    fit(host);
    render(<Player episode={episode} />, host);
  });
}

function leave() {
  runScript(flushScript);
  setTimeout(() => backToUi(), 120);
}

function cmd(name: string, arg = 0) {
  window.__kitsuneCmd?.(name, arg);
}

function Player({ episode }: { episode: { id: string; slug: string } }) {
  const playing = useRef(session.get<Playing>('playing'));
  const show = playing.current?.show;
  const [now, setNow] = useState({ id: episode.id, slug: episode.slug, number: playing.current?.episode.id === episode.id ? playing.current.episode.number : undefined });
  const [tick, setTick] = useState<Tick | null>(null);
  const [ready, setReady] = useState(false);
  const [osd, setOsd] = useState(true);
  const [controls, setControls] = useState(false);
  const [glyph, setGlyph] = useState<{ icon: IconName; text?: string; key: number } | null>(null);
  const [problem, setProblem] = useState<{ kind: 'auth' | 'stream'; text: string; blocked?: string[] } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [pending, setPending] = useState<{ t: number; at: number } | null>(null);
  const streak = useRef({ dir: 0, n: 0, at: 0, total: 0 });
  const hideAt = useRef(0);
  const ended = useRef(0);

  const nowRef = useRef(now);
  const tickRef = useRef(tick);
  useEffect(() => {
    nowRef.current = now;
    tickRef.current = tick;
  }, [now, tick]);

  // If the page never reports a playable video, take the loader down so a check or error shows.
  useEffect(() => {
    if (ready) return;
    const id = setTimeout(() => setReady(true), READY_TIMEOUT);
    return () => clearTimeout(id);
  }, [ready]);

  // OSD: up while paused or for a few seconds after a key.
  const wake = () => {
    hideAt.current = Date.now() + OSD_HIDE;
    setOsd(true);
  };
  useEffect(() => {
    const id = setInterval(() => {
      if (!controls && !tickRef.current?.paused && Date.now() > hideAt.current) setOsd(false);
    }, 500);
    return () => clearInterval(id);
  }, [controls]);

  const say = (text: string) => setToast({ text, key: Date.now() });

  async function jump(step: 1 | -1) {
    const cur = nowRef.current;
    const number = (tickRef.current?.number ?? cur.number ?? playing.current?.episode.number ?? 0) + step;
    if (!show || number < 1) return say(step > 0 ? 'No next episode' : 'This is the first episode');
    const ep = await findEpisode(show.id, number).catch(() => undefined);
    if (!ep) return say(step > 0 ? 'That’s the latest episode' : 'This is the first episode');
    runScript(flushScript);
    store.recordPlay(show, ep);
    session.set('playing', { ...playing.current, show, episode: ep });
    if (window.__kitsuneDev) return say(`[dev] would open episode ${ep.number}`);
    setTimeout(() => location.replace(watchUrl(ep)), 120);
  }

  function signIn() {
    const cur = nowRef.current;
    session.set('resume', { id: cur.id, slug: cur.slug });
    runScript(flushScript);
    if (window.__kitsuneDev) return say('[dev] would open sign-in');
    setTimeout(() => location.replace('/login'), 120);
  }

  function retry() {
    runScript(flushScript);
    if (window.__kitsuneDev) return say('[dev] would reload');
    setTimeout(() => location.reload(), 120);
  }

  function seek(dir: 1 | -1) {
    const s = streak.current;
    const t = Date.now();
    if (s.dir === dir && t - s.at < STREAK_GAP) s.n += 1;
    else {
      s.n = 1;
      s.total = 0;
    }
    s.dir = dir;
    s.at = t;
    const step = seekStep(s.n) * dir;
    s.total += step;
    cmd('seek', step);
    const base = pending && Date.now() - pending.at < 2000 ? pending.t : (tickRef.current?.t ?? 0);
    const d = tickRef.current?.d ?? 0;
    setPending({ t: Math.max(0, d ? Math.min(d - 1, base + step) : base + step), at: Date.now() });
    const abs = Math.abs(s.total);
    setGlyph({ icon: dir > 0 ? 'fastForward' : 'rewind', text: `${s.total > 0 ? '+' : '−'}${abs >= 60 ? clock(abs) : `${abs}s`}`, key: t });
  }

  function toggle(force?: 'play' | 'pause') {
    const paused = tickRef.current?.paused ?? false;
    const next = force ?? (paused ? 'play' : 'pause');
    cmd(next);
    setGlyph({ icon: next === 'play' ? 'play' : 'pause', key: Date.now() });
  }

  // Messages from the shared player script.
  useEffect(
    () =>
      onMessage((m: Msg) => {
        if (m.type === 'ready') setReady(true);
        if (m.type === 'loading') {
          setReady(false);
          ended.current = 0;
          if (m.number) setNow((n) => ({ ...n, number: m.number }));
        }
        if (m.type === 'tick') {
          setTick({ t: m.t ?? 0, d: m.d ?? 0, paused: !!m.paused, buffering: !!m.buffering, audio: m.audio ?? null, subs: m.subs ?? null, fill: !!m.fill, number: m.number });
          if (m.paused) setOsd(true);
        }
        if (m.type === 'progress' && m.id && m.slug && m.d && isFinite(m.d)) {
          if (show) store.recordProgress(show.id, { id: m.id, slug: m.slug, number: m.number }, m.t ?? 0, m.d);
          setNow({ id: m.id, slug: m.slug, number: m.number ?? nowRef.current.number });
        }
        if (m.type === 'ended') {
          // The site usually moves on by itself; if it doesn't, Kitsune does.
          const at = (ended.current = Date.now());
          setTimeout(() => {
            if (ended.current === at) jump(1);
          }, 6000);
        }
        if (m.type === 'verify') setVerifying(!!m.on);
        if (m.type === 'signin') signIn();
        if (m.type === 'close') leave();
        if (m.type === 'toast' && m.text) say(m.text);
        if (m.type === 'problem' && m.text) {
          if (m.kind === 'auth') cmd('pause');
          setProblem({ kind: m.kind === 'auth' ? 'auth' : 'stream', text: m.text, blocked: m.blocked });
        }
      }, true),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // A settled tick replaces the optimistic seek position.
  useEffect(() => {
    if (pending && tick && (Math.abs(tick.t - pending.t) < 3 || Date.now() - pending.at > 2000)) setPending(null);
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!glyph) return;
    const id = setTimeout(() => setGlyph(null), 900);
    return () => clearTimeout(id);
  }, [glyph]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (problem || controls) setTimeout(() => focusInitial(), 0);
  }, [problem, controls]);

  // The remote. Keys are read through a ref so the handler always sees the latest state.
  const onKey = useRef<(a: Action) => boolean>(() => false);
  useEffect(() => {
    handle = (a) => onKey.current(a);
    return () => {
      handle = null;
    };
  }, []);
  useEffect(() => {
    onKey.current = remote;
  });
  function remote(a: Action): boolean {
    if (problem) {
      if (a === 'back' || a === 'stop') leave();
      else if (a === 'left' || a === 'right' || a === 'up' || a === 'down') move(a);
      else if (a === 'ok') activate();
      return true;
    }
    if (verifying) {
      if (a === 'back') {
        leave();
        return true;
      }
      return false; // The check has focus; let the remote reach it.
    }
    if (controls) {
      wake();
      if (a === 'back' || a === 'up') setControls(false);
      else if (a === 'left' || a === 'right') move(a);
      else if (a === 'ok') activate();
      else if (a === 'playPause') toggle();
      return true;
    }
    wake();
    switch (a) {
      case 'ok':
      case 'playPause':
        toggle();
        break;
      case 'play':
        toggle('play');
        break;
      case 'pause':
        toggle('pause');
        break;
      case 'left':
      case 'rewind':
        seek(-1);
        break;
      case 'right':
      case 'forward':
        seek(1);
        break;
      case 'down':
      case 'info':
        setControls(true);
        break;
      case 'next':
        jump(1);
        break;
      case 'previous':
        jump(-1);
        break;
      case 'back':
      case 'stop':
        leave();
        break;
    }
    return true;
  }

  const number = tick?.number ?? now.number;
  const t = pending ? pending.t : (tick?.t ?? 0);
  const d = tick?.d ?? 0;
  const pct = d ? Math.min(100, (t / d) * 100) : 0;
  const thumb = playing.current?.episode.id === episode.id ? playing.current.thumb : undefined;

  if (!ready && !problem && !verifying) {
    return (
      <div className="p-loader">
        {thumb ? <img src={thumb} alt="" /> : null}
        <div className="shade" />
        <div className="box">
          <Spinner />
          <div className="t-micro k-accent" style={{ marginTop: 30 }}>
            {number ? `Episode ${number}` : 'Up next'}
          </div>
          <div className="t-display k-clamp2" style={{ marginTop: 10 }}>
            {show?.name ?? 'Kitsune'}
          </div>
          <div className="t-caption k-faint" style={{ marginTop: 24 }}>
            Back to leave
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {verifying ? (
        <div className="p-pill">
          <span>Use the remote to tick the box  ·  Back to leave</span>
        </div>
      ) : null}

      <div className={`p-osd p-fade${osd && !verifying && !problem ? '' : ' p-hide'}`}>
        <div className="t-micro k-accent">{number ? `Episode ${number}` : 'Now playing'}</div>
        <div className="t-display k-one p-title">{show?.name ?? document.title.replace(/\s*[|–-].*$/, '')}</div>
        <div className="p-track">
          <div className="fill" style={{ width: `${pct}%` }} />
          {d ? <div className="p-knob" style={{ left: `${pct}%` }} /> : null}
        </div>
        <div className="p-times">
          <span className="p-state">
            <Icon name={tick?.paused ? 'pause' : 'play'} size={30} />
            {tick?.buffering ? 'Buffering…' : clock(t)}
          </span>
          <span>{d ? `−${clock(d - t)}` : ''}</span>
        </div>
        {controls ? (
          <div className="p-row" data-layer="">
            <Btn k="p:next" autofocus small icon="skipNext" label="Next episode" onClick={() => jump(1)} />
            {tick?.audio ? <Btn k="p:audio" small icon="volumeHigh" label={`Audio: ${tick.audio}`} onClick={() => cmd('audio')} /> : null}
            {tick?.subs ? <Btn k="p:subs" small icon="subtitlesOutline" label={`Subtitles: ${tick.subs}`} onClick={() => cmd('subs')} /> : null}
            <Btn k="p:fill" small icon={tick?.fill ? 'fitToScreenOutline' : 'arrowExpandAll'} label={tick?.fill ? 'Fit' : 'Fill'} onClick={() => cmd('fill')} />
          </div>
        ) : (
          <div className="t-caption k-faint" style={{ marginTop: 22 }}>
            ◀ ▶ seek   ·   OK play/pause   ·   ▼ more
          </div>
        )}
      </div>

      {glyph ? (
        <div className="p-glyph" key={glyph.key}>
          <Icon name={glyph.icon} size={72} />
          {glyph.text ? <div style={{ marginTop: 4 }}>{glyph.text}</div> : null}
        </div>
      ) : null}

      {problem ? <Problem kind={problem.kind} text={problem.text} blocked={problem.blocked} onRetry={retry} onSignIn={signIn} /> : null}

      {toast ? (
        <div className="p-toast" key={toast.key}>
          <span>{toast.text}</span>
        </div>
      ) : null}
    </div>
  );
}

/** The site refused or paused the stream: say why in plain words and offer the way forward. */
function Problem({ kind, text, blocked, onRetry, onSignIn }: { kind: 'auth' | 'stream'; text: string; blocked?: string[]; onRetry: () => void; onSignIn: () => void }) {
  const auth = kind === 'auth';
  return (
    <div className="p-panel" data-layer="">
      <div className="k-sheet">
        <Icon name={auth ? 'accountLockOutline' : 'alertCircleOutline'} size={64} className="k-accent" />
        <div className="t-title" style={{ marginTop: 14 }}>
          {auth ? 'Sign in to keep watching' : 'This episode won’t start right now'}
        </div>
        <div className="t-body k-dim" style={{ marginTop: 12 }}>
          {auth
            ? 'anime.nexus paused this stream and wants you signed in. Sign in once with your anime.nexus account and Kitsune picks up right where you left off.'
            : 'anime.nexus couldn’t start the stream. That’s usually a short limit on their side, so give it a minute and try again. Signing in to anime.nexus helps too.'}
        </div>
        <div className="k-btns">
          {auth ? (
            <>
              <Btn k="p:signin" autofocus primary icon="login" label="Sign in" onClick={onSignIn} />
              <Btn k="p:retry" icon="refresh" label="Try again" onClick={onRetry} />
            </>
          ) : (
            <>
              <Btn k="p:retry" autofocus primary icon="refresh" label="Try again" onClick={onRetry} />
              <Btn k="p:signin" icon="login" label="Sign in" onClick={onSignIn} />
            </>
          )}
        </div>
        <div className="t-caption k-faint" style={{ marginTop: 22 }}>
          anime.nexus says: “{text}”
        </div>
        {blocked && blocked.length ? (
          <div className="t-caption k-faint" style={{ marginTop: 8 }}>
            Kitsune held back: {blocked.join(', ')}
          </div>
        ) : null}
      </div>
    </div>
  );
}
