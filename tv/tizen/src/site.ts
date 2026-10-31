import { accountScript } from '@/lib/inject';
import { installBridge, onMessage, runScript } from './bridge';
import { activate, focusInitial, move } from './focus';
import { isTyping, onKeys } from './keys';
import { backToUi } from './nav';
import { addStyles, isChallenge, whenParsed } from './shell';
import { store } from './store';

const CONTROLS =
  'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[tabindex]:not([tabindex="-1"])';

/**
 * Lets the remote drive one of anime.nexus's own pages (account settings, or its sign-in form when
 * the user picks it): the page's controls become focus targets for the same engine as Kitsune's UI.
 */
export function driveSite() {
  const tag = () => {
    const list = document.querySelectorAll(CONTROLS);
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el.closest('#kitsune-player,#kitsune-login')) continue;
      if (!el.hasAttribute('data-f')) {
        el.setAttribute('data-f', '');
        el.setAttribute('data-kitsune-site', '');
      }
    }
  };
  tag();
  const id = setInterval(tag, 600);
  return () => {
    clearInterval(id);
    const list = document.querySelectorAll('[data-kitsune-site]');
    for (let i = 0; i < list.length; i++) {
      list[i].removeAttribute('data-f');
      list[i].removeAttribute('data-kitsune-site');
      list[i].classList.remove('f');
    }
  };
}

/** Arrows, OK and typing on a site page; Back is up to the caller. */
export function siteKey(action: string, back: () => void) {
  if (isTyping()) {
    if (action === 'up' || action === 'down') {
      (document.activeElement as HTMLElement).blur();
      move(action);
      return true;
    }
    if (action === 'done' || action === 'back') {
      (document.activeElement as HTMLElement).blur();
      return true;
    }
    return false;
  }
  if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
    if (!move(action)) window.scrollBy(0, action === 'down' ? 240 : action === 'up' ? -240 : 0);
    return true;
  }
  if (action === 'ok') {
    activate();
    return true;
  }
  if (action === 'back') {
    back();
    return true;
  }
  return false;
}

export const AUTH_PATH = /^\/(login|register|signup|forgot|reset|restore|activate)/;

/** anime.nexus account pages (/user/...): the site's own page behind the shared guard, remote-driven. */
export function startSite(onAuthPage: () => void) {
  installBridge();
  runScript(accountScript);
  onMessage((m) => {
    if (m.type === 'auth' && typeof m.signedIn === 'boolean') store.setSignedIn(m.signedIn);
  });
  let stop: (() => void) | null = null;
  const off = onKeys((a) => siteKey(a, () => backToUi({ name: 'account' })));
  whenParsed(() => {
    if (isChallenge()) return;
    addStyles();
    stop = driveSite();
    setTimeout(() => focusInitial(), 800);
    hint('Arrows move  ·  OK selects  ·  Back returns to Kitsune');
  });
  // Signing out (or a signed-out visit) moves the site to its sign-in form without a page load.
  const watch = setInterval(() => {
    if (!AUTH_PATH.test(location.pathname)) return;
    clearInterval(watch);
    off();
    if (stop) stop();
    const pill = document.getElementById('kitsune-hint');
    if (pill) pill.parentNode?.removeChild(pill);
    onAuthPage();
  }, 500);
}

/** A small pill at the top of a site page saying how to get around. */
export function hint(text: string) {
  let el = document.getElementById('kitsune-hint');
  if (!el) {
    el = document.createElement('div');
    el.id = 'kitsune-hint';
    el.setAttribute('data-kitsune-keep', '');
    el.setAttribute(
      'style',
      'position:fixed;left:50%;top:24px;z-index:2147483646;transform:translateX(-50%);-webkit-transform:translateX(-50%);padding:14px 28px;border-radius:40px;background:rgba(22,22,26,.95);color:#fff;font:600 22px/28px Roboto,Arial,sans-serif;pointer-events:none',
    );
    document.body.appendChild(el);
  }
  el.textContent = text;
}
