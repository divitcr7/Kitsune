/**
 * The player and account scripts start here. Cloudflare sometimes puts its own check ("Just a
 * moment…", "Verify you are human") in front of anime.nexus, served with an error status. That page
 * is Cloudflare's, so Kitsune leaves it entirely alone and only says it's there; once it passes,
 * Cloudflare loads the real page and the script runs again there.
 *
 * gate(run) reads the document's HTTP status (Chromium 109+ reports it; older TV browsers don't,
 * which counts as unknown) and posts { type: 'gate', kind, status }:
 * - 'none': a normal page (or unknown); `run` goes right away, before the site's own scripts. With
 *   an unknown status it still looks once the page is parsed and posts 'check' if it's Cloudflare's.
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

/**
 * Shared by every anime.nexus page Kitsune opens (inside gate's `run`, after GATE, whose post() it
 * uses): scripts and iframes may only come from the site, its CDNs and Cloudflare (ad networks
 * rotate throwaway domains, so this is an allowlist), and window.open, document.write and
 * alert/confirm/prompt do nothing.
 */
const GUARD = `
  var CODE_OK = /(^|\\.)(anime\\.nexus|anime\\.delivery|cdn\\.nexus|challenges\\.cloudflare\\.com)$/i;
  var NAV_OK = /(^|\\.)(anime\\.nexus|anime\\.delivery|cloudflare\\.com)$/i;
  var BLOCK = /(popads|popcash|propeller|onclick|clickadu|hilltopads|adsterra|profitableratecpm|highperformanceformat|revenuecpmgate|smartpopads|pemsrv|doubleclick|googlesyndication|exoclick|exosrv|juicyads|monetag|magsrv|realsrv|tsyndicate|trafficjunky|mgid|taboola|outbrain|galaksion|admaven|richads|rollerads|evadav|cpmgate|ratecpm|popunder|googletagmanager|google-analytics|cloudflareinsights)/i;

  function host(u) { try { return new URL(u, location.href).hostname; } catch (e) { return ''; } }
  // What the guard turned away, so an error screen can say (helps when the site starts needing a new host).
  var held = {};
  window.__kitsuneHeld = function () { return Object.keys(held).slice(0, 6); };
  function codeOk(u) { if (!u) return true; var h = host(u); if (!h || CODE_OK.test(h)) return true; held[h] = 1; return false; }
  function bad(u) { var h = host(u); if (!h || !BLOCK.test(h)) return false; held[h] = 1; return true; }

  function guard(proto, attr, ok) {
    var d = proto && Object.getOwnPropertyDescriptor(proto, attr);
    if (!d || !d.set) return;
    Object.defineProperty(proto, attr, {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set: function (v) { if (!ok(v)) return; d.set.call(this, v); }
    });
  }
  var notBad = function (v) { return !bad(v); };
  guard(window.HTMLScriptElement && HTMLScriptElement.prototype, 'src', codeOk);
  guard(window.HTMLIFrameElement && HTMLIFrameElement.prototype, 'src', codeOk);
  guard(window.HTMLLinkElement && HTMLLinkElement.prototype, 'href', notBad);
  guard(window.HTMLImageElement && HTMLImageElement.prototype, 'src', notBad);
  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (n, v) {
    if (n === 'src' && /^(SCRIPT|IFRAME)$/.test(this.tagName) && !codeOk(v)) return;
    if ((n === 'src' || n === 'href') && /^(LINK|IMG)$/.test(this.tagName) && bad(v)) return;
    return setAttr.call(this, n, v);
  };

  function foreign(n) {
    return !!n && n.nodeType === 1 && (n.tagName === 'SCRIPT' || n.tagName === 'IFRAME') && !codeOk(n.getAttribute('src'));
  }
  function scrub(n) {
    if (!n || !n.querySelectorAll || (n.nodeType !== 1 && n.nodeType !== 11)) return;
    var list = n.querySelectorAll('script[src],iframe[src]');
    for (var i = 0; i < list.length; i++) if (foreign(list[i])) list[i].remove();
  }
  function wrapInsert(proto, name) {
    var orig = proto && proto[name];
    if (!orig) return;
    proto[name] = function (node) {
      if (foreign(node)) return node;
      scrub(node);
      return orig.apply(this, arguments);
    };
  }
  wrapInsert(Node.prototype, 'appendChild');
  wrapInsert(Node.prototype, 'insertBefore');
  wrapInsert(Node.prototype, 'replaceChild');
  ['append', 'prepend', 'before', 'after', 'replaceWith'].forEach(function (name) {
    var orig = Element.prototype[name];
    if (!orig) return;
    Element.prototype[name] = function () {
      var args = [].filter.call(arguments, function (n) { scrub(n); return !foreign(n); });
      return orig.apply(this, args);
    };
  });
  document.write = function () {};
  document.writeln = function () {};

  var noop = function () { return null; };
  try { Object.defineProperty(window, 'open', { configurable: true, get: function () { return noop; }, set: function () {} }); }
  catch (e) { window.open = noop; }
  window.alert = function () {};
  window.confirm = function () { return false; };
  window.prompt = function () { return null; };

  var afterMutation = function () {};
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (foreign(n)) n.remove();
        else scrub(n);
      }
    }
    afterMutation();
  }).observe(document, { childList: true, subtree: true });
`;

