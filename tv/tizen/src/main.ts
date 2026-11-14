import './polyfills';
import { h, render } from 'preact';
import { format, type Route, UI_PATH } from './nav';
import { blockSiteScripts, isChallenge, quietDialogs, takeOver, whenParsed } from './shell';
import { session } from './store';
import { App } from './ui/App';

/*
 * TizenBrew evaluates this module in every new JavaScript context of its window: each page load on
 * miruro.cx, every iframe in it (Cloudflare's check among them) and its own launcher page. Kitsune
 * starts once, in the top-level page:
 *
 *   /robots.txt      Kitsune itself: its screens and player on a blank same-origin page (the
 *                    module's websiteURL). Nothing of the site's runs there.
 *   anything else    back to Kitsune (a show link goes to that show); the site's pages are never shown.
 */
(function main() {
  if (window.top !== window) return;
  if (!/(^|\.)miruro\.cx$/i.test(location.hostname)) return;
  if (window.__kitsuneTv) return;
  window.__kitsuneTv = true;

  if (location.pathname === UI_PATH) return startUi();
  redirect(location.pathname);
})();

/** Any other site page: go to the matching Kitsune screen instead of showing the site. */
function redirect(path: string) {
  // Guard against a loop if robots.txt itself ever redirects back here: then just take this page over.
  const bounce = session.get<{ n: number; at: number }>('bounce');
  const n = bounce && Date.now() - bounce.at < 15_000 ? bounce.n + 1 : 1;
  session.set('bounce', { n, at: Date.now() });
  if (n > 2) return startUi();
  const info = path.match(/^\/(?:info|watch)\/([^/?#]+)/);
  const route: Route = info ? { name: 'show', id: decodeURIComponent(info[1]) } : { name: 'home' };
  if (info) session.set('stack', [{ name: 'home' }, route]);
  location.replace(`${location.origin}${UI_PATH}#${format(route)}`);
}

function startUi() {
  quietDialogs();
  // robots.txt is plain text, so nothing of the site's runs there. Served as HTML (Cloudflare's
  // check, or a redirect loop's last stop), the site's own scripts are kept off.
  const plain = /^text\/plain/.test(document.contentType || '');
  if (!plain) blockSiteScripts();
  whenParsed(() => {
    // Cloudflare's check: leave it to finish; it reloads into robots.txt and Kitsune starts there.
    if (!plain && isChallenge()) return;
    session.set('bounce', null);
    render(h(App, {}), takeOver());
  });
}
