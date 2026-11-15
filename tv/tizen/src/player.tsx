import { useEffect, useRef, useState } from 'preact/hooks';
import { clock } from '@/lib/format';
import type { PlayInfo, PlaySubtitle, SkipTime } from '@/lib/miruro/api';
import type { ProxyEnv } from '@/lib/miruro/codec';
import { type Candidate, defaultSubtitle, hasAudio, usableSubtitles } from '@/lib/miruro/streams';
import { type Cue, cuesAt } from '@/lib/subtitles';
import { canPlayNative, type Engine, hlsEngine, loadHls, nativeEngine } from './engine';
import { activate, focusInitial, move } from './focus';
import type { Action } from './keys';
import { config, env, episodeRow, fetchCues, HttpError, playInfo, probe, tvCandidates } from './miruro';
import { findEpisode, player, playEpisode, resumeAt } from './nav';
import { type Playing, store, useStore } from './store';
import { Btn, Icon, Spinner } from './ui/kit';
import type { IconName } from './ui/icons';

/** A stream that hasn't started in this long gives way to the next one. */
const READY_TIMEOUT = 12_000;
const OSD_HIDE = 4000;
const SAVE_EVERY = 5000;
/** Seek steps grow while the same direction is pressed again within STREAK_GAP. */
const STREAK_GAP = 700;
export const seekStep = (streak: number) => (streak < 3 ? 10 : streak < 6 ? 30 : 60);

type Tick = { t: number; d: number; paused: boolean; buffering: boolean };
type Problem = { kind: 'missing' | 'offline' | 'stream'; text: string };

/** Keys reach the player first while it's open (App asks here before its own handling). */
let handle: ((a: Action) => boolean) | null = null;
export function playerKey(a: Action): boolean {
  return handle ? handle(a) : false;
}

const SKIP_LABEL: Record<string, string> = { op: 'Skip intro', ed: 'Skip credits', recap: 'Skip recap', mixed_op: 'Skip intro', mixed_ed: 'Skip credits' };