/**
 * Stands in for GUARD in a test build's "without ad guard" retry: the same names the player body
 * uses from GUARD, and nothing patched, so the page runs exactly as it would in a browser.
 */
const GUARD_OFF = `
  var NAV_OK = /(^|\\.)(anime\\.nexus|anime\\.delivery|cloudflare\\.com)$/i;
  function host(u) { try { return new URL(u, location.href).hostname; } catch (e) { return ''; } }
  window.__kitsuneHeld = function () { return []; };
  var afterMutation = function () {};
  new MutationObserver(function () { afterMutation(); }).observe(document, { childList: true, subtree: true });
`;

/**
 * Runs inside anime.nexus/watch/* as the page starts loading (before the site injects its ads),
 * once GATE lets it (never on Cloudflare's check page, which the app shows untouched).
 *
 * 1. GUARD: only first-party code runs; popups, dialogs and document.write go nowhere.
 * 2. Off-site links do nothing, sign-in links open the app's account screen, show links close the player.
 * 3. The site's player is pinned full-screen over the rest of the page; stray overlays are hidden.
 * 4. Playback autoplays (unless preloading), resumes at `start.t`, and progress is posted back.
 * 5. A Cloudflare "verify you're human" check is lifted above the player so it can be answered, and
 *    the site's own error messages (sign-in required, stream failed) are reported to the app.
 * Comment / related-show requests are answered locally so the page spends its time on video.
 *
 * With `tv`, the site's own controls are hidden and the app drives playback with a remote: it
 * calls `window.__kitsuneCmd` (see tvCommandScript) and draws its own OSD from 'tick' messages.
 *
 * Requests that fail (and video errors) are recorded and sent with a 'problem' as `diag`, entries
 * like "fetch 403 api.anime.nexus/api/anime/episode/stream cf-mitigated" (no query string).
 *
 * With `bare` (test builds only), the ad guard and every page change are left out: no patched
 * prototypes or fetch/XHR, no styles, no pinning; only passive listening and the app messages.
 */
