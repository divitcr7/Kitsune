import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { localMaster, localMedia, type Media, type MediaPlaylist, parseMaster, parseMedia, pickVariant, type Segment, type Variant } from '../hls';
import { MiruroError, useBridge } from '../miruro/bridge';
import { notifyDownloaded } from '../notify';
import type { SkipTime } from '../miruro/api';
import { UnmatchedError } from '../miruro/match';
import { MissingEpisodeError, resolveEpisode } from '../miruro/resolve';
import { type Candidate, candidates, defaultSubtitle, usableSubtitles } from '../miruro/streams';
import { fetchCues } from '../miruro/subs';
import { usePlayer } from '../player';
import { queryClient, q } from '../queries';
import { holdAwake, letGo, showProgress } from './background';
import { dirFor, ensureDir, removeFiles, sizeOf, sweepParts } from './files';
import { type DownloadFail, type DownloadItem, type SavedSub, useDownloadLive, useDownloads } from './store';

/**
 * Downloads one queued episode at a time, three segments in parallel, into lib/downloads/files.ts's
 * layout. Everything runs in the app's process: a download keeps going while Kitsune is open (the
 * screen is kept awake meanwhile) and picks up from the last saved segment after the app was closed.
 */

const PARALLEL = 3;
const MAX_CANDIDATES = 6;
const RETRY_DELAYS = [1000, 3000, 8000, 20000];
// A segment that hasn't moved a byte in this long is cut off and tried again.
const STALL = 45_000;
const RESOLVE_TIMEOUT = 90_000;
// Free space to leave on the device beyond what the episode still needs.
const RESERVE = 300 * 1024 * 1024;
const ROUGH_BYTES: Record<number, number> = { 1080: 450e6, 720: 250e6, 480: 150e6, 360: 100e6 };

type PlannedPlaylist = { dir: string; segments: Segment[]; map?: string };
type Plan = {
  version: 1;
  key: string;
  provider: string;
  server: string;
  track: string;
  headers?: Record<string, string>;
  variant: Variant;
  video: PlannedPlaylist;
  audio: { media: Media; playlist: PlannedPlaylist }[];
  subs: SavedSub[];
  skips?: SkipTime[];
  want: { audio: string; height: 'best' | number };
};

class Expired extends Error {}
class Failure extends Error {
  constructor(readonly reason: DownloadFail) {
    super(reason);
  }
}

let running: { id: string; ctrl: AbortController } | null = null;
/** Look-ahead: the next queued episode's plan, made while the current one downloads. */
const planning = new Map<string, Promise<void>>();
let quietUntil = 0;
let wake: ReturnType<typeof setTimeout> | undefined;
const networkTries = new Map<string, number>();

/** Let the screen sleep again (no-op if it wasn't kept on). */
function sleepOk() {
  Promise.resolve(deactivateKeepAwake('downloads')).catch(() => {});
}

/** Start the next queued download if none is running; stop the running one if it's no longer wanted. */
export function kick() {
  const s = useDownloads.getState();
  if (running) {
    const it = s.items[running.id];
    if (!it || s.paused || it.status === 'paused' || it.status === 'queued' || it.status === 'failed') running.ctrl.abort();
    return;
  }
  if (s.paused) {
    sleepOk();
    letGo();
    return;
  }
  const wait = quietUntil - Date.now();
  if (wait > 0) {
    sleepOk();
    clearTimeout(wake);
    wake = setTimeout(kick, wait + 50);
    return;
  }
  const id = s.order.find((k) => s.items[k]?.status === 'queued');
  if (!id) {
    sleepOk();
    letGo();
    return;
  }
  const ctrl = new AbortController();
  running = { id, ctrl };
  const it = s.items[id];
  holdAwake(`${it.show.name}  ·  Episode ${it.episode.number}`, 'Finding the stream…');
  activateKeepAwakeAsync('downloads').catch(() => {});
  run(id, ctrl.signal).finally(() => {
    running = null;
    useDownloadLive.getState().set({ id: null, done: 0, total: 0, bytes: 0, bps: 0 });
    setTimeout(kick, 0);
  });
}

/** Delete a download (stopping it first if it's the one running). */
export function deleteDownload(id: string) {
  const isRunning = running?.id === id;
  useDownloads.getState().remove(id);
  // The running one's files go once its transfer has stopped (see run()).
  if (isRunning) kick();
  else removeFiles(id);
}

/** After an app restart: tidy up half-written files and anything left from removed downloads. */
export function startup() {
  const items = useDownloads.getState().items;
  for (const id of Object.keys(items)) if (items[id].status !== 'done') sweepParts(dirFor(id));
  kick();
}