export function Player({ playing }: { playing: Playing }) {
  const { show, episode } = playing;
  const prefs = useStore((s) => s.prefs);
  const video = useRef<HTMLVideoElement>(null);
  const engine = useRef<Engine | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [tick, setTick] = useState<Tick>({ t: 0, d: 0, paused: false, buffering: true });
  const [stream, setStream] = useState<Candidate | null>(null);
  const [tracks, setTracks] = useState({ heights: [] as number[], audios: [] as string[], audio: -1 });
  const [subs, setSubs] = useState<PlaySubtitle[]>([]);
  const [sub, setSub] = useState<PlaySubtitle | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [skips, setSkips] = useState<SkipTime[]>([]);
  const [both, setBoth] = useState(false);
  const [osd, setOsd] = useState(true);
  const [controls, setControls] = useState(false);
  const [glyph, setGlyph] = useState<{ icon: IconName; text?: string; key: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [pending, setPending] = useState<{ t: number; at: number } | null>(null);
  const streak = useRef({ dir: 0, n: 0, at: 0, total: 0 });
  const hideAt = useRef(0);
  /** Where the next start begins: the resume point, then wherever a retry or a sub/dub switch left off. */
  const startAt = useRef(resumeAt(episode.id));
  const envRef = useRef<ProxyEnv | null>(null);
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const say = (text: string) => setToast({ text, key: Date.now() });

  function save() {
    const v = video.current;
    if (v && v.duration && isFinite(v.duration) && v.currentTime > 0) store.recordProgress(show.id, episode, v.currentTime, v.duration);
  }

  function dropEngine() {
    if (engine.current) engine.current.destroy();
    engine.current = null;
  }

  function readTracks() {
    const e = engine.current;
    if (e) setTracks({ heights: e.heights(), audios: e.audios().map((a) => a.name || a.lang || 'Audio'), audio: e.audio() });
  }

  // Find the episode's streams and start the first one that plays.
  useEffect(() => {
    const v = video.current!;
    let live = true;
    let fatal: (() => void) | null = null;
    setReady(false);
    setProblem(null);

    function fail(e: unknown) {
      if (!live) return;
      dropEngine();
      if (e instanceof HttpError && e.status === 404) setProblem({ kind: 'missing', text: `Episode ${episode.number} isn’t on miruro.cx yet.` });
      else if (e instanceof HttpError && e.status === 0) setProblem({ kind: 'offline', text: 'Kitsune couldn’t reach miruro.cx. Check the TV’s internet connection, then try again.' });
      else setProblem({ kind: 'stream', text: 'None of miruro.cx’s servers would play this episode just now. That’s usually brief, so give it a minute and try again.' });
      setReady(true);
    }

    /** Attach one stream; true once it can play, false if it errors or stalls first. */
    function attach(c: Candidate, Hls: Awaited<ReturnType<typeof loadHls>>, native: boolean): Promise<boolean> {
      dropEngine();
      return new Promise((resolve) => {
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          v.removeEventListener('canplay', onReady);
          resolve(ok);
        };
        const onReady = () => done(true);
        const timer = setTimeout(() => done(false), READY_TIMEOUT);
        v.addEventListener('canplay', onReady);
        const handlers = {
          onFatal: () => (settled ? fatal && fatal() : done(false)),
          onTracks: readTracks,
        };
        const { quality, audioLang } = store.get().prefs;
        engine.current = Hls && !native ? hlsEngine(Hls, v, c.uri, startAt.current, quality, audioLang, handlers) : nativeEngine(v, c.uri, startAt.current, handlers);
      });
    }

    async function start() {
      const want = store.get().prefs.audio;
      const [play, cfg, e, Hls, row] = await Promise.all([
        playInfo(show.id, episode.number),
        config(),
        env(),
        loadHls(),
        episodeRow(show.id, episode.number).then(null, () => undefined),
      ]);
      if (!live) return;
      envRef.current = e;
      setSkips(row?.skip_times ?? []);
      setBoth(hasAudio(play, 'sub') && hasAudio(play, 'dub'));
      let list = tvCandidates(play, cfg, e, want);
      if (!list.length) {
        const other = want === 'dub' ? 'sub' : 'dub';
        list = tvCandidates(play as PlayInfo, cfg, e, other);
        if (list.length) say(want === 'dub' ? 'No dub for this episode yet, playing it subbed' : 'Only the dub is up for this episode');
      }
      // hls.js first; a TV that can't run it (or where it fails) plays the stream natively.
      const native = canPlayNative(v);
      const attempts: { c: Candidate; native: boolean }[] = Hls ? list.map((c) => ({ c, native: false })) : [];
      if (native) attempts.push(...list.slice(0, Hls ? 2 : list.length).map((c) => ({ c, native: true })));
      if (!attempts.length) throw new Error('No stream');

      let retried = false;
      const run = async (from: number): Promise<void> => {
        for (let i = from; i < attempts.length; i++) {
          if (!live) return;
          const a = attempts[i];
          if (!(await probe(a.c))) continue;
          if (!live) return;
          if (await attach(a.c, Hls, a.native)) {
            if (!live) return;
            // A stream that breaks mid-episode is tried once more from the same spot, then the next.
            fatal = () => {
              startAt.current = v.currentTime || startAt.current;
              const again = !retried;
              retried = true;
              if (again) say('The stream stalled, picking it back up…');
              run(again ? i : i + 1).catch(fail);
            };
            setStream(a.c);
            setReady(true);
            readTracks();
            v.play().then(null, () => {});
            return;
          }
        }
        fail(new Error('No stream'));
      };
      await run(0);
    }

    start().catch(fail);
    return () => {
      live = false;
      fatal = null;
      save();
      dropEngine();
    };
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subtitle files, for clean-video streams: the language picked before, else English.
  useEffect(() => {
    const list = stream && stream.proxied ? usableSubtitles(stream.subtitles) : [];
    setSubs(list);
    const lang = store.get().prefs.subLang;
    setSub(lang === 'off' ? null : (defaultSubtitle(list, lang) ?? null));
  }, [stream]);

  useEffect(() => {
    setCues([]);
    const e = envRef.current;
    if (!sub || !stream || !e) return;
    let live = true;
    fetchCues(sub, stream, e).then(
      (c) => live && setCues(c),
      () => live && say(`Couldn’t load the ${sub.label} subtitles`),
    );
    return () => {
      live = false;
    };
  }, [sub, stream]);

  // The clock: position for the OSD and subtitles, and progress saved every few seconds.
  useEffect(() => {
    let lastSave = Date.now();
    const id = setInterval(() => {
      const v = video.current;
      if (!v) return;
      const d = v.duration && isFinite(v.duration) ? v.duration : 0;
      setTick({ t: v.currentTime || 0, d, paused: v.paused, buffering: !v.paused && v.readyState < 3 });
      if (Date.now() - lastSave > SAVE_EVERY) {
        lastSave = Date.now();
        save();
      }
    }, 250);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The end of an episode moves on to the next.
  useEffect(() => {
    const v = video.current!;
    const onEnded = () => {
      save();
      jump(1, true);
    };
    v.addEventListener('ended', onEnded);
    return () => v.removeEventListener('ended', onEnded);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // OSD: up while paused or for a few seconds after a key.
  const wake = () => {
    hideAt.current = Date.now() + OSD_HIDE;
    setOsd(true);
  };
  useEffect(() => {
    const id = setInterval(() => {
      if (!controls && !tickRef.current.paused && Date.now() > hideAt.current) setOsd(false);
    }, 500);
    return () => clearInterval(id);
  }, [controls]);

  useEffect(() => {
    if (!glyph) return;
    const id = setTimeout(() => setGlyph(null), 900);
    return () => clearTimeout(id);
  }, [glyph]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (problem || controls) setTimeout(() => focusInitial(), 0);
  }, [problem, controls]);

  function leave() {
    save();
    player.close();
  }

  async function jump(step: 1 | -1, auto = false) {
    const number = episode.number + step;
    const ep = number >= 1 ? await findEpisode(show.id, number).catch(() => undefined) : undefined;
    if (!ep) {
      if (auto) return leave();
      return say(step > 0 ? 'That’s the latest episode' : 'This is the first episode');
    }
    save();
    playEpisode(store.get().history[show.id]?.show ?? show, ep);
  }

  function retry() {
    const v = video.current;
    if (v && v.currentTime) startAt.current = v.currentTime;
    setAttempt((n) => n + 1);
  }

  function switchAudio() {
    const next = prefs.audio === 'dub' ? 'sub' : 'dub';
    store.setPrefs({ audio: next });
    say(next === 'dub' ? 'Switching to the dub…' : 'Switching to subtitles…');
    retry();
  }

  function cycleQuality() {
    const options = [0, ...tracks.heights];
    const next = options[(options.indexOf(prefs.quality) + 1) % options.length] ?? 0;
    store.setPrefs({ quality: next });
    engine.current?.setQuality(next);
  }

  function cycleAudioTrack() {
    if (tracks.audios.length < 2 || !engine.current) return;
    const i = (tracks.audio + 1) % tracks.audios.length;
    engine.current.setAudio(i);
    const t = engine.current.audios()[i];
    store.setPrefs({ audioLang: t?.lang ?? null });
    setTracks((x) => ({ ...x, audio: i }));
  }

  function cycleSubs() {
    const options: (PlaySubtitle | null)[] = [null, ...subs];
    const next = options[(options.indexOf(sub) + 1) % options.length] ?? null;
    setSub(next);
    store.setPrefs({ subLang: next ? next.language : 'off' });
  }

  function toggleFill() {
    store.setPrefs({ fill: !prefs.fill });
  }

  function seek(dir: 1 | -1) {
    const v = video.current;
    if (!v || !ready) return;
    const s = streak.current;
    const now = Date.now();
    if (s.dir === dir && now - s.at < STREAK_GAP) s.n += 1;
    else {
      s.n = 1;
      s.total = 0;
    }
    s.dir = dir;
    s.at = now;
    const step = seekStep(s.n) * dir;
    s.total += step;
    const base = pending && now - pending.at < 2000 ? pending.t : v.currentTime;
    const d = v.duration && isFinite(v.duration) ? v.duration : 0;
    const to = Math.max(0, d ? Math.min(d - 1, base + step) : base + step);
    v.currentTime = to;
    setPending({ t: to, at: now });
    const abs = Math.abs(s.total);
    setGlyph({ icon: dir > 0 ? 'fastForward' : 'rewind', text: `${s.total > 0 ? '+' : '−'}${abs >= 60 ? clock(abs) : `${abs}s`}`, key: now });
  }

  function toggle(force?: 'play' | 'pause') {
    const v = video.current;
    if (!v) return;
    const next = force ?? (v.paused ? 'play' : 'pause');
    if (next === 'play') v.play().then(null, () => {});
    else v.pause();
    setGlyph({ icon: next === 'play' ? 'play' : 'pause', key: Date.now() });
  }

  const skip = skips.filter((s) => SKIP_LABEL[s.kind] && tick.t >= s.start_seconds && tick.t < s.end_seconds - 1)[0];

  function skipNow() {
    const v = video.current;
    if (v && skip) v.currentTime = skip.end_seconds;
  }

  // A settled position replaces the optimistic seek one.
  useEffect(() => {
    if (pending && (Math.abs(tick.t - pending.t) < 3 || Date.now() - pending.at > 2000)) setPending(null);
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (problem || !ready) {
      if (a === 'back' || a === 'stop') leave();
      else if (a === 'left' || a === 'right' || a === 'up' || a === 'down') move(a);
      else if (a === 'ok') activate();
      return true;
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
      case 'up':
        if (skip) skipNow();
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

  const t = pending ? pending.t : tick.t;
  const d = tick.d;
  const pct = d ? Math.min(100, (t / d) * 100) : 0;
  const lines = cues.length ? cuesAt(cues, tick.t) : { top: '', bottom: '' };
  const quality = prefs.quality && tracks.heights.length ? `${Math.min(prefs.quality, tracks.heights[0])}p` : 'Auto';

  return (
    // Always a layer, so the remote never reaches the screens kept under the player.
    <div id="kitsune-player" data-layer="">
      <video ref={video} className="p-video" style={{ objectFit: prefs.fill ? 'cover' : 'contain' }} playsInline />

      {ready && !problem ? (
        <>
          {lines.top ? <div className="p-subs top">{lines.top}</div> : null}
          {lines.bottom ? <div className={`p-subs${osd ? ' lifted' : ''}`}>{lines.bottom}</div> : null}
        </>
      ) : null}

      {!ready ? (
        <div className="p-loader">
          {playing.thumb ? <img src={playing.thumb} alt="" /> : null}
          <div className="shade" />
          <div className="box">
            <Spinner />
            <div className="t-micro k-accent" style={{ marginTop: 30 }}>
              Episode {episode.number}
            </div>
            <div className="t-display k-clamp2" style={{ marginTop: 10 }}>
              {show.name}
            </div>
            <div className="t-caption k-faint" style={{ marginTop: 24 }}>
              Back to leave
            </div>
          </div>
        </div>
      ) : null}

      {ready && !problem && skip ? (
        <div className="p-skip">
          <span>▲ {SKIP_LABEL[skip.kind]}</span>
        </div>
      ) : null}

      {ready && !problem ? (
        <div className={`p-osd p-fade${osd ? '' : ' p-hide'}`}>
          <div className="t-micro k-accent">
            Episode {episode.number}
            {episode.title ? `  ·  ${episode.title}` : ''}
          </div>
          <div className="t-display k-one p-title">{show.name}</div>
          <div className="p-track">
            <div className="fill" style={{ width: `${pct}%` }} />
            {d ? <div className="p-knob" style={{ left: `${pct}%` }} /> : null}
          </div>
          <div className="p-times">
            <span className="p-state">
              <Icon name={tick.paused ? 'pause' : 'play'} size={30} />
              {tick.buffering ? 'Buffering…' : clock(t)}
            </span>
            <span>{d ? `−${clock(d - t)}` : ''}</span>
          </div>
          {controls ? (
            <div className="p-row">
              <Btn k="p:next" autofocus small icon="skipNext" label="Next episode" onClick={() => jump(1)} />
              {both ? <Btn k="p:dub" small icon="volumeHigh" label={prefs.audio === 'dub' ? 'Dub' : 'Sub'} sub="switch" onClick={switchAudio} /> : null}
              {tracks.audios.length > 1 ? <Btn k="p:audio" small icon="volumeHigh" label={`Audio: ${tracks.audios[tracks.audio] ?? 'Default'}`} onClick={cycleAudioTrack} /> : null}
              {subs.length ? <Btn k="p:subs" small icon="subtitlesOutline" label={`Subtitles: ${sub ? sub.label : 'Off'}`} onClick={cycleSubs} /> : null}
              {tracks.heights.length > 1 ? <Btn k="p:quality" small icon="arrowExpandAll" label={`Quality: ${quality}`} onClick={cycleQuality} /> : null}
              <Btn k="p:fill" small icon={prefs.fill ? 'fitToScreenOutline' : 'arrowExpandAll'} label={prefs.fill ? 'Fit' : 'Fill'} onClick={toggleFill} />
            </div>
          ) : (
            <div className="t-caption k-faint" style={{ marginTop: 22 }}>
              ◀ ▶ seek   ·   OK play/pause   ·   ▼ more
            </div>
          )}
        </div>
      ) : null}

      {glyph ? (
        <div className="p-glyph" key={glyph.key}>
          <Icon name={glyph.icon} size={72} />
          {glyph.text ? <div style={{ marginTop: 4 }}>{glyph.text}</div> : null}
        </div>
      ) : null}

      {problem ? (
        <div className="p-panel">
          <div className="k-sheet">
            <Icon name="alertCircleOutline" size={64} className="k-accent" />
            <div className="t-title" style={{ marginTop: 14 }}>
              {problem.kind === 'missing' ? 'Not out yet' : 'This episode won’t start right now'}
            </div>
            <div className="t-body k-dim" style={{ marginTop: 12 }}>
              {problem.text}
            </div>
            <div className="k-btns">
              <Btn k="p:retry" autofocus primary icon="refresh" label="Try again" onClick={retry} />
              <Btn k="p:leave" label="Back" onClick={leave} />
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="p-toast" key={toast.key}>
          <span>{toast.text}</span>
        </div>
      ) : null}
    </div>
  );
}
