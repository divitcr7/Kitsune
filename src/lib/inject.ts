/**
 * Script strings for the app's hidden miruro.cx tab (components/MiruroBridge.tsx). Cloudflare
 * sometimes puts its own check ("Just a moment…", "Verify you are human") in front of the site,
 * served with an error status. That page is Cloudflare's, so Kitsune leaves it entirely alone and
 * only says it's there; once it passes, Cloudflare loads the real page and the script runs again.
 *
 * gate(run) reads the document's HTTP status (Chromium 109+ reports it; older WebViews don't,
 * which counts as unknown) and posts { type: 'gate', kind, status }:
 * - 'none': a normal page (or unknown); `run` goes right away. With an unknown status it still
 *   looks once the page is parsed and posts 'check' if it's Cloudflare's.
 * - 'check': an error status on Cloudflare's check page; `run` never goes on this document.
 * - 'refused': an error status on any other page, with `text` (the page's title and first words);
 *   `run` goes once the page is parsed.
 */
const GATE = `
  function post(m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
  function pageStatus() {
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      var s = nav && nav.responseStatus;
      return typeof s === 'number' && s > 0 ? s : 0;
    } catch (e) { return 0; }
  }
  // Cloudflare's check page in any language. Not .cf-turnstile or a bare challenge-platform script:
  // the site's own pages carry those (the player's Turnstile box, Cloudflare's jsd script).
  function isCheckPage() {
    if (typeof window._cf_chl_opt !== 'undefined') return true;
    if (document.querySelector('#challenge-form,#challenge-stage,#challenge-running,script[src*="/cdn-cgi/challenge-platform/"][src*="orchestrate"]')) return true;
    return /just a moment|checking your browser|verif(y|ying) you are human/i.test(document.title || '');
  }
  function whenParsed(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  function pageSummary() {
    var title = (document.title || '').replace(/\\s+/g, ' ').trim();
    var body = ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 140);
    if (body.indexOf(title) === 0) return body;
    return (title + ' ' + body).trim();
  }
  function gate(run) {
    var status = pageStatus();
    if (status < 400) {
      post({ type: 'gate', kind: 'none', status: status });
      if (!status) whenParsed(function () { if (isCheckPage()) post({ type: 'gate', kind: 'check', status: 0 }); });
      run();
      return;
    }
    whenParsed(function () {
      if (isCheckPage()) return post({ type: 'gate', kind: 'check', status: status });
      post({ type: 'gate', kind: 'refused', status: status, text: pageSummary() });
      run();
    });
  }
`;

/** Commands the player controls send to the player (seek/seekTo take seconds). */
export type TvCommand = 'toggle' | 'play' | 'pause' | 'seek' | 'seekTo' | 'audio' | 'subs' | 'fill';

/**
 * Runs in the app's hidden miruro.cx tab (see components/MiruroBridge.tsx). That tab opens a plain
 * text file on the site (`/robots.txt`), never a page with the site's scripts, so no ads exist to
 * guard against. Through the gate, it says it's ready and then answers
 * `window.__kitsuneApi(id, path)` with same-origin GETs, posting the raw bytes back as base64
 * (decoding happens in the app). Only `/api/...` and `/env2.js` may be asked for.
 */
export const bridgeScript = `(function () {
  // Injected again at every load step: say "ready" again too, in case the app missed it the first
  // time (a message posted before the app is listening is lost).
  if (window.__kitsuneBridge) {
    if (window.__kitsuneApi) { try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'bridge' })); } catch (e) {} }
    return;
  }
  window.__kitsuneBridge = 1;
${GATE}
  gate(function () {
  function toB64(buf) {
    var bytes = new Uint8Array(buf || new ArrayBuffer(0)), out = '', i;
    for (i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }
  window.__kitsuneApi = function (id, path) {
    if (!/^\\/api\\/[A-Za-z0-9_\\-\\/?=&%.,]+$/.test(path) && path !== '/env2.js') return post({ type: 'res', id: id, status: 0, error: 'path' });
    var x = new XMLHttpRequest();
    x.open('GET', path, true);
    x.responseType = 'arraybuffer';
    x.timeout = 15000;
    x.onload = function () {
      var b64 = '';
      try { b64 = toB64(x.response); } catch (e) {}
      post({ type: 'res', id: id, status: x.status, ctype: x.getResponseHeader('content-type') || '', b64: b64 });
    };
    x.onerror = function () { post({ type: 'res', id: id, status: 0 }); };
    x.ontimeout = x.onerror;
    x.send();
  };
  whenParsed(function () { post({ type: 'bridge' }); });
  });
})();
true;`;

/** Asks the bridge tab for one API path; the answer comes back as a 'res' message. */
export const apiCallScript = (id: string, path: string) =>
  `window.__kitsuneApi&&window.__kitsuneApi(${JSON.stringify(id)},${JSON.stringify(path)});true;`;
