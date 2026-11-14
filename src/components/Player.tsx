import { useEventListener } from 'expo';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import { NavigationBar, setVisibilityAsync } from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { type AudioTrack, useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { isPlayable, localMasterFile, readCues } from '@/lib/downloads/files';
import { type DownloadItem, useDownloads } from '@/lib/downloads/store';
import { haptics, NotificationFeedbackType } from '@/lib/haptics';
import { parseMaster, pickVariant, pinnedMaster } from '@/lib/hls';
import type { TvCommand } from '@/lib/inject';
import type { PlaySubtitle, SkipTime } from '@/lib/miruro/api';
import { MiruroError } from '@/lib/miruro/bridge';
import { proxyUrl } from '@/lib/miruro/codec';
import { MissingEpisodeError, type Resolved, resolveEpisode } from '@/lib/miruro/resolve';
import { type Audio, type Candidate, candidates, defaultSubtitle, hasAudio, probe, usableSubtitles } from '@/lib/miruro/streams';
import { fetchCues } from '@/lib/miruro/subs';
import { findEpisode } from '@/lib/nav';
import { type Session, usePlayer } from '@/lib/player';
import { queryClient, q } from '@/lib/queries';
import { type CaptionSize, resumePoint, useStore } from '@/lib/store';
import { type Cue, cuesAt } from '@/lib/subtitles';
import { isTV, tv } from '@/lib/tv';
import { color, radius, spring } from '@/theme/tokens';
import { Button, IconButton } from './Button';
import { Icon } from './Icon';
import { PhoneControls } from './PhoneControls';
import { PlayerOsd, type Tick } from './PlayerOsd';
import { PlayerSettings, type SettingKey, type SettingRow } from './PlayerSettings';
import { Spinner } from './Spinner';
import { T } from './T';

// A stream that hasn't produced a playable video in this long is treated as dead.
const START_TIMEOUT = 12_000;
// How many streams to check in parallel before handing the first to the player.
const PROBE_FIRST = 4;
const SAVE_EVERY = 5;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const CAPTION_SCALE: Record<CaptionSize, number> = { s: 0.8, m: 1, l: 1.3, xl: 1.6 };
const CAPTION_LABEL: Record<CaptionSize, string> = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Extra large' };

/** The server that last worked for a show, tried first next time (this run of the app only). */
const lastGood = new Map<string, { provider: string; server: string }>();

type Problem =
  | { kind: 'unmatched' }
  | { kind: 'episode'; available: number }
  | { kind: 'stream'; tried: number; other: Audio | null }
  | { kind: 'blocked' }
  | { kind: 'network' }
  | { kind: 'api'; text: string };

type Phase = 'resolving' | 'starting' | 'playing' | 'problem';

/** Renders the app's single player above everything. */
export function PlayerHost() {
  const session = usePlayer((s) => s.session);
  if (!session) return null;
  return <Player key={session.episodeId} session={session} />;
}

/**
 * Plays an episode natively: from a finished download when there is one, otherwise from
 * miruro.cx's streams (the show is matched to miruro, the episode's streams are ranked by
 * lib/miruro/streams.ts and tried in turn until one plays). Nothing of the site's own pages is
 * loaded, so there's nothing to show ads.
 */
function Player({ session }: { session: Session }) {
  const close = usePlayer((s) => s.close);
  const recordProgress = useStore((s) => s.recordProgress);
  const audio = useStore((s) => s.prefs.audio);
  const captionSize = useStore((s) => s.prefs.captionSize);
  const captionBg = useStore((s) => s.prefs.captionBg);
  const [now, setNow] = useState({ id: session.episodeId, slug: session.slug, number: session.number, title: session.title });
  const [load, setLoad] = useState(0);
  const [phase, setPhase] = useState<Phase>('resolving');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [fill, setFill] = useState(false);
  const [cue, setCue] = useState({ bottom: '', top: '' });
  const [skip, setSkip] = useState<{ label: string; to: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [settings, setSettings] = useState<SettingRow[] | null>(null);

  // Everything the player's event handlers need, current at all times (they outlive renders).
  const run = useRef({
    token: 0,
    phase: 'resolving' as Phase,
    list: [] as Candidate[],
    index: 0,
    startAt: session.startAt,
    seeked: false,
    retried: false,
    resolved: null as Resolved | null,
    audioUsed: 'sub' as Audio,
    subs: [] as PlaySubtitle[],
    subsFor: '',
    subIndex: -1,
    cues: [] as Cue[],
    cueKey: '',
    skips: [] as SkipTime[],
    skipKey: '',
    savedAt: 0,
    fill: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    /** Master playlists already fetched (by URL), heights seen, and the height now on screen. */
    masters: new Map<string, string>(),
    heights: [] as number[],
    videoHeight: 0,
    audioTracks: [] as AudioTrack[],
    audioApplied: false,
    /** The finished download being played, and whether to skip it (it wouldn't play). */
    local: null as DownloadItem | null,
    skipLocal: false,
  });
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  }, [now]);
  // Where the next load should start; set by retry / audio switch, read once by the load effect.
  const startOverride = useRef<number | null>(null);

  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0.25;
    p.loop = false;
  });

  const show = useSharedValue(0);
  const feedRef = useRef<((t: Tick) => void) | null>(null);

  function setPhaseBoth(p: Phase) {
    run.current.phase = p;
    setPhase(p);
  }

  /** Clear the screen for a fresh load (the load effect itself only touches refs). */
  function reset() {
    setCue({ bottom: '', top: '' });
    setSkip(null);
    setProblem(null);
    setSettings(null);
    setPhaseBoth('resolving');
  }

  // On screen: rotate, go immersive, keep the screen on, and let Back close the player.
  useEffect(() => {
    show.set(withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
    // A TV is already landscape (and some boxes would honour a portrait lock, sideways).
    if (!isTV) ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    activateKeepAwakeAsync('player');
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      exit();
      return true;
    });
    const r = run.current;
    return () => {
      clearTimeout(r.timer);
      back.remove();
      deactivateKeepAwake('player');
      if (!isTV) {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        setVisibilityAsync('visible');
      }
      queryClient.invalidateQueries({ queryKey: ['episodes', session.showId] });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Find and start a stream for the episode on screen (again, after a retry or an audio switch).
  useEffect(() => {
    const r = run.current;
    const token = ++r.token;
    clearTimeout(r.timer);
    r.startAt = startOverride.current ?? Math.floor(resumePoint(useStore.getState().progress[now.id]));
    startOverride.current = null;
    r.retried = false;
    r.cues = [];
    r.cueKey = '';
    r.subsFor = '';
    r.skipKey = '';
    r.skips = [];
    r.masters = new Map();
    r.heights = [];
    r.videoHeight = 0;
    r.resolved = null;
    r.local = null;
    r.phase = 'resolving';
    player.pause();

    // A finished download plays from the device, with no network at all.
    const item = useDownloads.getState().items[now.id];
    if (!r.skipLocal && isPlayable(item)) {
      r.local = item;
      r.skips = item.skips ?? [];
      r.audioUsed = item.want.audio;
      r.list = [
        {
          key: 'local',
          uri: localMasterFile(item.id).uri,
          via: 'local',
          provider: 'download',
          server: 'device',
          track: item.got?.track ?? '',
          streamUrl: '',
          referer: null,
          proxied: false,
          subtitles: (item.got?.subs ?? []).map((s) => ({ language: s.language, label: s.label, file: s.file, format: 'json' })),
        },
      ];
      start(0);
      return;
    }
    r.skipLocal = false;

    (async () => {
      const res = await resolveEpisode(session.showId, now.number);
      if (token !== r.token) return;
      r.resolved = res;
      r.skips = res.episode.skip_times ?? [];
      let used: Audio = audio;
      let list = candidates(res.play, res.config, res.env, audio, lastGood.get(session.showId));
      if (!list.length) {
        const other: Audio = audio === 'sub' ? 'dub' : 'sub';
        list = candidates(res.play, res.config, res.env, other, lastGood.get(session.showId));
        if (list.length) {
          used = other;
          say(other === 'dub' ? 'No subbed stream for this one, so it’s the dub' : 'No dub for this one, so it’s subbed');
        }
      }
      r.audioUsed = used;
      if (!list.length) return fail({ kind: 'stream', tried: 0, other: null });
      // Check the first few at once; ones that don't answer go to the back of the queue.
      const head = list.slice(0, PROBE_FIRST);
      const texts = await Promise.all(head.map((c) => probe(c)));
      if (token !== r.token) return;
      head.forEach((c, i) => {
        const text = texts[i];
        if (text) {
          r.masters.set(c.uri, text);
          noteHeights(text, c.uri);
        }
      });
      r.list = [...head.filter((_, i) => texts[i]), ...list.slice(PROBE_FIRST), ...head.filter((_, i) => !texts[i])];
      // A chosen quality is locked from the start, so there's no second start at another one.
      const want = useStore.getState().prefs.quality;
      if (want !== 'auto' && r.list[0]) {
        const pinned = await pinFor(r.list[0], want);
        if (token !== r.token) return;
        if (pinned) r.list.unshift(pinned);
      }
      start(0);
    })().catch((e: unknown) => {
      if (token !== r.token) return;
      fail(classify(e));
    });
  }, [now.id, load, audio]); // eslint-disable-line react-hooks/exhaustive-deps

  function noteHeights(text: string, base: string) {
    const parsed = parseMaster(text, base);
    if (!parsed) return;
    const r = run.current;
    r.heights = [...new Set([...r.heights, ...parsed.variants.map((v) => v.height).filter(Boolean)])].sort((a, b) => b - a);
  }

  /**
   * A copy of the candidate's master playlist (fetched through miruro's proxy, so its links need no
   * headers) keeping only the variant at `height`: ExoPlayer then can't drop to a lower one.
   */
  async function pinFor(c: Candidate, height: number): Promise<Candidate | null> {
    const r = run.current;
    const env = r.resolved?.env;
    if (!env || c.via === 'local' || !c.streamUrl) return null;
    const url = c.via === 'proxy' && !c.uri.startsWith('file:') ? c.uri : proxyUrl(env.a, env.key, c.streamUrl, c.referer, '/pl.m3u8');
    let text = r.masters.get(url);
    if (!text) {
      try {
        const res = await fetch(url);
        if (res.ok) text = await res.text();
      } catch {
        // No pin: the cap still applies.
      }
    }
    if (!text) return null;
    r.masters.set(url, text);
    noteHeights(text, url);
    const parsed = parseMaster(text, url);
    if (!parsed || parsed.variants.length < 2) return null;
    const v = pickVariant(parsed.variants, height);
    try {
      const file = new File(Paths.cache, `quality-${Date.now()}.m3u8`);
      file.writeSync(pinnedMaster(text, url, v));
      return { ...c, key: `${c.key.replace(/@\d+$/, '')}@${v.height}`, via: 'proxy', uri: file.uri, headers: undefined };
    } catch {
      return null;
    }
  }

  function classify(e: unknown): Problem {
    if (e instanceof MissingEpisodeError) return { kind: 'episode', available: e.available };
    if (e instanceof MiruroError) {
      if (e.status === 429) usePlayer.getState().backOff();
      if (e.kind === 'blocked') return { kind: 'blocked' };
      if (e.kind === 'network' || e.kind === 'timeout') return { kind: 'network' };
      return { kind: 'api', text: e.message };
    }
    return { kind: 'network' };
  }

  function fail(p: Problem) {
    clearTimeout(run.current.timer);
    player.pause();
    haptics.notify(NotificationFeedbackType.Warning);
    setSettings(null);
    setProblem(p);
    setPhaseBoth('problem');
  }

  /** Hand candidate `i` to the player; if it doesn't start in time, the next one gets its turn. */
  function start(i: number) {
    const r = run.current;
    const c = r.list[i];
    if (!c) {
      if (r.local) {
        // The download wouldn't play: stream the episode instead.
        r.skipLocal = true;
        startOverride.current = r.startAt || null;
        say('That download wouldn’t play, so it’s streaming');
        reset();
        setLoad((n) => n + 1);
        return;
      }
      const other: Audio = r.audioUsed === 'sub' ? 'dub' : 'sub';
      return fail({ kind: 'stream', tried: r.list.length, other: r.resolved && hasAudio(r.resolved.play, other) ? other : null });
    }
    const token = r.token;
    r.index = i;
    r.seeked = false;
    r.audioApplied = false;
    setPhaseBoth('starting');
    clearTimeout(r.timer);
    r.timer = setTimeout(() => {
      if (token === r.token && r.phase === 'starting' && r.index === i) start(i + 1);
    }, START_TIMEOUT);
    const want = useStore.getState().prefs.quality;
    player.maxResolution = want === 'auto' ? null : { width: want * 3, height: want };
    player
      .replaceAsync({ uri: c.uri, headers: c.headers, contentType: 'hls', metadata: { title: session.showName, artist: `Episode ${nowRef.current.number}` } })
      .then(() => {
        if (token === r.token && r.index === i) player.play();
      })
      .catch(() => {
        if (token === r.token && r.index === i) start(i + 1);
      });
    loadSubtitles(c, token);
  }

  function loadSubtitles(c: Candidate, token: number) {
    const r = run.current;
    // The same streams' subtitles (e.g. after a quality change) are already loaded.
    const subsFor = `${c.provider}/${c.track}`;
    if (subsFor === r.subsFor) return;
    r.subsFor = subsFor;
    r.subs = c.via === 'local' ? c.subtitles : usableSubtitles(c.subtitles);
    r.cues = [];
    const prefs = useStore.getState().prefs;
    const first = c.via === 'local' ? (r.subs.find((s) => prefs.subLang && s.language === prefs.subLang) ?? r.subs[0]) : defaultSubtitle(r.subs, prefs.subLang);
    r.subIndex = prefs.subs && first ? r.subs.indexOf(first) : -1;
    if (r.subIndex >= 0) loadCues(r.subIndex, c, token);
  }

  async function loadCues(index: number, c: Candidate, token: number) {
    const r = run.current;
    const sub = r.subs[index];
    if (!sub) return;
    if (c.via === 'local' && r.local) {
      r.cues = readCues(r.local.id, Number(sub.file.split('.')[0]) || 0);
      if (!r.cues.length) say('Couldn’t read those subtitles');
      return;
    }
    try {
      const cues = await fetchCues(sub, c, r.resolved?.env ?? null);
      if (token === r.token && r.subIndex === index) r.cues = cues;
    } catch {
      if (token === r.token && r.subIndex === index) say(`Couldn’t load the ${sub.label} subtitles`);
    }
  }

  useEventListener(player, 'statusChange', ({ status }) => {
    const r = run.current;
    if (status === 'readyToPlay') {
      if (r.phase === 'starting') {
        clearTimeout(r.timer);
        const c = r.list[r.index];
        if (c && c.via !== 'local') lastGood.set(session.showId, { provider: c.provider, server: c.server });
        setPhaseBoth('playing');
      }
      if (!r.seeked) {
        r.seeked = true;
        if (r.startAt > 0) player.currentTime = r.startAt;
        player.playbackRate = useStore.getState().prefs.speed;
        player.play();
      }
    } else if (status === 'error') {
      if (r.phase === 'playing' && !r.retried) {
        // A hiccup mid-episode: the same stream once more from where it got to, then the next.
        r.retried = true;
        r.startAt = player.currentTime;
        start(r.index);
      } else if (r.phase === 'starting' || r.phase === 'playing') {
        r.startAt = Math.max(r.startAt, player.currentTime || 0);
        start(r.index + 1);
      }
    }
    pushTick();
  });

  useEventListener(player, 'sourceLoad', ({ availableVideoTracks, availableAudioTracks }) => {
    const r = run.current;
    const hs = availableVideoTracks.map((t) => t.size?.height ?? 0).filter(Boolean);
    // A locked quality loads a single variant; keep the full list from before.
    if (hs.length > 1 || !r.heights.length) r.heights = [...new Set([...r.heights, ...hs])].sort((a, b) => b - a);
    r.audioTracks = availableAudioTracks;
    applyAudioLang();
    refreshSettings();
  });

  useEventListener(player, 'availableAudioTracksChange', ({ availableAudioTracks }) => {
    run.current.audioTracks = availableAudioTracks;
    applyAudioLang();
    refreshSettings();
  });

  useEventListener(player, 'videoTrackChange', ({ videoTrack }) => {
    run.current.videoHeight = videoTrack?.size?.height ?? 0;
    refreshSettings();
  });

  useEventListener(player, 'audioTrackChange', () => refreshSettings());

  useEventListener(player, 'playingChange', () => pushTick());

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const r = run.current;
    pushTick(currentTime);
    const text = r.subIndex >= 0 ? cuesAt(r.cues, currentTime) : { bottom: '', top: '' };
    const key = `${text.top}\u0000${text.bottom}`;
    if (key !== r.cueKey) {
      r.cueKey = key;
      setCue(text);
    }
    const window = r.skips.find((s) => currentTime >= s.start_seconds && currentTime < s.end_seconds - 2);
    const skipKey = window ? `${window.kind}:${window.end_seconds}` : '';
    if (skipKey !== r.skipKey) {
      r.skipKey = skipKey;
      setSkip(window ? { label: window.kind === 'ed' ? 'Skip ending' : window.kind === 'op' ? 'Skip intro' : 'Skip', to: window.end_seconds } : null);
    }
    if (Math.abs(currentTime - r.savedAt) >= SAVE_EVERY) save(currentTime);
  });

  useEventListener(player, 'playToEnd', () => {
    save(player.duration);
    jump(1, true);
  });

  /** The preferred audio language, once per source, when the stream carries several. */
  function applyAudioLang() {
    const r = run.current;
    const lang = useStore.getState().prefs.audioLang?.toLowerCase();
    if (r.audioApplied || !lang || r.audioTracks.length < 2) return;
    r.audioApplied = true;
    const match = r.audioTracks.find((t) => t.language?.toLowerCase() === lang) ?? r.audioTracks.find((t) => t.language?.toLowerCase().startsWith(lang.slice(0, 2)));
    if (match && player.audioTrack?.id !== match.id) player.audioTrack = match;
  }

  function save(t = player.currentTime) {
    const d = player.duration;
    if (run.current.phase !== 'playing' || !d || !Number.isFinite(d) || !Number.isFinite(t)) return;
    run.current.savedAt = t;
    const cur = nowRef.current;
    recordProgress(session.showId, { id: cur.id, slug: cur.slug, number: cur.number }, t, d);
  }

  function labels() {
    const r = run.current;
    const sub = r.subIndex >= 0 ? r.subs[r.subIndex] : undefined;
    return {
      audio: r.resolved || r.local ? (r.audioUsed === 'dub' ? 'Dub' : 'Sub') : null,
      subs: r.subs.length ? (sub ? sub.label : 'Off') : null,
    };
  }

  function pushTick(t = player.currentTime) {
    const { audio: a, subs } = labels();
    feedRef.current?.({
      t: t || 0,
      d: Number.isFinite(player.duration) ? player.duration : 0,
      paused: !player.playing,
      buffering: player.status === 'loading',
      audio: a,
      subs,
      fill: run.current.fill,
    });
  }

  function say(text: string) {
    haptics.selection();
    setToast({ text, key: Date.now() });
  }

  function exit() {
    save();
    setClosing(true);
    player.pause();
    if (!isTV) ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    show.set(withDelay(120, withTiming(0, { duration: 200 }, (done) => done && scheduleOnRN(close))));
  }

  /** Look the episode up again (stream links expire) and pick up where it got to. */
  function retry() {
    const r = run.current;
    if (r.resolved) queryClient.removeQueries({ queryKey: q.play(r.resolved.id, r.resolved.episode.episode_number).queryKey });
    startOverride.current = r.phase === 'playing' || r.seeked ? Math.floor(player.currentTime) : null;
    reset();
    setLoad((n) => n + 1);
  }

  /** Next / previous episode: load it in place, picking up where it was left. */
  async function jump(step: 1 | -1, auto = false) {
    const cur = nowRef.current;
    const ep = await findEpisode(session.showId, cur.number + step).catch(() => undefined);
    if (!ep) {
      say(step > 0 ? 'That’s the latest episode' : 'This is the first episode');
      return;
    }
    if (!auto) save();
    const entry = useStore.getState().history[session.showId];
    if (entry) useStore.getState().recordPlay(entry.show, ep);
    if (auto) say(`Up next: Episode ${ep.number}`);
    reset();
    setNow({ id: ep.id, slug: ep.slug, number: ep.number, title: ep.title ?? '' });
  }

  function switchAudio(to?: Audio) {
    const r = run.current;
    const next: Audio = to ?? (r.audioUsed === 'sub' ? 'dub' : 'sub');
    if (r.local) {
      say(r.audioUsed === 'dub' ? 'This download is the dub' : 'This download is subbed');
      return;
    }
    if (r.resolved && !hasAudio(r.resolved.play, next)) {
      say(next === 'dub' ? 'No dub for this episode' : 'No subbed stream for this episode');
      return;
    }
    startOverride.current = r.seeked ? Math.floor(player.currentTime) : null;
    reset();
    if (next === useStore.getState().prefs.audio) setLoad((n) => n + 1);
    else useStore.getState().setPrefs({ audio: next });
  }

  function chooseSubs(index: number) {
    const r = run.current;
    if (!r.subs.length) return;
    r.subIndex = index >= 0 && index < r.subs.length ? index : -1;
    r.cues = [];
    r.cueKey = '';
    setCue({ bottom: '', top: '' });
    const sub = r.subIndex >= 0 ? r.subs[r.subIndex] : undefined;
    useStore.getState().setPrefs(sub ? { subs: true, subLang: sub.language } : { subs: false });
    const c = r.list[r.index];
    if (sub && c) loadCues(r.subIndex, c, r.token);
    say(sub ? `Subtitles: ${sub.label}` : 'Subtitles off');
    pushTick();
  }

  function cycleSubs() {
    const r = run.current;
    chooseSubs(r.subIndex + 1 >= r.subs.length ? -1 : r.subIndex + 1);
  }

  /** Lock (or free) the picture quality. The cap always applies; streams via the proxy are pinned. */
  async function chooseQuality(id: string) {
    const r = run.current;
    const want: 'auto' | number = id === 'auto' ? 'auto' : Number(id);
    useStore.getState().setPrefs({ quality: want });
    player.maxResolution = want === 'auto' ? null : { width: want * 3, height: want };
    const c = r.list[r.index];
    if (!c || c.via === 'local') {
      say(want === 'auto' ? 'Quality: Auto' : `Quality: up to ${want}p`);
      return;
    }
    const isPinned = /@\d+$/.test(c.key);
    if (want === 'auto') {
      say('Quality: Auto');
      if (!isPinned) return;
      // Back to the stream itself, so the player can choose again.
      r.list.splice(r.index, 1);
    } else {
      const pinned = await pinFor(isPinned ? { ...c, key: c.key.replace(/@\d+$/, '') } : c, want);
      if (!pinned) {
        say(`Quality: up to ${want}p`);
        return;
      }
      if (isPinned) r.list[r.index] = pinned;
      else r.list.splice(r.index, 0, pinned);
      say(`Quality: ${pinned.key.split('@')[1]}p`);
    }
    r.startAt = Math.floor(player.currentTime);
    r.retried = false;
    start(r.index);
  }

  function refreshSettings() {
    if (settingsOpen.current) setSettings(buildSettings());
  }
  const settingsOpen = useRef(false);

  function openSettings() {
    settingsOpen.current = true;
    setSettings(buildSettings());
  }

  function closeSettings() {
    settingsOpen.current = false;
    setSettings(null);
  }

  function buildSettings(): SettingRow[] {
    const r = run.current;
    const prefs = useStore.getState().prefs;
    const rows: SettingRow[] = [];
    const playingHeight = r.videoHeight || player.videoTrack?.size?.height || 0;
    if (r.heights.length > 1 || (r.heights.length && prefs.quality !== 'auto')) {
      rows.push({
        key: 'quality',
        icon: 'tune-variant',
        label: 'Quality',
        value: prefs.quality === 'auto' ? `Auto${playingHeight ? ` (${playingHeight}p)` : ''}` : `${prefs.quality}p`,
        selected: String(prefs.quality),
        options: [{ id: 'auto', label: 'Auto', note: playingHeight ? `${playingHeight}p now` : undefined }, ...r.heights.map((h) => ({ id: String(h), label: `${h}p`, note: h >= 1080 ? 'HD' : undefined }))],
      });
    }
    if (r.audioTracks.length > 1) {
      const current = player.audioTrack;
      const options = r.audioTracks.map((t, i) => {
        const base = t.label || t.name || t.language || `Track ${i + 1}`;
        const dupe = r.audioTracks.filter((x) => (x.label || x.name || x.language) === base).length > 1;
        return { id: t.id ?? String(i), label: dupe && t.language ? `${base} (${t.language})` : base };
      });
      const sel = current ? (current.id ?? String(r.audioTracks.findIndex((t) => t.language === current.language))) : '';
      rows.push({ key: 'audioLang', icon: 'music-note-outline', label: 'Audio language', value: options.find((o) => o.id === sel)?.label ?? 'Default', selected: sel, options });
    }
    if (!r.local && r.resolved) {
      const subOk = hasAudio(r.resolved.play, 'sub');
      const dubOk = hasAudio(r.resolved.play, 'dub');
      if (subOk && dubOk) {
        rows.push({ key: 'version', icon: 'translate', label: 'Sub or dub', value: r.audioUsed === 'dub' ? 'Dub' : 'Sub', selected: r.audioUsed, options: [{ id: 'sub', label: 'Sub', note: 'Japanese audio' }, { id: 'dub', label: 'Dub', note: 'English audio' }] });
      }
    }
    if (r.subs.length) {
      const sub = r.subIndex >= 0 ? r.subs[r.subIndex] : undefined;
      rows.push({ key: 'captions', icon: 'closed-caption-outline', label: 'Captions', value: sub?.label ?? 'Off', selected: String(r.subIndex), options: [{ id: '-1', label: 'Off' }, ...r.subs.map((s, i) => ({ id: String(i), label: s.label }))] });
      rows.push({ key: 'captionSize', icon: 'format-size', label: 'Caption size', value: CAPTION_LABEL[prefs.captionSize], selected: prefs.captionSize, options: (Object.keys(CAPTION_LABEL) as CaptionSize[]).map((k) => ({ id: k, label: CAPTION_LABEL[k] })) });
      rows.push({ key: 'captionBg', icon: 'format-color-fill', label: 'Caption background', value: prefs.captionBg ? 'On' : 'Off', selected: prefs.captionBg ? 'on' : 'off', options: [{ id: 'off', label: 'Off', note: 'Outlined text' }, { id: 'on', label: 'On', note: 'Dark box behind text' }] });
    }
    rows.push({ key: 'speed', icon: 'speedometer', label: 'Playback speed', value: prefs.speed === 1 ? 'Normal' : `${prefs.speed}×`, selected: String(prefs.speed), options: SPEEDS.map((s) => ({ id: String(s), label: s === 1 ? 'Normal' : `${s}×` })) });
    return rows;
  }

  function pickSetting(key: SettingKey, id: string) {
    const r = run.current;
    switch (key) {
      case 'quality':
        chooseQuality(id);
        break;
      case 'audioLang': {
        const t = r.audioTracks.find((x, i) => (x.id ?? String(i)) === id);
        if (t) {
          player.audioTrack = t;
          useStore.getState().setPrefs({ audioLang: t.language || null });
        }
        break;
      }
      case 'version':
        if (id !== r.audioUsed) switchAudio(id as Audio);
        break;
      case 'captions':
        chooseSubs(Number(id));
        break;
      case 'captionSize':
        useStore.getState().setPrefs({ captionSize: id as CaptionSize });
        break;
      case 'captionBg':
        useStore.getState().setPrefs({ captionBg: id === 'on' });
        break;
      case 'speed': {
        const s = Number(id) || 1;
        player.playbackRate = s;
        useStore.getState().setPrefs({ speed: s });
        break;
      }
    }
    // Picking a version reloads the player (and closes the panel); everything else keeps it open.
    if (key !== 'version') setSettings(buildSettings());
  }

  const command = (cmd: TvCommand, arg = 0) => {
    switch (cmd) {
      case 'toggle':
        if (player.playing) player.pause();
        else player.play();
        break;
      case 'play':
        player.play();
        break;
      case 'pause':
        player.pause();
        break;
      case 'seek':
        player.seekBy(arg);
        break;
      case 'seekTo':
        player.currentTime = arg;
        break;
      case 'audio':
        switchAudio();
        break;
      case 'subs':
        cycleSubs();
        break;
      case 'fill':
        run.current.fill = !run.current.fill;
        setFill(run.current.fill);
        break;
    }
    pushTick();
  };

  const skipNow = () => {
    if (!skip) return;
    player.currentTime = skip.to;
    haptics.selection();
  };

  const layer = useAnimatedStyle(() => ({ opacity: show.value, transform: [{ scale: 1.04 - show.value * 0.04 }] }));
  const playing = phase === 'playing' && !closing;
  const episodeLabel = `Episode ${now.number}`;
  const scale = CAPTION_SCALE[captionSize];
  const cueText = [styles.cue, { fontSize: styles.cue.fontSize * scale, lineHeight: styles.cue.lineHeight * scale }, captionBg && styles.cueBox];

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, layer]}>
      <StatusBar hidden />
      <NavigationBar hidden />
      <VideoView
        player={player}
        style={[styles.video, closing && styles.hidden]}
        nativeControls={false}
        contentFit={fill ? 'cover' : 'contain'}
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
        focusable={false}
      />
      {cue.top && playing ? (
        <View pointerEvents="none" style={[styles.cueWrap, styles.cueTop]}>
          <T style={cueText}>{cue.top}</T>
        </View>
      ) : null}
      {cue.bottom && playing ? (
        <View pointerEvents="none" style={styles.cueWrap}>
          <T style={cueText}>{cue.bottom}</T>
        </View>
      ) : null}
      {playing && isTV ? (
        <PlayerOsd title={session.showName} episode={episodeLabel} feedRef={feedRef} onCommand={command} onJump={jump} onExit={exit} skip={skip?.label} onSkip={skipNow} onSettings={openSettings} blocked={!!settings} />
      ) : null}
      {playing && !isTV ? <PhoneControls title={session.showName} episode={episodeLabel} feedRef={feedRef} onCommand={command} onJump={jump} onExit={exit} onSettings={openSettings} /> : null}
      {playing && skip && !settings ? (
        isTV ? (
          <View pointerEvents="none" style={[styles.skip, styles.skipTv]}>
            <T variant="label">▲ {skip.label}</T>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={skipNow} style={({ pressed }) => [styles.skip, pressed && { opacity: 0.7 }]}>
            <T variant="label">{skip.label}</T>
            <Icon name="skip-forward" size={18} tint={color.text} />
          </Pressable>
        )
      ) : null}
      {playing && settings ? <PlayerSettings rows={settings} onPick={pickSetting} onClose={closeSettings} /> : null}
      {(phase === 'resolving' || phase === 'starting') && !closing ? (
        <Loader name={session.showName} number={now.number} title={now.title} thumb={session.thumb} step={phase} local={!!run.current.local} />
      ) : null}
      {problem && !closing ? <ProblemScreen problem={problem} number={now.number} onRetry={retry} onSwitch={switchAudio} onExit={exit} /> : null}
      {toast ? <Toast key={toast.key} text={toast.text} onDone={() => setToast(null)} /> : null}
      {closing ? <View style={[StyleSheet.absoluteFill, styles.blackout]} /> : null}
      {/* A TV has a Back key; a focusable button here would only steal the remote. */}
      {!isTV && !closing && !playing ? (
        <View style={styles.back}>
          <IconButton icon="arrow-left" label="Close player" variant="scrim" onPress={exit} />
        </View>
      ) : null}
    </Animated.View>
  );
}