async function run(id: string, signal: AbortSignal) {
  const store = useDownloads.getState();
  try {
    await download(id, signal);
    networkTries.delete(id);
  } catch (e) {
    const s = useDownloads.getState();
    const it = s.items[id];
    if (!it) {
      // Removed while downloading.
      removeFiles(id);
      return;
    }
    if (signal.aborted) {
      // Paused (one or all): what's saved stays for later.
      if (s.paused && it.status !== 'paused') store.patch(id, { status: 'queued' });
      return;
    }
    if (e instanceof MiruroError && e.status === 429) {
      // miruro.cx asked to slow down: hold the whole queue for a while.
      usePlayer.getState().backOff();
      quietUntil = Date.now() + 10 * 60_000;
      store.patch(id, { status: 'queued' });
      return;
    }
    const reason = reasonFor(e);
    if (reason === 'network') {
      const n = (networkTries.get(id) ?? 0) + 1;
      networkTries.set(id, n);
      if (n <= 3) {
        quietUntil = Date.now() + 20_000 * n;
        store.patch(id, { status: 'queued' });
        return;
      }
    }
    networkTries.delete(id);
    store.patch(id, { status: 'failed', fail: reason });
  } finally {
    if (useDownloads.getState().asking === id) useDownloads.getState().setAsking(null);
  }
}

function reasonFor(e: unknown): DownloadFail {
  if (e instanceof Failure) return e.reason;
  if (e instanceof UnmatchedError) return 'unmatched';
  if (e instanceof MissingEpisodeError) return 'episode';
  if (e instanceof MiruroError) return e.kind === 'blocked' ? 'blocked' : e.kind === 'network' || e.kind === 'timeout' ? 'network' : 'stream';
  return 'network';
}

function pad(i: number) {
  return String(i).padStart(5, '0');
}

async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let id: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, reject) => (id = setTimeout(() => reject(onTimeout()), ms)))]);
  } finally {
    clearTimeout(id);
  }
}

async function resolveFor(item: DownloadItem) {
  return withTimeout(resolveEpisode(item.show.id, item.episode.number), RESOLVE_TIMEOUT, () =>
    useBridge.getState().state === 'check' ? new Failure('blocked') : new Failure('network'),
  );
}

