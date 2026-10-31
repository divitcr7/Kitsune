/**
 * Remote-control focus for the TV UI.
 *
 * - Anything with `data-f` can take focus; the focused element gets the class `f`.
 * - Arrows pick the nearest candidate in that direction by geometry.
 * - A `data-g` container remembers where focus last was, so coming back into a rail lands on the
 *   same card instead of the nearest one.
 * - While a `data-layer` (a modal, the player's control row) is open, focus stays inside the last one.
 * - Focusing scrolls the closest `data-track` sideways and the closest `data-page` up or down with
 *   transforms (cheap on TV GPUs, no smooth-scroll API needed on old Chromium).
 * - Moving off an edge dispatches a bubbling `kedge` event ({ detail: dir }) so a hero can page.
 */
export type Dir = 'left' | 'right' | 'up' | 'down';

let current: HTMLElement | null = null;
const memory: Record<string, string> = {};

function shown(el: HTMLElement) {
  return el.offsetWidth > 0 && el.offsetHeight > 0 && !el.hasAttribute('data-f-off');
}

function scope(): ParentNode {
  const layers = document.querySelectorAll('[data-layer]');
  return layers.length ? layers[layers.length - 1] : document;
}

export function focusables(): HTMLElement[] {
  return Array.prototype.filter.call(scope().querySelectorAll('[data-f]'), shown) as HTMLElement[];
}

export function focused() {
  return current && document.documentElement.contains(current) ? current : null;
}

function groupOf(el: Element | null): HTMLElement | null {
  return el ? (el.closest('[data-g]') as HTMLElement | null) : null;
}

export function focus(el: HTMLElement | null | undefined) {
  if (!el) return;
  const prev = focused();
  if (prev === el) return reveal(el);
  if (prev) prev.classList.remove('f');
  current = el;
  el.classList.add('f');
  const g = groupOf(el);
  const k = el.getAttribute('data-k');
  if (g && k) memory[g.getAttribute('data-g') as string] = k;
  // Scroll first, so listeners see where the page ended up.
  reveal(el);
  if (prev) prev.dispatchEvent(new CustomEvent('kblur', { bubbles: true }));
  el.dispatchEvent(new CustomEvent('kfocus', { bubbles: true }));
}

/** Focus the screen's preferred element (`data-autofocus`), else the remembered one, else the first. */
export function focusInitial(root: ParentNode = scope()) {
  const list = focusables();
  const auto = root.querySelector('[data-autofocus]') as HTMLElement | null;
  focus((auto && shown(auto) && auto) || list[0]);
}

/** After a re-render: keep focus on the same item if it still exists, otherwise find a sensible one. */
export function refocus() {
  if (focused() && scope().contains(current)) return reveal(current as HTMLElement);
  const k = current?.getAttribute('data-k');
  const same = k ? (scope().querySelector(`[data-k="${k.replace(/"/g, '\\"')}"]`) as HTMLElement | null) : null;
  if (same && shown(same)) focus(same);
  else focusInitial();
}

function overlap(a1: number, a2: number, b1: number, b2: number) {
  return Math.min(a2, b2) - Math.max(a1, b1) > 1;
}

function score(dir: Dir, a: DOMRect, b: DOMRect) {
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;
  let primary: number;
  if (dir === 'right' || dir === 'left') {
    // Sideways stays in the row: no diagonal jumps into the next rail (the end of a row is an edge).
    const ahead = dir === 'right' ? bx > ax + 1 && b.right > a.right - 1 : bx < ax - 1 && b.left < a.left + 1;
    if (!ahead || !overlap(a.top, a.bottom, b.top, b.bottom)) return -1;
    primary = Math.max(0, dir === 'right' ? b.left - a.right : a.left - b.right);
    return primary + Math.abs(by - ay) * 0.5;
  }
  const ahead = dir === 'down' ? by > ay + 1 && b.bottom > a.bottom - 1 : by < ay - 1 && b.top < a.top + 1;
  if (!ahead) return -1;
  primary = Math.max(0, dir === 'down' ? b.top - a.bottom : a.top - b.bottom);
  const lateral = overlap(a.left, a.right, b.left, b.right) ? 0 : Math.min(Math.abs(b.left - a.right), Math.abs(a.left - b.right));
  return primary + lateral * 2 + Math.abs(bx - ax) * 0.05;
}

