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
  /** Bumped to make the tab load the site again (after a check turns up mid-session). */
  reload: number;
  set: (state: BridgeState) => void;
};

export const useBridge = create<BridgeStore>((set) => ({
  state: 'off',
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

const pending = new Map<string, Pending>();
let seq = 0;
let inject: ((js: string) => void) | null = null;
let loadTimer: ReturnType<typeof setTimeout> | undefined;

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
  if (result instanceof Error) p.reject(result);
  else p.resolve(result.value);
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

/** GET a miruro.cx API path (`/api/...`) through the bridge tab and decode the answer. */
export function miruroGet<T>(path: string, signal?: AbortSignal): Promise<T> {
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
    signal?.addEventListener('abort', () => settle(id, new MiruroError(0, 'Cancelled', 'network')), { once: true });
    if (useBridge.getState().state === 'ready') send(id, p);
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
  for (const [id, p] of pending) send(id, p);
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