/** Small pill notice: rises from the bottom, holds, then fades away. */
function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withSequence(withSpring(1, spring.snappy), withDelay(1400, withTiming(0, { duration: 220 }, (done) => done && scheduleOnRN(onDone)))));
  }, [t, onDone]);
  const style = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: (1 - t.value) * 24 }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.toastWrap, style]}>
      <View style={styles.toast}>
        <T variant="label">{text}</T>
      </View>
    </Animated.View>
  );
}

/** Why the episode isn't playing, in plain words, and the way forward. */
function ProblemScreen({ problem, number, onRetry, onSwitch, onExit }: { problem: Problem; number: number; onRetry: () => void; onSwitch: (to: Audio) => void; onExit: () => void }) {
  let title = '';
  let body = '';
  let note = '';
  let canRetry = true;
  switch (problem.kind) {
    case 'unmatched':
      title = 'Couldn’t find this show on miruro.cx';
      body = 'Kitsune finds each show on miruro.cx by its title and year, and this one didn’t match closely enough to be sure, so it can’t play yet.';
      canRetry = false;
      break;
    case 'episode':
      title = `Episode ${number} isn’t on miruro.cx yet`;
      body = problem.available
        ? `miruro.cx lists ${problem.available} episode${problem.available === 1 ? '' : 's'} for this show. New ones usually appear there within a few hours of airing.`
        : 'miruro.cx doesn’t list any episodes for this show yet.';
      break;
    case 'stream':
      title = 'No working stream for this episode';
      body = problem.tried
        ? `Kitsune tried ${problem.tried} stream${problem.tried === 1 ? '' : 's'} from miruro.cx and none of them started. That’s usually temporary, so give it a minute and try again.`
        : 'miruro.cx has no streams for this episode right now. Give it a while and try again.';
      break;
    case 'blocked':
      title = 'miruro.cx didn’t let Kitsune through';
      body = 'miruro.cx’s security check kept coming back instead of letting the episode through. Give it a moment and try again.';
      break;
    case 'network':
      title = 'Couldn’t reach miruro.cx';
      body = 'Check your connection, then try again.';
      break;
    case 'api':
      title = 'miruro.cx answered with an error';
      body = 'That’s usually temporary, so give it a moment and try again.';
      note = `miruro.cx says: “${problem.text}”`;
      break;
  }
  const other = problem.kind === 'stream' ? problem.other : null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.loader]}>
      <View style={styles.problem}>
        <Icon name="alert-circle-outline" size={36} tint={color.accent} />
        <T variant="title" style={styles.cardTitle}>
          {title}
        </T>
        <T dim style={styles.problemBody}>
          {body}
        </T>
        <View style={styles.problemActions}>
          {canRetry ? <Button label="Try again" icon="refresh" size="sm" hasTVPreferredFocus onPress={onRetry} /> : <Button label="Back to the show" icon="arrow-left" size="sm" hasTVPreferredFocus onPress={onExit} />}
          {other ? <Button label={other === 'dub' ? 'Play the dub' : 'Play subbed'} icon="translate" variant="secondary" size="sm" onPress={() => onSwitch(other)} /> : null}
        </View>
        {note ? (
          <T variant="caption" faint numberOfLines={2} style={styles.problemNote}>
            {note}
          </T>
        ) : null}
      </View>
    </View>
  );
}