/** Moves focus; returns false when there's nothing that way (an edge). */
export function move(dir: Dir): boolean {
  const from = focused();
  const list = focusables();
  if (!from || !scope().contains(from)) {
    focusInitial();
    return true;
  }
  const a = from.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === from) continue;
    const s = score(dir, a, el.getBoundingClientRect());
    if (s >= 0 && s < bestScore) {
      bestScore = s;
      best = el;
    }
  }
  if (!best) {
    from.dispatchEvent(new CustomEvent('kedge', { bubbles: true, detail: dir }));
    return false;
  }
  // Coming into a rail from above or below lands where you left it.
  const g = groupOf(best);
  if (g && g !== groupOf(from) && (dir === 'up' || dir === 'down')) {
    const k = memory[g.getAttribute('data-g') as string];
    const kept = k ? (g.querySelector(`[data-k="${k.replace(/"/g, '\\"')}"]`) as HTMLElement | null) : null;
    if (kept && shown(kept)) best = kept;
  }
  focus(best);
  return true;
}

/** OK on the focused element: open the on-screen keyboard for fields, click everything else. */
export function activate() {
  const el = focused();
  if (!el) return;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') el.focus();
  else el.click();
}

function offsetWithin(el: HTMLElement, ancestor: HTMLElement, axis: 'left' | 'top') {
  let n = 0;
  for (let e: HTMLElement | null = el; e && e !== ancestor; e = e.offsetParent as HTMLElement | null) {
    n += axis === 'left' ? e.offsetLeft : e.offsetTop;
    if (!e.offsetParent) break;
  }
  return n;
}

const shift = (el: HTMLElement, x: number, y: number) => {
  el.style.transform = `translate3d(${-Math.round(x)}px,${-Math.round(y)}px,0)`;
};

/** Scrolls rails and pages so `el` is in view. */
export function reveal(el: HTMLElement) {
  // A site page driven with the remote scrolls natively.
  if (el.hasAttribute('data-kitsune-site')) {
    const e = el as HTMLElement & { scrollIntoViewIfNeeded?: (center?: boolean) => void };
    if (e.scrollIntoViewIfNeeded) e.scrollIntoViewIfNeeded(true);
    else el.scrollIntoView(false);
    return;
  }
  const track = el.closest('[data-track]') as HTMLElement | null;
  if (track && track.parentElement) {
    const view = track.parentElement.clientWidth;
    const pad = parseFloat(getComputedStyle(track).paddingLeft) || 0;
    const last = track.lastElementChild as HTMLElement | null;
    const end = last ? last.offsetLeft + last.offsetWidth + pad : 0;
    const left = offsetWithin(el, track, 'left');
    const x = Math.max(0, Math.min(left - pad, end - view));
    shift(track, x, 0);
  }
  const page = el.closest('[data-page]') as HTMLElement | null;
  if (page && page.parentElement) {
    const view = page.parentElement.clientHeight;
    const row = (el.closest('[data-row]') as HTMLElement | null) || el;
    const top = offsetWithin(row, page, 'top');
    const height = row.offsetHeight;
    const lead = Number(page.getAttribute('data-page')) || 0;
    // Keep the first screen still; further down, bring the focused row up to just under the nav.
    let y = top + height <= view - 60 ? 0 : top - lead;
    y = Math.max(0, Math.min(y, page.offsetHeight - view));
    shift(page, 0, y);
    page.setAttribute('data-y', String(Math.round(y)));
  }
}

/** Forget remembered positions (a new screen). */
export function resetMemory() {
  for (const k of Object.keys(memory)) delete memory[k];
}