async function getText(url: string, headers: Record<string, string> | undefined, signal: AbortSignal) {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  signal.addEventListener('abort', stop, { once: true });
  const id = setTimeout(stop, 15_000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (res.status === 403 || res.status === 404 || res.status === 410) throw new Expired(`HTTP ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(id);
    signal.removeEventListener('abort', stop);
  }
}

/** Playlists for one candidate at the wanted height, or why it can't be saved. */
async function planFor(c: Candidate, want: DownloadItem['want'], signal: AbortSignal): Promise<Omit<Plan, 'subs' | 'skips'>> {
  const masterText = await getText(c.uri, c.headers, signal);
  const master = parseMaster(masterText, c.uri);
  let variant: Variant;
  let videoUrl: string;
  const audioMedia: Media[] = [];
  if (master && master.variants.length) {
    variant = pickVariant(master.variants, want.height);
    videoUrl = variant.uri;
    const group = master.media.filter((m) => m.type === 'AUDIO' && m.groupId === variant.audioGroup && m.uri);
    const def = group.find((m) => m.isDefault) ?? group[0];
    const lang = want.audioLang?.toLowerCase();
    const pref = lang ? group.find((m) => (m.language ?? '').toLowerCase().startsWith(lang)) : undefined;
    for (const m of [def, pref]) if (m && !audioMedia.includes(m)) audioMedia.push(m);
  } else {
    // Already a media playlist: one quality, audio inside.
    variant = { uri: c.uri, bandwidth: 0, width: 0, height: 0, line: '#EXT-X-STREAM-INF:BANDWIDTH=1000000' };
    videoUrl = c.uri;
  }
  const load = async (url: string, dir: string): Promise<PlannedPlaylist> => {
    const parsed: MediaPlaylist = master ? parseMedia(await getText(url, c.headers, signal), url) : parseMedia(masterText, url);
    if (parsed.encrypted) throw new Failure('protected');
    if (parsed.byteRange || !parsed.ended || !parsed.segments.length) throw new Failure('stream');
    return { dir, segments: parsed.segments, map: parsed.map };
  };
  const video = await load(videoUrl, 'v');
  const audio: Plan['audio'] = [];
  for (const [i, m] of audioMedia.entries()) audio.push({ media: m, playlist: await load(m.uri!, `a${i}`) });
  return { version: 1, key: c.key, provider: c.provider, server: c.server, track: c.track, headers: c.headers, variant, video, audio, want: { audio: want.audio, height: want.height } };
}

/** Up to three subtitle files (the one asked for, the default, English) as cue files. */
async function saveSubs(c: Candidate, item: DownloadItem, dir: Directory, env: Parameters<typeof fetchCues>[2], signal: AbortSignal): Promise<SavedSub[] | null> {
  const list = usableSubtitles(c.subtitles);
  if (!list.length) return [];
  const picks = [defaultSubtitle(list, item.want.subLang), defaultSubtitle(list), list.find((s) => /^en/i.test(s.language))].filter((s, i, a): s is NonNullable<typeof s> => !!s && a.indexOf(s) === i).slice(0, 3);
  const subsDir = new Directory(dir, 'subs');
  ensureDir(subsDir);
  const saved: SavedSub[] = [];
  for (const sub of picks) {
    try {
      const cues = await fetchCues(sub, c, env, signal);
      const file = `${saved.length}.json`;
      new File(subsDir, file).writeSync(JSON.stringify({ language: sub.language, label: sub.label, cues }));
      saved.push({ language: sub.language, label: sub.label, file });
    } catch {
      // Try the next language.
    }
  }
  // Clean video with no subtitles at all isn't worth saving if another server has them.
  return saved.length ? saved : null;
}

function readPlan(dir: Directory): Plan | null {
  try {
    const f = new File(dir, 'plan.json');
    if (!f.exists) return null;
    const p = JSON.parse(f.textSync()) as Plan;
    return p.version === 1 ? p : null;
  } catch {
    return null;
  }
}

/**
 * Find the next queued episode's stream while this one downloads. Its lookup needs the miruro
 * bridge (a WebView), which Android destroys if Kitsune is swiped away; with the plan already made,
 * that episode downloads without it.
 */
function planAhead(currentId: string) {
  const s = useDownloads.getState();
  const next = s.order.find((k) => k !== currentId && s.items[k]?.status === 'queued');
  if (!next || planning.has(next)) return;
  const dir = dirFor(next);
  if (readPlan(dir)) return;
  const item = s.items[next];
  const ctrl = new AbortController();
  const job = (async () => {
    ensureDir(dir);
    await makePlan(item, dir, ctrl.signal);
  })()
    .catch(() => {
      // It'll be looked up again on its turn.
    })
    .finally(() => {
      planning.delete(next);
      if (!useDownloads.getState().items[next]) removeFiles(next);
    });
  planning.set(next, job);
}

async function download(id: string, signal: AbortSignal) {
  const store = useDownloads.getState();
  const item = store.items[id];
  if (!item) return;
  store.patch(id, { status: 'resolving', fail: undefined });
  // A look-ahead for this very episode may still be running: let it finish, then use its plan.
  await planning.get(id);
  const dir = dirFor(id);
  ensureDir(dir);

  let plan = readPlan(dir);
  if (plan && (plan.want.audio !== item.want.audio || plan.want.height !== item.want.height)) {
    // The person asked for something else this time: start over.
    removeFiles(id);
    ensureDir(dir);
    plan = null;
  }
  if (!plan) plan = await makePlan(item, dir, signal);
  if (signal.aborted) throw new Error('aborted');

  store.patch(id, { status: 'downloading' });
  planAhead(id);
  try {
    await fetchSegments(id, plan, dir, signal);
  } catch (e) {
    if (!(e instanceof Expired) || signal.aborted) throw e;
    // Stream links carry tokens that run out: look the episode up again and carry on.
    plan = await refreshPlan(item, plan, dir, signal);
    await fetchSegments(id, plan, dir, signal);
  }

  // Local playlists, master last: its presence marks the download complete.
  const ext = (p: PlannedPlaylist) => (p.map ? 'm4s' : 'ts');
  new File(dir, 'video.m3u8').writeSync(localMedia({ ...plan.video, encrypted: false, byteRange: false, ended: true }, (i) => `v/${pad(i)}.${ext(plan.video)}`, plan.video.map ? 'v/init.mp4' : undefined));
  plan.audio.forEach((a, i) => {
    new File(dir, `a${i}.m3u8`).writeSync(localMedia({ ...a.playlist, encrypted: false, byteRange: false, ended: true }, (n) => `a${i}/${pad(n)}.${ext(a.playlist)}`, a.playlist.map ? `a${i}/init.mp4` : undefined));
  });
  new File(dir, 'master.m3u8').writeSync(localMaster(plan.variant, plan.audio.map((a, i) => ({ media: a.media, file: `a${i}.m3u8` })), 'video.m3u8'));

  const after = useDownloads.getState();
  notifyDownloaded(item.show.name, item.episode.number, after.order.filter((k) => k !== id && after.items[k]?.status === 'queued').length);
  useDownloads.getState().patch(id, {
    status: 'done',
    doneAt: Date.now(),
    bytes: sizeOf(id),
    skips: plan.skips,
    got: { provider: plan.provider, server: plan.server, track: plan.track, height: plan.variant.height, audioLangs: plan.audio.map((a) => a.media.language ?? a.media.name), subs: plan.subs },
  });
}

async function makePlan(item: DownloadItem, dir: Directory, signal: AbortSignal): Promise<Plan> {
  const res = await resolveFor(item);
  const list = candidates(res.play, res.config, res.env, item.want.audio).slice(0, MAX_CANDIDATES * 2);
  if (!list.length) throw new Failure('stream');
  let lastFail: DownloadFail = 'stream';
  let fallback: Plan | null = null;
  let tried = 0;
  for (const c of list) {
    if (signal.aborted) break;
    if (tried >= MAX_CANDIDATES) break;
    tried++;
    try {
      const base = await planFor(c, item.want, signal);
      // The first segment proves the server really serves this episode.
      const probeFile = new File(dir, 'probe.part');
      try {
        await fetchOne(base.video.segments[0].uri, probeFile, base.headers, signal, () => {});
      } finally {
        if (probeFile.exists) probeFile.delete();
      }
      const subs = await saveSubs(c, item, dir, res.env, signal);
      const plan: Plan = { ...base, subs: subs ?? [], skips: res.episode.skip_times };
      if (subs === null) {
        fallback ??= plan;
        continue;
      }
      writePlan(dir, plan);
      return plan;
    } catch (e) {
      if (signal.aborted) throw e;
      if (e instanceof Failure) lastFail = e.reason;
    }
  }
  if (fallback) {
    writePlan(dir, fallback);
    return fallback;
  }
  throw new Failure(lastFail);
}

async function refreshPlan(item: DownloadItem, old: Plan, dir: Directory, signal: AbortSignal): Promise<Plan> {
  const res0 = await resolveFor(item);
  queryClient.removeQueries({ queryKey: q.play(res0.link.miruro, res0.episode.episode_number).queryKey });
  const res = await resolveFor(item);
  const c = candidates(res.play, res.config, res.env, item.want.audio).find((x) => x.key === old.key);
  if (c) {
    try {
      const fresh = await planFor(c, item.want, signal);
      const same = fresh.video.segments.length === old.video.segments.length && fresh.audio.length === old.audio.length && fresh.audio.every((a, i) => a.playlist.segments.length === old.audio[i].playlist.segments.length);
      if (same) {
        const plan: Plan = { ...fresh, subs: old.subs, skips: old.skips };
        writePlan(dir, plan);
        return plan;
      }
    } catch (e) {
      if (signal.aborted) throw e;
    }
  }
  // The server changed what it serves: start this episode over, once.
  removeFiles(item.id);
  ensureDir(dir);
  return makePlan(item, dir, signal);
}

function writePlan(dir: Directory, plan: Plan) {
  new File(dir, 'plan.json').writeSync(JSON.stringify(plan));
}

/** One segment into `part`, with a watchdog for transfers that stall. */
async function fetchOne(url: string, part: File, headers: Record<string, string> | undefined, signal: AbortSignal, onBytes: (n: number) => void) {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  signal.addEventListener('abort', stop, { once: true });
  let stall = setTimeout(stop, STALL);
  let last = 0;
  try {
    await File.downloadFileAsync(url, part, {
      headers,
      idempotent: true,
      signal: ctrl.signal,
      onProgress: ({ bytesWritten }) => {
        clearTimeout(stall);
        stall = setTimeout(stop, STALL);
        onBytes(bytesWritten - last);
        last = bytesWritten;
      },
    });
  } catch (e) {
    const status = Number(String((e as Error)?.message ?? '').match(/status:?\s*(\d{3})/)?.[1]);
    if (status === 403 || status === 404 || status === 410) throw new Expired(`HTTP ${status}`);
    throw e;
  } finally {
    clearTimeout(stall);
    signal.removeEventListener('abort', stop);
  }
  // A 200 that's really an error page (HTML, JSON or a playlist) isn't video.
  const size = part.size ?? 0;
  if (!size) throw new Error('Empty segment');
  const handle = part.open(FileMode.ReadOnly);
  try {
    const first = handle.readBytesSync(1)[0];
    if (first === 0x3c || first === 0x7b || first === 0x23) throw new Expired('Not a video segment');
  } finally {
    handle.close();
  }
}

async function fetchSegments(id: string, plan: Plan, dir: Directory, signal: AbortSignal) {
  type Job = { url: string; file: File; part: File };
  const jobs: Job[] = [];
  const add = (p: PlannedPlaylist) => {
    const sub = new Directory(dir, p.dir);
    ensureDir(sub);
    const ext = p.map ? 'm4s' : 'ts';
    if (p.map) jobs.push({ url: p.map, file: new File(sub, 'init.mp4'), part: new File(sub, 'init.mp4.part') });
    p.segments.forEach((s, i) => jobs.push({ url: s.uri, file: new File(sub, `${pad(i)}.${ext}`), part: new File(sub, `${pad(i)}.${ext}.part`) }));
  };
  add(plan.video);
  plan.audio.forEach((a) => add(a.playlist));

  const total = jobs.length;
  const todo = jobs.filter((j) => !j.file.exists);
  let done = total - todo.length;
  let bytes = sizeOf(id);
  const live = useDownloadLive.getState();
  const window: { t: number; b: number }[] = [];
  let lastLive = 0;
  let sinceSpaceCheck = 0;
  let failedInARow = 0;
  const report = (force = false) => {
    const now = Date.now();
    window.push({ t: now, b: bytes });
    while (window.length > 1 && now - window[0].t > 5000) window.shift();
    if (!force && now - lastLive < 500) return;
    lastLive = now;
    const span = (now - window[0].t) / 1000;
    const bps = span > 0.5 ? (bytes - window[0].b) / span : 0;
    live.set({ id, done, total, bytes, bps });
    const it = useDownloads.getState().items[id];
    if (it) {
      const more = useDownloads.getState().order.filter((k) => k !== id && useDownloads.getState().items[k]?.status === 'queued').length;
      const speed = bps > 0 ? `  ·  ${(bps / 1e6).toFixed(1)} MB/s` : '';
      showProgress(`${it.show.name}  ·  Episode ${it.episode.number}`, `${Math.floor((done / total) * 100)}%${speed}${more ? `  ·  ${more} more after this` : ''}`, done / total);
    }
  };
  report(true);

  // Workers stop together: when one gives up, the others mustn't carry on alongside a retry.
  const inner = new AbortController();
  const onOuter = () => inner.abort();
  signal.addEventListener('abort', onOuter, { once: true });
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      if (inner.signal.aborted) throw new Error('aborted');
      const job = todo[next++];
      let attempt = 0;
      for (;;) {
        let got = 0;
        try {
          await fetchOne(job.url, job.part, plan.headers, inner.signal, (n) => {
            got += n;
            bytes += n;
            report();
          });
          job.part.moveSync(job.file, { overwrite: true });
          // Progress events can be sparse; count the file as it landed.
          const extra = (job.file.size ?? 0) - got;
          if (extra > 0) bytes += extra;
          failedInARow = 0;
          break;
        } catch (e) {
          bytes -= got;
          if (inner.signal.aborted) throw e;
          if (e instanceof Expired) throw e;
          if (attempt >= RETRY_DELAYS.length) {
            failedInARow++;
            // Several segments in a row giving up looks like dead links, not a bad connection.
            if (failedInARow >= 3) throw new Expired('Segments keep failing');
            throw e;
          }
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt++]));
        }
      }
      done++;
      report();
      if (done % 10 === 0) useDownloads.getState().patch(id, { segs: { done, total }, bytes });
      if (++sinceSpaceCheck >= 20) {
        sinceSpaceCheck = 0;
        const perSeg = done ? bytes / done : (ROUGH_BYTES[plan.variant.height] ?? 300e6) / total;
        if (Paths.availableDiskSpace < perSeg * (total - done) + RESERVE) throw new Failure('space');
      }
    }
  };

  // Before starting: is there room for a rough estimate of the whole episode?
  const estimate = ROUGH_BYTES[plan.variant.height] ?? 300e6;
  if (done === 0 && Paths.availableDiskSpace < estimate + RESERVE) throw new Failure('space');

  let first: unknown = null;
  await Promise.allSettled(
    Array.from({ length: Math.min(PARALLEL, todo.length) }, () =>
      worker().catch((e: unknown) => {
        first ??= e;
        inner.abort();
      }),
    ),
  );
  signal.removeEventListener('abort', onOuter);
  if (signal.aborted) throw new Error('aborted');
  if (first) throw first;
  report(true);
  useDownloads.getState().patch(id, { segs: { done, total }, bytes });
}