export function playerScript(start: { id: string; t: number; preload: boolean; tv?: boolean; bare?: boolean }) {
  return `(function () {
  if (window.__kitsune) return;
  window.__kitsune = 1;
  var START = ${JSON.stringify(start)};
${GATE}
  // Everything else waits for the gate (and never runs on Cloudflare's check page).
  gate(function () {
${start.bare ? GUARD_OFF : GUARD}
  var SKIP = /\\/api\\/anime\\/(auth\\/)?(episode\\/comments?|episode\\/comment\\/replies|details\\/related|recommendations)/;
  var AUTH_PATH = /^\\/(login|register|signup|forgot|reset)/;
  var CHALLENGE = 'iframe[src*="challenges.cloudflare.com"]';

  /* What failed to load, sent with a 'problem' so the error screen can name the request that broke. */
  var failedLoads = [], failedSeen = {};
  function noteFailure(kind, url, status, extra) {
    try {
      var u = new URL(String(url || ''), location.href);
      // No query string: it can carry tokens.
      var where = u.hostname + u.pathname.slice(0, 48);
      var key = status + ' ' + where;
      if (failedSeen[key] || failedLoads.length >= 10) return;
      failedSeen[key] = 1;
      failedLoads.push(kind + ' ' + status + ' ' + where + (extra ? ' ' + extra : ''));
    } catch (e) {}
  }
  window.__kitsuneFailed = function () { return failedLoads.slice(); };
  // A side chain only: the page still gets the original promise, rejection included.
  function watchFetch(p, url) {
    if (!p || typeof p.then !== 'function') return;
    p.then(function (r) {
      if (!r || !(r.status >= 400)) return;
      var cf = '';
      try { cf = (r.headers && r.headers.get('cf-mitigated')) || ''; } catch (e) {}
      noteFailure('fetch', url, r.status, cf);
    }, function (err) {
      // Aborts are the site cancelling its own requests (seeking, switching quality), not failures.
      if (err && err.name === 'AbortError') return;
      noteFailure('fetch', url, 0, String((err && err.message) || err || 'failed').slice(0, 40));
    });
  }

  var realFetch = window.fetch;
  var realOpen = window.XMLHttpRequest && XMLHttpRequest.prototype.open;
  if (!START.bare) {
    window.fetch = function (input) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (SKIP.test(url)) {
        return Promise.resolve(new Response('{"data":[],"meta":{"current_page":1,"last_page":1,"total":0}}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      var p = realFetch.apply(this, arguments);
      watchFetch(p, url || String(input || ''));
      return p;
    };
    if (realOpen) {
      XMLHttpRequest.prototype.open = function (method, url) {
        var xhr = this;
        xhr.__kitsuneUrl = String(url);
        xhr.__kitsuneAborted = 0;
        if (!xhr.__kitsuneWatched) {
          xhr.__kitsuneWatched = 1;
          xhr.addEventListener('abort', function () { xhr.__kitsuneAborted = 1; });
          xhr.addEventListener('loadend', function () {
            if (xhr.__kitsuneAborted) return;
            if (xhr.status >= 400 || xhr.status === 0) noteFailure('xhr', xhr.__kitsuneUrl, xhr.status);
          });
        }
        return realOpen.apply(this, arguments);
      };
    }
  }
  // Every resource the page loads (scripts, segments, images); this one patches nothing.
  try {
    new PerformanceObserver(function (list) {
      var entries = list.getEntries();
      for (var i = 0; i < entries.length; i++) {
        var en = entries[i];
        if (typeof en.responseStatus === 'number' && en.responseStatus >= 400) noteFailure(en.initiatorType || 'res', en.name, en.responseStatus);
      }
    }).observe({ type: 'resource', buffered: true });
  } catch (e) {}

  /* 2. Links */
  function onClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var h = host(a.href);
    if (h && !NAV_OK.test(h)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    var path = new URL(a.href, location.href).pathname;
    if (AUTH_PATH.test(path)) { e.preventDefault(); e.stopImmediatePropagation(); post({ type: 'signin' }); return; }
    if (/^\\/series\\//.test(path) || path === '/') { e.preventDefault(); e.stopImmediatePropagation(); post({ type: 'close' }); }
  }
  if (!START.bare) {
    window.addEventListener('click', onClick, true);
    window.addEventListener('auxclick', onClick, true);
  }

  /* 3. Player-only presentation */
  var CSS =
    'html[data-kitsune-po],html[data-kitsune-po] body{background:#000!important;overflow:hidden!important;overscroll-behavior:none!important}' +
    '[data-kitsune-anc]{transform:none!important;filter:none!important;contain:none!important;backdrop-filter:none!important;perspective:none!important;will-change:auto!important}' +
    '[data-kitsune-root]{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:auto!important;height:auto!important;max-width:none!important;max-height:none!important;margin:0!important;border-radius:0!important;z-index:2147483600!important;background:#000!important;aspect-ratio:auto!important}' +
    '[data-kitsune-root] video{width:100%!important;height:100%!important;object-fit:contain!important;transition:transform .25s ease}' +
    '[data-kitsune-root][data-kitsune-fill] video{object-fit:cover!important}' +
    'html[data-kitsune-po]{touch-action:pan-x pan-y!important}[data-kitsune-root]{touch-action:none!important}' +
    '[data-radix-popper-content-wrapper],[data-radix-portal],[role="dialog"],[role="menu"],[role="listbox"]{z-index:2147483647!important}' +
    'iframe:not([src*="challenges.cloudflare.com"]){display:none!important}' +
    '[data-kitsune-verify]{position:fixed!important;left:50%!important;top:50%!important;right:auto!important;bottom:auto!important;margin:0!important;transform:translate(-50%,-50%)!important;z-index:2147483647!important;display:block!important;visibility:visible!important;opacity:1!important;padding:14px!important;border-radius:14px!important;background:#16161a!important;box-shadow:0 0 0 100vmax rgba(0,0,0,.72)!important}' +
    '[data-kitsune-ad]{display:none!important}' +
    '::-webkit-scrollbar{display:none}';
  // On a TV the app draws the controls; the site's would only fight it for the remote.
  if (START.tv) CSS += '[data-kitsune-root] .vjs-control-bar,[data-kitsune-root] .vjs-big-play-button{display:none!important}*{cursor:none!important}';
  var VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
  function addStyle() {
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp && vp.content !== VIEWPORT) vp.content = VIEWPORT;
    if (document.getElementById('kitsune-css')) return;
    var s = document.createElement('style');
    s.id = 'kitsune-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function findRoot(v) {
    var el = v.closest('.videojs-player') || v.closest('.video-js');
    if (el) {
      var outer = el.parentElement && el.parentElement.closest('.videojs-player');
      return outer || el;
    }
    // Unknown markup: climb while the parent hugs the video.
    var vr = v.getBoundingClientRect(), best = v.parentElement || v;
    for (var p = best.parentElement; p && p !== document.body; p = p.parentElement) {
      var r = p.getBoundingClientRect();
      if (Math.abs(r.width - vr.width) > 4 || r.height - vr.height > 120) break;
      best = p;
    }
    return best;
  }

  var root = null;
  function pin(r) {
    if (root && root !== r) {
      root.removeAttribute('data-kitsune-root');
      var olds = document.querySelectorAll('[data-kitsune-anc]');
      for (var i = 0; i < olds.length; i++) olds[i].removeAttribute('data-kitsune-anc');
    }
    root = r;
    document.documentElement.setAttribute('data-kitsune-po', '');
    if (!r.hasAttribute('data-kitsune-root')) r.setAttribute('data-kitsune-root', '');
    for (var p = r.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      if (!p.hasAttribute('data-kitsune-anc')) p.setAttribute('data-kitsune-anc', '');
    }
  }

  /* 4. Playback */
  var hooked = null, lastSent = 0, announced = false, autoplayUntil = 0, played = false;
  function current() {
    var m = location.pathname.match(/\\/watch\\/([^/]+)\\/([^/?#]+)/);
    return m ? { id: m[1], slug: m[2] } : null;
  }
  function episodeNumber() {
    var m = document.title.match(/EP\\s*(\\d+)/i);
    return m ? Number(m[1]) : undefined;
  }
  function report(v, force) {
    var now = Date.now();
    if (!force && now - lastSent < 4000) return;
    var e = current();
    if (START.preload || !e || !v.duration || !isFinite(v.duration)) return;
    lastSent = now;
    post({ type: 'progress', id: e.id, slug: e.slug, number: episodeNumber(), t: v.currentTime, d: v.duration });
  }
  function kick() {
    var v = hooked;
    if (!v || START.preload || played || !v.paused || Date.now() > autoplayUntil) return;
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }
  function ready() {
    if (!announced) { announced = true; post({ type: 'ready' }); }
    kick();
  }
  /* Called by the app when a preloaded episode is revealed. */
  window.__kitsunePlay = function (t) {
    START.preload = false;
    autoplayUntil = Date.now() + 15000;
    var v = hooked;
    if (v && t > 5 && v.duration && t < v.duration - 30 && Math.abs(v.currentTime - t) > 3) {
      try { v.currentTime = t; } catch (x) {}
    }
    kick();
  };
  function hook(v) {
    if (hooked === v) return;
    hooked = v;
    played = false;
    if (!START.preload) autoplayUntil = Date.now() + 15000;
    var seeked = false;
    function seek() {
      var e = current();
      if (seeked || !v.duration) return;
      seeked = true;
      if (START && e && e.id === START.id && START.t > 5 && START.t < v.duration - 30) {
        try { v.currentTime = START.t; } catch (x) {}
      }
    }
    v.addEventListener('loadedmetadata', seek);
    v.addEventListener('canplay', function () { seek(); ready(); });
    v.addEventListener('playing', function () { ready(); setTimeout(function () { played = true; }, 1500); });
    v.addEventListener('timeupdate', function () {
      if (!announced && !v.paused && v.currentTime > 0.3) ready();
      report(v, false);
    });
    v.addEventListener('pause', function () { report(v, true); if (!played) setTimeout(kick, 300); });
    v.addEventListener('ended', function () { report(v, true); post({ type: 'ended' }); });
    function videoFailed() {
      var err = v.error;
      noteFailure('video', v.currentSrc || location.href, err ? err.code : 0, err && err.message ? String(err.message).slice(0, 60) : '');
    }
    v.addEventListener('error', videoFailed);
    // It may have failed before this script found it.
    if (v.error) videoFailed();
    if (v.readyState >= 1) seek();
    if (v.readyState >= 3) ready();
  }

  /* Anything layered over the player that isn't part of the site's own UI is an ad. */
  function hideOverlays() {
    if (!root || !document.body) return;
    for (var c = document.body.firstElementChild; c; c = c.nextElementSibling) {
      if (c.contains(root) || c.hasAttribute('data-kitsune-ad') || c.tagName === 'SCRIPT' || c.tagName === 'STYLE') continue;
      if (c.hasAttribute('data-kitsune-keep') || c.querySelector(CHALLENGE)) continue;
      if (c.matches('[data-radix-portal],[data-radix-popper-content-wrapper],[role="dialog"],[role="menu"],[role="listbox"],[data-sonner-toaster],section[aria-label]')) continue;
      var cs = getComputedStyle(c);
      if ((cs.position === 'fixed' || cs.position === 'absolute') && (+cs.zIndex > 1000 || cs.zIndex === 'auto' && c.offsetWidth > innerWidth * 0.5)) {
        c.setAttribute('data-kitsune-ad', '');
      }
    }
  }

  /* 5. Verification and errors */
  var verifying = false;
  function liftChallenge() {
    var box = null;
    var frames = document.querySelectorAll(CHALLENGE);
    for (var i = 0; i < frames.length; i++) {
      var ad = frames[i].closest('[data-kitsune-ad]');
      if (ad) { ad.removeAttribute('data-kitsune-ad'); ad.setAttribute('data-kitsune-keep', ''); }
      var r = frames[i].getBoundingClientRect();
      if (r.width > 40 && r.height > 40) { box = frames[i].parentElement; break; }
    }
    var lifted = document.querySelectorAll('[data-kitsune-verify]');
    for (var j = 0; j < lifted.length; j++) if (lifted[j] !== box) lifted[j].removeAttribute('data-kitsune-verify');
    if (box && !box.hasAttribute('data-kitsune-verify')) {
      addStyle();
      box.setAttribute('data-kitsune-verify', '');
      for (var p = box.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        if (!p.hasAttribute('data-kitsune-anc')) p.setAttribute('data-kitsune-anc', '');
      }
      // With a remote there's no pointer: put focus in the check so the D-pad and OK reach it.
      var frame = START.tv && box.querySelector(CHALLENGE);
      if (frame) { frame.setAttribute('tabindex', '0'); try { frame.focus(); } catch (x) {} }
    }
    if (!!box !== verifying) { verifying = !!box; post({ type: 'verify', on: verifying }); }
  }

  var AUTH_TEXT = /sign in to continue[^.\\n]*|too many new guest sessions[^.\\n]*/i;
  var FAIL_TEXT = /failed to load stream|playback interrupted|video could not be loaded|verification could not complete|verification cancelled|verification challenge expired|too many connection attempts[^.\\n]*/i;
  var lastProblem = '';
  function checkProblems() {
    if (START.preload || !document.body) return;
    var text = document.body.innerText || '';
    var m = text.match(AUTH_TEXT), kind = 'auth';
    if (!m) { m = text.match(FAIL_TEXT); kind = 'stream'; }
    var found = m ? m[0] : '';
    if (found && found !== lastProblem) {
      var diag = window.__kitsuneFailed();
      post({ type: 'problem', kind: kind, text: found, blocked: window.__kitsuneHeld(), diag: diag });
      // Requests can fail a moment after the message appears: send the fuller list once.
      setTimeout(function () {
        var later = window.__kitsuneFailed();
        if (lastProblem === found && later.length > diag.length) post({ type: 'problem', kind: kind, text: found, blocked: window.__kitsuneHeld(), diag: later });
      }, 1500);
    }
    lastProblem = found;
  }
  if (!START.bare) setInterval(liftChallenge, 700);
  setInterval(checkProblems, 2000);

  /* TV: the app draws the controls from 'tick' and drives playback through __kitsuneCmd. */
  function vjs() {
    var v = hooked, el = v && v.closest ? v.closest('.video-js') : null;
    return (v && v.player) || (el && el.player) || null;
  }
  function items(l) { var out = []; if (l) for (var i = 0; i < l.length; i++) out.push(l[i]); return out; }
  function audioTracks() { var p = vjs(); return items(p && p.audioTracks ? p.audioTracks() : null); }
  function subTracks() {
    var p = vjs();
    return items(p && p.textTracks ? p.textTracks() : hooked && hooked.textTracks).filter(function (t) { return t.kind === 'subtitles' || t.kind === 'captions'; });
  }
  function name(t) { return t ? t.label || t.language || 'On' : null; }
  function sendTick() {
    var v = hooked, e = current();
    if (!START.tv || START.preload || !v) return;
    var a = audioTracks(), s = subTracks();
    var aOn = a.filter(function (t) { return t.enabled; })[0], sOn = s.filter(function (t) { return t.mode === 'showing'; })[0];
    post({
      type: 'tick', id: e && e.id, number: episodeNumber(), t: v.currentTime || 0, d: isFinite(v.duration) ? v.duration : 0,
      paused: v.paused, buffering: !v.paused && v.readyState < 3,
      audio: a.length > 1 ? name(aOn) : null, subs: s.length ? (sOn ? name(sOn) : 'Off') : null,
      fill: !!root && root.hasAttribute('data-kitsune-fill')
    });
  }
  window.__kitsuneCmd = function (cmd, arg) {
    var v = hooked;
    if (!v) return;
    try {
      if (cmd === 'toggle') cmd = v.paused ? 'play' : 'pause';
      if (cmd === 'play') { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
      if (cmd === 'pause') { played = true; autoplayUntil = 0; v.pause(); }
      if ((cmd === 'seek' || cmd === 'seekTo') && v.duration && isFinite(v.duration)) {
        v.currentTime = Math.max(0, Math.min(v.duration - 1, cmd === 'seek' ? v.currentTime + arg : arg));
      }
      if (cmd === 'audio') {
        var a = audioTracks(), ai = a.indexOf(a.filter(function (t) { return t.enabled; })[0]);
        if (a.length > 1) a[(ai + 1) % a.length].enabled = true;
      }
      if (cmd === 'subs') {
        // Off, then each subtitle track in turn, then off again.
        var s = subTracks(), si = s.indexOf(s.filter(function (t) { return t.mode === 'showing'; })[0]);
        for (var k = 0; k < s.length; k++) s[k].mode = 'disabled';
        if (si + 1 < s.length) s[si + 1].mode = 'showing';
      }
      if (cmd === 'fill' && root) {
        if (root.hasAttribute('data-kitsune-fill')) root.removeAttribute('data-kitsune-fill');
        else root.setAttribute('data-kitsune-fill', '');
      }
    } catch (x) {}
    sendTick();
    setTimeout(sendTick, 300);
  };
  if (START.tv) setInterval(sendTick, 1000);

  var queued = false;
  function tick() {
    queued = false;
    var v = document.querySelector('video');
    if (!v) return;
    // Bare: the site's page as it is, only listening to its video.
    if (START.bare) return hook(v);
    addStyle();
    pin(findRoot(v));
    hook(v);
    hideOverlays();
    liftChallenge();
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(tick); } }
  afterMutation = schedule;
  document.addEventListener('DOMContentLoaded', schedule);
  window.addEventListener('load', schedule);
  // Injected late (after load, on a page that has gone quiet), nothing above would fire again.
  schedule();

  /* Episode changes happen client-side; watch the URL rather than wrapping history (the site wraps it too). */
  var lastPath = location.pathname;
  function checkUrl() {
    if (location.pathname === lastPath) return;
    var before = lastPath;
    lastPath = location.pathname;
    if (!/^\\/watch\\//.test(lastPath)) return post({ type: AUTH_PATH.test(lastPath) ? 'signin' : 'close' });
    if (lastPath.split('/')[2] === before.split('/')[2]) return;
    announced = false;
    post({ type: 'loading', number: episodeNumber() });
    // The title can update a beat after the URL; send the number again once it does.
    setTimeout(function () { if (!announced) post({ type: 'loading', number: episodeNumber() }); }, 700);
  }
  setInterval(checkUrl, 300);
  window.addEventListener('popstate', checkUrl);
  // Arrived here by a full page load from another episode (the site's next button does this).
  document.addEventListener('DOMContentLoaded', function () {
    var e = current();
    if (e && START && e.id !== START.id) post({ type: 'loading', number: episodeNumber() });
  });

  document.addEventListener('visibilitychange', function () { if (hooked) report(hooked, true); });

  var pinch = 0;
  function spread(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
  window.addEventListener('touchstart', function (e) { pinch = e.touches.length === 2 ? spread(e.touches) : 0; }, { capture: true, passive: true });
  window.addEventListener('touchmove', function (e) {
    if (!pinch || e.touches.length !== 2 || !root) return;
    var ratio = spread(e.touches) / pinch, fill = root.hasAttribute('data-kitsune-fill');
    if (ratio > 1.18 && !fill) { root.setAttribute('data-kitsune-fill', ''); pinch = 0; post({ type: 'toast', text: 'Zoomed to fill' }); }
    else if (ratio < 0.85 && fill) { root.removeAttribute('data-kitsune-fill'); pinch = 0; post({ type: 'toast', text: 'Original' }); }
  }, { capture: true, passive: true });
  });
})();
true;`;
}

