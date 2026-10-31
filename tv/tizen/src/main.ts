import './polyfills';
import { h, render } from 'preact';
import { finishSignIn, startLogin } from './login';
import { checkSignedIn, format, type Route, UI_PATH } from './nav';
import { startPlayer } from './player';
import { blockSiteScripts, isChallenge, quietDialogs, takeOver, whenParsed } from './shell';
import { AUTH_PATH, startSite } from './site';
import { session, store } from './store';
import { App } from './ui/App';

/*
 * TizenBrew evaluates this module in every new JavaScript context of its window: each page load on
 * anime.nexus, every iframe in it (Cloudflare's check, the site's embeds) and its own launcher page.
 * Kitsune starts once per anime.nexus top-level page and picks a mode from the path:
 *
 *   /robots.txt      Kitsune's own UI on a blank same-origin page (the module's websiteURL)
 *   /watch/…         the site's player with the shared guard, remote control and an OSD
 *   /login, …        the site's sign-in page with Kitsune's TV form on top
 *   /user/…          the site's account pages, driven with the remote
 *   anything else    back to Kitsune's UI (a show page link goes to that show)
 */
(function main() {
  const dev = window.__kitsuneDev;
  if (!dev) {
    if (window.top !== window) return;
    if (!/(^|\.)anime\.nexus$/i.test(location.hostname)) return;
  }
  if (window.__kitsuneTv) return;
  window.__kitsuneTv = true;

  const path = location.pathname;
  const watch = path.match(/^\/watch\/([^/]+)\/([^/?#]+)/);
  if (dev?.mode === 'player' || (!dev && watch)) {
    const ep = dev?.episode ?? { id: watch![1], slug: watch![2] };
    startPlayer(ep);
    return;
  }
  if (dev?.mode === 'login' || (!dev && AUTH_PATH.test(path))) return startLogin();
  if (!dev && /^\/user\//.test(path)) return startSite(startLogin);
  if (dev?.mode === 'ui' || path === UI_PATH) return startUi();
  redirect(path);
})();

/** Any other site page: go to the matching Kitsune screen instead of showing the site's UI. */
function redirect(path: string) {
  // Guard against a loop if robots.txt itself ever redirects back here: then just take this page over.
  const bounce = session.get<{ n: number; at: number }>('bounce');
  const n = bounce && Date.now() - bounce.at < 15_000 ? bounce.n + 1 : 1;
  session.set('bounce', { n, at: Date.now() });
  if (n > 2) return startUi();
  const series = path.match(/^\/series\/([^/]+)/);
  const route: Route = series ? { name: 'show', id: decodeURIComponent(series[1]) } : { name: 'home' };
  if (series) session.set('stack', [{ name: 'home' }, route]);
  location.replace(`${location.origin}${UI_PATH}#${format(route)}`);
}

function startUi() {
  quietDialogs();
  // robots.txt is plain text: nothing of the site's runs there. On an HTML page, keep its scripts off.
  const plain = /^text\/plain/.test(document.contentType || '');
  if (!plain && !window.__kitsuneDev) blockSiteScripts();
  whenParsed(() => {
    if (!plain && !window.__kitsuneDev && isChallenge()) return;
    session.set('bounce', null);
    const root = takeOver();
    render(h(App, {}), root);
    afterLaunch();
  });
}

/** Finish a sign-in that ended in a full page load, and learn the sign-in state on first run. */
function afterLaunch() {
  const pending = session.get<number>('loginPending');
  if (pending) {
    session.set('loginPending', null);
    if (Date.now() - pending < 5 * 60_000) {
      checkSignedIn().then((ok) => ok && finishSignIn());
      return;
    }
  }
  if (store.get().signedIn === null) checkSignedIn();
}