function Loader({ name, number, title, thumb, step, local }: { name: string; number: number; title: string; thumb?: string; step: 'resolving' | 'starting' | 'playing' | 'problem'; local?: boolean }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.loader]}>
      {thumb ? <Image source={{ uri: thumb }} blurRadius={18} contentFit="cover" style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} /> : null}
      <LinearGradient colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.94)']} style={StyleSheet.absoluteFill} />
      <View style={styles.card}>
        <Spinner size={44} />
        <T variant="micro" color={color.accent} style={{ marginTop: 22 }}>
          {`Episode ${number}`}
        </T>
        <T variant="title" numberOfLines={2} style={styles.cardTitle}>
          {name}
        </T>
        {title ? (
          <T dim numberOfLines={1} style={{ marginTop: 2 }}>
            {title}
          </T>
        ) : null}
        <T variant="caption" faint style={{ marginTop: 10 }}>
          {local ? 'Playing from your downloads…' : step === 'resolving' ? 'Finding the episode…' : 'Starting the stream…'}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#000', zIndex: 100 },
  video: { flex: 1, backgroundColor: '#000' },
  loader: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  card: { width: 360, alignItems: 'center' },
  cardTitle: { marginTop: 6, textAlign: 'center' },
  back: { position: 'absolute', top: 16, left: 16 },
  blackout: { backgroundColor: '#000' },
  hidden: { opacity: 0 },
  problem: { width: 480, maxWidth: '90%', alignItems: 'center' },
  problemBody: { marginTop: 8, textAlign: 'center', lineHeight: 21 },
  problemActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  problemNote: { marginTop: 14, textAlign: 'center' },
  cueWrap: { position: 'absolute', left: '8%', right: '8%', bottom: isTV ? tv(70) : 54, alignItems: 'center' },
  cueTop: { bottom: undefined, top: isTV ? tv(40) : 24 },
  cueBox: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, textShadowRadius: 0 },
  cue: {
    fontSize: isTV ? tv(26) : 19,
    lineHeight: isTV ? tv(34) : 25,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  skip: {
    position: 'absolute',
    right: isTV ? tv(48) : 24,
    bottom: isTV ? tv(150) : 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: tv(18),
    paddingVertical: tv(10),
    borderRadius: radius.pill,
    backgroundColor: 'rgba(28,28,32,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  skipTv: { bottom: tv(170) },
  toastWrap: { position: 'absolute', bottom: 24, alignSelf: 'center' },
  toast: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: radius.pill, backgroundColor: 'rgba(28,28,32,0.95)', borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
});