/**
 * Runs on anime.nexus account pages (sign in, settings): same gate and ad guard as the player, and
 * reports whether the visitor is signed in. The site's API answers 401 to signed-out visitors.
 */
export const accountScript = `(function () {
  if (window.__kitsune) return;
  window.__kitsune = 1;
${GATE}
  gate(function () {
  // Match the app: use the site's dark theme unless the visitor picked one on the site.
  try {
    if (!localStorage.getItem('color-scheme')) localStorage.setItem('color-scheme', 'dark');
    if (localStorage.getItem('color-scheme') === 'dark' && document.documentElement) {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    }
  } catch (e) {}
${GUARD}
  var AUTH_PATH = /^\\/(login|register|signup|forgot|reset|restore|activate)/;
  var checked = '', busy = false;
  function ask(url) {
    return fetch(url, { credentials: 'include', headers: { accept: 'application/json' } }).then(function (r) { return r.status; }, function () { return 0; });
  }
  function check() {
    if (busy || location.pathname === checked) return;
    var path = checked = location.pathname;
    if (AUTH_PATH.test(path)) return post({ type: 'auth', signedIn: false, path: path });
    busy = true;
    ask('/api/user/auth/providers').then(function (a) {
      if (a >= 200 && a < 300) return 200;
      return ask('https://api.anime.nexus/api/user/auth/providers').then(function (b) { return b >= 200 && b < 300 ? 200 : Math.max(a, b); });
    }).then(function (status) {
      busy = false;
      if (status === 200) post({ type: 'auth', signedIn: true, path: path });
      else if (status === 401) post({ type: 'auth', signedIn: false, path: path });
    });
  }
  document.addEventListener('DOMContentLoaded', check);
  setInterval(check, 500);
  });
})();
true;`;

