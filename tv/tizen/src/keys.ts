/**
 * Samsung remote keys (developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html).
 * Arrows, OK and Return arrive without registering; the media keys arrive because TizenBrew registers
 * the module's `keys` before it opens the site. Desktop equivalents keep the dev harness usable.
 */
export type Action =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'ok'
  | 'back'
  | 'playPause'
  | 'play'
  | 'pause'
  | 'stop'
  | 'rewind'
  | 'forward'
  | 'next'
  | 'previous'
  | 'info'
  | 'done';

const CODES: Record<number, Action> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'ok',
  10009: 'back', // Return
  27: 'back', // Escape (desktop)
  8: 'back', // Backspace (desktop, only outside text fields)
  10252: 'playPause',
  32: 'playPause', // Space (desktop, only outside text fields)
  415: 'play',
  19: 'pause',
  413: 'stop',
  412: 'rewind',
  417: 'forward',
  10233: 'next',
  10232: 'previous',
  457: 'info',
  65376: 'done', // IME Done
  65385: 'back', // IME Cancel
};

export function actionOf(e: KeyboardEvent): Action | undefined {
  const a = CODES[e.keyCode];
  const typing = isTyping();
  if (typing && (e.keyCode === 8 || e.keyCode === 32 || e.keyCode === 37 || e.keyCode === 39)) return undefined;
  return a;
}

export function isTyping() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

/**
 * Listens before the page does (capture on window). Returning true from the handler swallows the key
 * so the site's own shortcuts (video.js hotkeys, page scroll) never see it.
 */
export function onKeys(handler: (action: Action, e: KeyboardEvent) => boolean | void) {
  const listener = (e: KeyboardEvent) => {
    const action = actionOf(e);
    if (!action) return;
    if (handler(action, e)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  };
  window.addEventListener('keydown', listener, true);
  return () => window.removeEventListener('keydown', listener, true);
}

/** Leaves the app: back to TizenBrew's list (or the TV's apps if the history is gone). */
export function exitApp() {
  if (history.length > 1) {
    history.back();
    return;
  }
  try {
    window.tizen?.application?.getCurrentApplication().exit();
  } catch {}
}
