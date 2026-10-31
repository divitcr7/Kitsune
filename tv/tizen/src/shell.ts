import css from './styles.css';

/**
 * Cloudflare's "checking your browser" page. Kitsune steps aside and lets it finish; the page reloads
 * itself afterwards and Kitsune starts on the real page.
 */
export function isChallenge() {
  return (
    /just a moment|attention required|checking your browser|verify you are human/i.test(document.title) ||
    !!document.querySelector('#challenge-form,#challenge-running,#challenge-stage,.cf-turnstile,script[src*="/cdn-cgi/challenge-platform/"]')
  );
}

export function whenParsed(fn: () => void) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}

/**
 * On an HTML page (anything but the plain robots.txt document), stop the site's own scripts from
 * running while Kitsune takes over. Cloudflare's challenge scripts stay allowed. Parser-inserted
 * scripts are neutered as they arrive; scripts created later can't set a foreign src.
 */
export function blockSiteScripts() {
  const allowed = (src: string) => !src || /\/cdn-cgi\/|challenges\.cloudflare\.com/.test(src);
  const neuter = (n: Node) => {
    if (n.nodeType !== 1) return;
    const el = n as HTMLElement;
    const scripts = el.tagName === 'SCRIPT' ? [el as HTMLScriptElement] : Array.prototype.slice.call(el.querySelectorAll ? el.querySelectorAll('script[src]') : []);
    for (const s of scripts as HTMLScriptElement[]) {
      if (!allowed(s.getAttribute('src') || '')) {
        s.type = 'javascript/blocked';
        s.parentNode?.removeChild(s);
      }
    }
  };
  const observer = new MutationObserver((muts) => {
    for (const m of muts) for (let i = 0; i < m.addedNodes.length; i++) neuter(m.addedNodes[i]);
  });
  observer.observe(document.documentElement || document, { childList: true, subtree: true });
  neuter(document.documentElement);
  const d = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  if (d && d.set) {
    const set = d.set;
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
      configurable: true,
      get: d.get,
      set(this: HTMLScriptElement, v: string) {
        if (allowed(String(v))) set.call(this, v);
      },
    });
  }
  return () => observer.disconnect();
}

/** Keeps no-op dialogs and popups out of the way (same as the shared guard does on site pages). */
export function quietDialogs() {
  const noop = () => null;
  try {
    Object.defineProperty(window, 'open', { configurable: true, get: () => noop, set: () => {} });
  } catch {
    window.open = noop;
  }
  window.alert = () => {};
  window.confirm = () => false;
}

/** Fits a 1920x1080 canvas to whatever size the TV's browser window really is. */
export function fit(el: HTMLElement) {
  const apply = () => {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) || 1;
    const t = Math.abs(s - 1) < 0.005 ? '' : `scale(${s})`;
    el.style.transform = t;
    (el.style as unknown as Record<string, string>).webkitTransform = t;
  };
  apply();
  window.addEventListener('resize', apply);
}

let styled = false;
export function addStyles() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'kitsune-tv-css';
  s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
}

/** Replaces whatever the page shows with an empty canvas for Kitsune's own UI. */
export function takeOver(): HTMLElement {
  const html = document.documentElement;
  while (html.firstChild) html.removeChild(html.firstChild);
  for (const a of Array.prototype.slice.call(html.attributes) as Attr[]) html.removeAttribute(a.name);
  html.setAttribute('lang', 'en');
  html.className = 'k-ui';
  const head = document.createElement('head');
  const body = document.createElement('body');
  html.appendChild(head);
  html.appendChild(body);
  const meta = document.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  head.appendChild(meta);
  document.title = 'Kitsune';
  styled = false;
  addStyles();
  const root = document.createElement('div');
  root.id = 'kitsune';
  body.appendChild(root);
  fit(root);
  return root;
}
