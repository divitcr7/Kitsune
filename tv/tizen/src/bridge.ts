/**
 * The shared page scripts (src/lib/inject.ts) talk to "the app" through window.ReactNativeWebView,
 * as they do in the phone's WebView. Here the app is this module in the same page, so the shim hands
 * each message straight to our listeners.
 */
export type Msg = {
  type: string;
  id?: string;
  slug?: string;
  number?: number;
  t?: number;
  d?: number;
  text?: string;
  kind?: string;
  on?: boolean;
  signedIn?: boolean;
  path?: string;
  state?: string;
  paused?: boolean;
  buffering?: boolean;
  audio?: string | null;
  subs?: string | null;
  fill?: boolean;
  /** Hosts the guard held back, sent with a 'problem'. */
  blocked?: string[];
};

const listeners: ((m: Msg) => void)[] = [];
/** Recent messages, so a listener that starts late (the overlay mounts after the page parses) misses nothing. */
const past: Msg[] = [];

export function installBridge() {
  if (window.ReactNativeWebView) return;
  window.ReactNativeWebView = {
    postMessage(data: string) {
      let msg: Msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      past.push(msg);
      if (past.length > 60) past.shift();
      for (const fn of listeners.slice()) {
        try {
          fn(msg);
        } catch (e) {
          console.error(e);
        }
      }
    },
  };
}

export function onMessage(fn: (m: Msg) => void, replay = false) {
  if (replay) past.slice().forEach(fn);
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/**
 * Runs one of the shared script strings in the page. An inline <script> runs in the page like the
 * WebView's injection does; if the site's CSP refuses inline scripts, fall back to Function (allowed
 * unless the CSP also forbids eval). Returns whether it ran.
 */
export function runScript(source: string): boolean {
  const before = window.__kitsuneRan ?? 0;
  const marked = `${source}\n;window.__kitsuneRan=(window.__kitsuneRan||0)+1;`;
  try {
    const s = document.createElement('script');
    s.textContent = marked;
    (document.head || document.documentElement).appendChild(s);
    s.parentNode?.removeChild(s);
  } catch {}
  if ((window.__kitsuneRan ?? 0) > before) return true;
  try {
    new Function(marked)();
    return true;
  } catch (e) {
    console.error('Kitsune could not run a page script', e);
    return false;
  }
}
