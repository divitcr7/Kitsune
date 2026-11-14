import { create } from 'zustand';
import { apiCallScript } from '../inject';
import { decodeBody, fromBase64 } from './codec';

/**
 * miruro.cx's API sits behind Cloudflare, which turns away clients that aren't browsers. So the app
 * asks it from a real browser: a hidden WebView on the site's origin (components/MiruroBridge.tsx).
 * If Cloudflare wants to check that browser, the check is shown to the person, never answered for
 * them. This module is the queue between the app and that tab.
 */

export type BridgeState = 'off' | 'loading' | 'ready' | 'check' | 'blocked';

type BridgeStore = {
  state: BridgeState;
  /** Requests waiting on the tab (browsing, playback, downloads): a check is shown while any are. */
  waiting: number;
  /** Bumped to make the tab load the site again (after a check turns up mid-session). */
  reload: number;
  set: (state: BridgeState) => void;
};

export const useBridge = create<BridgeStore>((set) => ({
  // The tab opens with the app (components/MiruroBridge.tsx): browsing needs it straight away.
  state: 'loading',
  waiting: 0,
  reload: 0,
  set: (state) => set({ state }),
}));

export class MiruroError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly kind: 'http' | 'network' | 'blocked' | 'timeout' = 'http',
  ) {
    super(message);
    this.name = 'MiruroError';
  }
}

type Pending = {
  path: string;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  sent: boolean;
  retried: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT = 20_000;
// Without any word from the tab for this long, the site can't be reached at all.
const LOAD_TIMEOUT = 30_000;
// Requests the tab works on at once; the rest wait their turn, oldest first.
const MAX_IN_FLIGHT = 4;

const pending = new Map<string, Pending>();
/** The same path asked for twice while the first is still out shares its answer. */
const shared = new Map<string, Promise<unknown>>();
let seq = 0;
let inject: ((js: string) => void) | null = null;
let loadTimer: ReturnType<typeof setTimeout> | undefined;

function inFlight() {
  let n = 0;
  for (const p of pending.values()) if (p.sent) n++;
  return n;
}

function countWaiting() {
  const n = pending.size;
  if (useBridge.getState().waiting !== n) useBridge.setState({ waiting: n });
}

/** Send what's waiting, up to MAX_IN_FLIGHT at once. */
function pump() {
  if (!inject || useBridge.getState().state !== 'ready') return;
  let room = MAX_IN_FLIGHT - inFlight();
  for (const [id, p] of pending) {
    if (room <= 0) break;
    if (p.sent) continue;
    send(id, p);
    room--;
  }
}

function send(id: string, p: Pending) {
  if (!inject || p.sent) return;
  p.sent = true;
  clearTimeout(p.timer);
  p.timer = setTimeout(() => settle(id, new MiruroError(0, 'miruro.cx took too long to answer', 'timeout')), REQUEST_TIMEOUT);
  inject(apiCallScript(id, p.path));
}

function settle(id: string, result: Error | { value: unknown }) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  countWaiting();
  if (result instanceof Error) p.reject(result);
  else p.resolve(result.value);
  pump();
}

function armLoadTimer() {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    if (useBridge.getState().state !== 'loading') return;
    failAll(new MiruroError(0, 'Kitsune couldn’t reach miruro.cx', 'network'));
    useBridge.getState().set('off');
  }, LOAD_TIMEOUT);
}

function failAll(e: Error) {
  for (const id of [...pending.keys()]) settle(id, e);
}

/**
 * GET a miruro.cx API path (`/api/...`) through the bridge tab and decode the answer. Cancelling
 * (`signal`) only stops waiting for it: another caller may share the same request.
 */
export function miruroGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let request = shared.get(path) as Promise<T> | undefined;
  if (!request) {
    request = enqueue<T>(path);
    shared.set(path, request);
    const forget = () => {
      if (shared.get(path) === request) shared.delete(path);
    };
    request.then(forget, forget);
  }
  if (!signal) return request;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new MiruroError(0, 'Cancelled', 'network'));
    signal.addEventListener('abort', () => reject(new MiruroError(0, 'Cancelled', 'network')), { once: true });
    request.then(resolve, reject);
  });
}

function enqueue<T>(path: string): Promise<T> {
  const bridge = useBridge.getState();
  if (bridge.state === 'off') {
    bridge.set('loading');
    armLoadTimer();
  } else if (bridge.state === 'blocked') {
    // A fresh try after the check gave up: load the site again in the tab.
    useBridge.setState({ state: 'loading', reload: bridge.reload + 1 });
    armLoadTimer();
  }
  return new Promise<T>((resolve, reject) => {
    const id = `r${++seq}`;
    const p: Pending = { path, resolve: resolve as (v: unknown) => void, reject, sent: false, retried: false };
    pending.set(id, p);
    countWaiting();
    pump();
  });
}

// ---- called by components/MiruroBridge.tsx ----

export function attachBridge(fn: ((js: string) => void) | null) {
  inject = fn;
}

/** The tab got through the gate onto the real document: send everything that's waiting. */
export function bridgeReady() {
  clearTimeout(loadTimer);
  useBridge.getState().set('ready');
  pump();
}

export function bridgeCheck() {
  clearTimeout(loadTimer);
  useBridge.getState().set('check');
}

/** Cloudflare's check kept coming back: give up on what's waiting and say so. */
export function bridgeBlocked() {
  clearTimeout(loadTimer);
  useBridge.getState().set('blocked');
  failAll(new MiruroError(403, 'miruro.cx’s security check kept coming back', 'blocked'));
}

/** The tab couldn't load the site at all (offline, DNS): don't keep anyone waiting. */
export function bridgeOffline() {
  clearTimeout(loadTimer);
  failAll(new MiruroError(0, 'Kitsune couldn’t reach miruro.cx', 'network'));
  useBridge.getState().set('off');
}

export function bridgeLoading() {
  if (useBridge.getState().state !== 'check') useBridge.getState().set('loading');
  armLoadTimer();
}

/** The tab lost its page (crash, network): requests already sent will never be answered. */
export function bridgeLost() {
  for (const p of pending.values()) {
    p.sent = false;
    clearTimeout(p.timer);
  }
}

export function bridgeResponse(msg: { id?: string; status?: number; ctype?: string; b64?: string }) {
  if (!msg.id) return;
  const p = pending.get(msg.id);
  if (!p) return;
  const status = msg.status ?? 0;
  const ctype = msg.ctype ?? '';
  if (status === 0) return settle(msg.id, new MiruroError(0, 'Kitsune couldn’t reach miruro.cx', 'network'));
  // An HTML 403 from an API path is Cloudflare wanting another look at this browser. Load the site
  // again in the tab so the check (if any) is shown, then send this request once more.
  if (status === 403 && ctype.includes('text/html') && !p.retried) {
    p.retried = true;
    p.sent = false;
    clearTimeout(p.timer);
    const s = useBridge.getState();
    useBridge.setState({ state: 'loading', reload: s.reload + 1 });
    armLoadTimer();
    return;
  }
  let body: unknown;
  try {
    body = decodeBody(fromBase64(msg.b64 ?? ''), ctype);
  } catch {
    return settle(msg.id, new MiruroError(status, 'miruro.cx sent something Kitsune couldn’t read'));
  }
  if (status >= 400) {
    const detail = body && typeof body === 'object' && 'detail' in body ? String((body as { detail: unknown }).detail) : `HTTP ${status}`;
    return settle(msg.id, new MiruroError(status, detail));
  }
  settle(msg.id, { value: body });
}
