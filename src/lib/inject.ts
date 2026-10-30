/**
 * Runs inside anime.nexus/watch/* as the page starts loading (before the site injects its ads).
 *
 * 1. Scripts and iframes may only come from the site, its CDNs and Cloudflare. Ad networks
 *    rotate throwaway domains, so this is an allowlist rather than a blocklist.
 * 2. window.open, document.write, alert/confirm/prompt and off-site link clicks do nothing.
 * 3. The site's player is pinned full-screen over the rest of the page; stray overlays are hidden.
 * 4. Playback autoplays (unless preloading), resumes at `start.t`, and progress is posted back.
 * 5. Comment / related-show requests are answered locally so the page spends its time on video.
 */
export function playerScript(start: { id: string; t: number; preload: boolean }) {
  return `(function () {
  if (window.__kitsune) return;
  window.__kitsune = 1;
  var START = ${JSON.stringify(start)};
  var CODE_OK = /(^|\\.)(anime\\.nexus|anime\\.delivery|cdn\\.nexus|challenges\\.cloudflare\\.com)$/i;
  var NAV_OK = /(^|\\.)(anime\\.nexus|anime\\.delivery|cloudflare\\.com)$/i;
  var BLOCK = /(popads|popcash|propeller|onclick|clickadu|hilltopads|adsterra|profitableratecpm|highperformanceformat|revenuecpmgate|smartpopads|pemsrv|doubleclick|googlesyndication|exoclick|exosrv|juicyads|monetag|magsrv|realsrv|tsyndicate|trafficjunky|mgid|taboola|outbrain|galaksion|admaven|richads|rollerads|evadav|cpmgate|ratecpm|popunder|googletagmanager|google-analytics|cloudflareinsights)/i;
  var SKIP = /\\/api\\/anime\\/(auth\\/)?(episode\\/comments?|episode\\/comment\\/replies|details\\/related|recommendations)/;

  function host(u) { try { return new URL(u, location.href).hostname; } catch (e) { return ''; } }
  function codeOk(u) { if (!u) return true; var h = host(u); return !h || CODE_OK.test(h); }
  function bad(u) { var h = host(u); return !!h && BLOCK.test(h); }
  function post(m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }

  /* 1. Only first-party code runs */
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

  var realFetch = window.fetch;
  window.fetch = function (input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (SKIP.test(url)) {
      return Promise.resolve(new Response('{"data":[],"meta":{"current_page":1,"last_page":1,"total":0}}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch.apply(this, arguments);
  };

  /* 2. Popups and dialogs */
  var noop = function () { return null; };
  try { Object.defineProperty(window, 'open', { configurable: true, get: function () { return noop; }, set: function () {} }); }
  catch (e) { window.open = noop; }
  window.alert = function () {};
  window.confirm = function () { return false; };
  window.prompt = function () { return null; };
  function onClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var h = host(a.href);
    if (h && !NAV_OK.test(h)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    var path = new URL(a.href, location.href).pathname;
    if (/^\\/series\\//.test(path) || path === '/') { e.preventDefault(); e.stopImmediatePropagation(); post({ type: 'close' }); }
  }
  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', onClick, true);

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
    '[data-kitsune-ad]{display:none!important}' +
    '::-webkit-scrollbar{display:none}';
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
    if (v.readyState >= 1) seek();
    if (v.readyState >= 3) ready();
  }

  /* Anything layered over the player that isn't part of the site's own UI is an ad. */
  function hideOverlays() {
    if (!root || !document.body) return;
    for (var c = document.body.firstElementChild; c; c = c.nextElementSibling) {
      if (c.contains(root) || c.hasAttribute('data-kitsune-ad') || c.tagName === 'SCRIPT' || c.tagName === 'STYLE') continue;
      if (c.matches('[data-radix-portal],[data-radix-popper-content-wrapper],[role="dialog"],[role="menu"],[role="listbox"],[data-sonner-toaster],section[aria-label]')) continue;
      var cs = getComputedStyle(c);
      if ((cs.position === 'fixed' || cs.position === 'absolute') && (+cs.zIndex > 1000 || cs.zIndex === 'auto' && c.offsetWidth > innerWidth * 0.5)) {
        c.setAttribute('data-kitsune-ad', '');
      }
    }
  }

  var queued = false;
  function tick() {
    queued = false;
    var v = document.querySelector('video');
    if (!v) return;
    addStyle();
    pin(findRoot(v));
    hook(v);
    hideOverlays();
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(tick); } }
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (foreign(n)) n.remove();
        else scrub(n);
      }
    }
    schedule();
  }).observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', schedule);
  window.addEventListener('load', schedule);

  /* Episode changes happen client-side; watch the URL rather than wrapping history (the site wraps it too). */
  var lastPath = location.pathname;
  function checkUrl() {
    if (location.pathname === lastPath) return;
    var before = lastPath;
    lastPath = location.pathname;
    if (!/^\\/watch\\//.test(lastPath)) return post({ type: 'close' });
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
})();
true;`;
}

/** Reveals a preloaded episode: start (or resume) playback now. */
export const revealScript = (t: number) => `window.__kitsunePlay && window.__kitsunePlay(${Math.floor(t)});true;`;

/** Pauses playback and flushes progress before the player closes. */
export const flushScript = `(function(){var v=document.querySelector('video');if(v){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'progress',id:(location.pathname.match(/\\/watch\\/([^/]+)/)||[])[1],slug:(location.pathname.match(/\\/watch\\/[^/]+\\/([^/?#]+)/)||[])[1],t:v.currentTime,d:v.duration}));}catch(e){}v.pause();}})();true;`;
