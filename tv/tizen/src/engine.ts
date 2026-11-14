/*
 * Playing an HLS stream in the page's own <video>. hls.js (over Media Source Extensions) is the
 * main path: it gives the quality and audio-language choices. A TV whose browser can't run it plays
 * the stream natively, which Samsung's browsers do for HLS, without those choices.
 *
 * hls.js isn't bundled: it's 400 KB and newer than ES5, and TizenBrew already fetches this module
 * from jsDelivr, so it comes from there too, pinned to one version.
 */

type Level = { height: number; width: number; bitrate: number };
type AudioTrack = { name: string; lang?: string };
type ErrorData = { type: string; details: string; fatal: boolean };

interface HlsInstance {
  levels: Level[];
  audioTracks: AudioTrack[];
  audioTrack: number;
  currentLevel: number;
  loadSource(url: string): void;
  attachMedia(video: HTMLVideoElement): void;
  recoverMediaError(): void;
  destroy(): void;
  on(event: string, fn: (event: string, data: ErrorData) => void): void;
}

interface HlsClass {
  new (config: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: Record<string, string>;
  ErrorTypes: Record<string, string>;
}

declare global {
  interface Window {
    Hls?: HlsClass;
  }
}

const HLS_JS = ['https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js', 'https://unpkg.com/hls.js@1.5.20/dist/hls.min.js'];

let loading: Promise<HlsClass | null> | null = null;

/** hls.js, loaded once (started early so Play doesn't wait); null if it can't load or run here. */
export function loadHls(): Promise<HlsClass | null> {
  if (!loading) loading = from(0);
  return loading;
}

function from(i: number): Promise<HlsClass | null> {
  if (window.Hls) return Promise.resolve(supported(window.Hls));
  if (i >= HLS_JS.length) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const s = document.createElement('script');
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (ok && window.Hls) resolve(supported(window.Hls));
      else from(i + 1).then(resolve);
    };
    s.src = HLS_JS[i];
    s.async = true;
    s.onload = () => finish(true);
    s.onerror = () => finish(false);
    setTimeout(() => finish(false), 15_000);
    (document.head || document.documentElement).appendChild(s);
  });
}

function supported(Hls: HlsClass) {
  try {
    return Hls.isSupported() ? Hls : null;
  } catch {
    return null;
  }
}

export type Engine = {
  kind: 'hls' | 'native';
  /** Picture heights on offer, highest first (empty when the browser chooses). */
  heights(): number[];
  /** Play at most this height (0: automatic). */
  setQuality(height: number): void;
  audios(): AudioTrack[];
  audio(): number;
  setAudio(i: number): void;
  destroy(): void;
};

export type Handlers = {
  /** The stream can't go on (after hls.js's own recovery). */
  onFatal(): void;
  /** Track lists became known. */
  onTracks(): void;
};

export function hlsEngine(Hls: HlsClass, video: HTMLVideoElement, url: string, start: number, quality: number, audioLang: string | null, on: Handlers): Engine {
  const hls = new Hls({ startPosition: start > 0 ? start : -1, maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30, enableWorker: true });
  let recovered = false;
  const indexFor = (height: number) => {
    let best = -1;
    hls.levels.forEach((l, i) => {
      if (l.height <= height && (best < 0 || l.height > hls.levels[best].height)) best = i;
    });
    return best;
  };
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (quality > 0) hls.currentLevel = indexFor(quality);
    on.onTracks();
  });
  hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
    if (audioLang) {
      const want = audioLang.toLowerCase();
      const i = hls.audioTracks.map((a) => (a.lang || '').toLowerCase()).indexOf(want);
      if (i >= 0 && i !== hls.audioTrack) hls.audioTrack = i;
    }
    on.onTracks();
  });
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
      recovered = true;
      hls.recoverMediaError();
      return;
    }
    on.onFatal();
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return {
    kind: 'hls',
    heights: () =>
      hls.levels
        .map((l) => l.height)
        .filter((h, i, a) => h > 0 && a.indexOf(h) === i)
        .sort((a, b) => b - a),
    setQuality: (height) => {
      hls.currentLevel = height > 0 ? indexFor(height) : -1;
    },
    audios: () => hls.audioTracks,
    audio: () => hls.audioTrack,
    setAudio: (i) => {
      hls.audioTrack = i;
    },
    destroy: () => hls.destroy(),
  };
}

export function nativeEngine(video: HTMLVideoElement, url: string, start: number, on: Handlers): Engine {
  const seek = () => {
    video.removeEventListener('loadedmetadata', seek);
    if (start > 0) video.currentTime = start;
    on.onTracks();
  };
  const fail = () => on.onFatal();
  video.addEventListener('loadedmetadata', seek);
  video.addEventListener('error', fail);
  video.src = url;
  video.load();
  return {
    kind: 'native',
    heights: () => [],
    setQuality: () => {},
    audios: () => [],
    audio: () => -1,
    setAudio: () => {},
    destroy: () => {
      video.removeEventListener('loadedmetadata', seek);
      video.removeEventListener('error', fail);
      video.removeAttribute('src');
      video.load();
    },
  };
}

export function canPlayNative(video: HTMLVideoElement) {
  return !!video.canPlayType('application/vnd.apple.mpegurl');
}