/** Reveals a preloaded episode: start (or resume) playback now. */
export const revealScript = (t: number) => `window.__kitsunePlay && window.__kitsunePlay(${Math.floor(t)});true;`;

/** Pauses playback and flushes progress before the player closes. */
export const flushScript = `(function(){var v=document.querySelector('video');if(v){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'progress',id:(location.pathname.match(/\\/watch\\/([^/]+)/)||[])[1],slug:(location.pathname.match(/\\/watch\\/[^/]+\\/([^/?#]+)/)||[])[1],t:v.currentTime,d:v.duration}));}catch(e){}v.pause();}})();true;`;

/** Pauses playback (used while the app asks the user to sign in). */
export const pauseScript = `(function(){var v=document.querySelector('video');if(v)v.pause();})();true;`;

export type TvCommand = 'toggle' | 'play' | 'pause' | 'seek' | 'seekTo' | 'audio' | 'subs' | 'fill';

/** A remote-control command for a player page started with `tv` (seek/seekTo take seconds). */
export const tvCommandScript = (cmd: TvCommand, arg = 0) => `window.__kitsuneCmd&&window.__kitsuneCmd(${JSON.stringify(cmd)},${Number(arg) || 0});true;`;

/** JSON as a JS literal; U+2028/2029 are legal in JSON but end a string literal in older engines. */
const literal = (v: unknown) => JSON.stringify(v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * Signs in through anime.nexus's own login form with what was typed into the app's TV sign-in
 * form (typing into a web page with a remote is miserable). Only ever runs on anime.nexus. Fills
 * the fields the way React-controlled inputs expect, submits, then reports
 * { type: 'login', state: 'submitted' | 'noform' | 'error', text? }. Success itself is reported by
 * accountScript once the site answers as signed in.
 */
export function loginFillScript(email: string, password: string) {
  return `(function () {
  if (!/(^|\\.)anime\\.nexus$/i.test(location.hostname)) return;
  var CRED = ${literal({ email, password })};
  var USER = /mail|user|login|account/i;
  var SUBMIT = /^(sign ?in|log ?in|login|continue|submit)$/i;
  var ERROR = /invalid|incorrect|wrong|match|failed|too many|not found|try again|credentials|blocked|verify/i;
  function post(m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
  function shown(el) { return !!el && el.offsetWidth > 0 && el.offsetHeight > 0 && !el.disabled; }
  function all(scope, sel) { return [].filter.call(scope.querySelectorAll(sel), shown); }
  function text(el) { return (el.innerText || el.value || '').replace(/\\s+/g, ' ').trim(); }
  function userField(scope) {
    var inputs = all(scope, 'input');
    var typed = inputs.filter(function (i) { return i.type === 'email' || /username|email/.test(i.autocomplete || ''); })[0];
    return typed || inputs.filter(function (i) {
      return (i.type === 'text' || !i.type) && USER.test((i.name || '') + ' ' + (i.id || '') + ' ' + (i.placeholder || ''));
    })[0] || inputs.filter(function (i) { return i.type === 'text'; })[0];
  }
  function fill(el, value) {
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }
  function errorText() {
    var list = all(document, '[role=alert],[aria-live],[class*=error],[class*=Error],[class*=destructive],[class*=invalid],[data-sonner-toast]');
    for (var i = 0; i < list.length; i++) {
      var t = text(list[i]);
      if (t && t.length < 220 && ERROR.test(t)) return t;
    }
    return '';
  }
  function submit(form, pass) {
    var scope = form || document;
    var btn = all(scope, 'button[type=submit],input[type=submit]')[0] ||
      all(scope, 'button').filter(function (b) { return SUBMIT.test(text(b)); })[0];
    if (btn) return btn.click();
    if (form && form.requestSubmit) return form.requestSubmit();
    if (form) return form.submit();
    pass.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  }
  function watch(before, path) {
    var until = Date.now() + 12000;
    (function check() {
      if (location.pathname !== path) return;
      var err = errorText();
      if (err && err !== before) return post({ type: 'login', state: 'error', text: err });
      if (Date.now() < until) setTimeout(check, 400);
    })();
  }
  var tries = 0;
  (function attempt() {
    var pass = all(document, 'input[type=password]')[0];
    var user = pass && userField(pass.form || document);
    if (!pass || !user) {
      if (++tries < 48) return setTimeout(attempt, 250);
      return post({ type: 'login', state: 'noform' });
    }
    var before = errorText();
    fill(user, CRED.email);
    fill(pass, CRED.password);
    setTimeout(function () {
      submit(pass.form, pass);
      post({ type: 'login', state: 'submitted' });
      watch(before, location.pathname);
    }, 150);
  })();
})();
true;`;
}
