/* eslint-disable react-hooks/immutability -- false positives: the React Compiler lint does not recognise preact/hooks' useRef, so it treats ref writes (even inside effects) as mutating a frozen hook value. */
import { Component } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { activate, focus, focusInitial, focused, move, refocus, usable } from '../focus';
import { exitApp, isTyping, onKeys, paced } from '../keys';
import { format, isTab, player, type Route, router, type Tab, TABS } from '../nav';
import { Player, playerKey } from '../player';
import { loadHls } from '../engine';
import { Library } from './Library';
import { GenreScreen, Schedule, Search } from './Browse';
import { Home } from './Home';
import { ShowScreen } from './Show';
import { Btn, Fox } from './kit';
import { Shown, ShownContext } from './showing';

declare const KITSUNE_VERSION: string;
declare const KITSUNE_NOTES: string;

/** The version this TV last ran, so a new one can say what changed (TizenBrew updates modules by itself). */
function newVersion() {
  try {
    const seen = localStorage.getItem('kitsune:version');
    localStorage.setItem('kitsune:version', KITSUNE_VERSION);
    return seen && seen !== KITSUNE_VERSION ? KITSUNE_VERSION : null;
  } catch {
    return null;
  }
}

function usePlaying() {
  const [playing, setPlaying] = useState(player.get());
  useEffect(() => player.subscribe(() => setPlaying(player.get())), []);
  return playing;
}

type Screens = { stack: readonly Route[]; tabs: Tab[] };

/**
 * Screens stay mounted: every screen in the back stack, and each tab once it's been opened. Back and
 * switching tabs show them exactly as they were left (scroll, focus, loaded rows) instead of
 * building them again.
 */
function useScreens(): Screens {
  const read = (tabs: Tab[]): Screens => {
    const stack = router.stack();
    const first = stack[0];
    const opened = stack.length === 1 && isTab(first) && tabs.indexOf(first.name) < 0 ? first.name : null;
    return { stack, tabs: opened ? tabs.concat(opened) : tabs };
  };
  const [screens, setScreens] = useState(() => read([]));
  useEffect(() => router.subscribe(() => setScreens((s) => read(s.tabs))), []);
  return screens;
}

/** A mounted screen redraws from its own state; App's re-renders (a screen opening over it, the nav hiding) pass it by. */
class Frozen extends Component<{ route: Route }> {
  shouldComponentUpdate() {
    return false;
  }
  render() {
    return <Screen route={this.props.route} />;
  }
}

/** One mounted screen. Out of view it keeps its layout (visibility, not display), so coming back is a repaint, not a rebuild. */
function Slot({ route, top, showing }: { route: Route; top: boolean; showing: boolean }) {
  const [shown] = useState(() => new Shown(showing));
  useEffect(() => shown.set(showing), [shown, showing]);
  return (
    <div className={`k-slot${top ? '' : ' k-off'}`} data-zone={top ? '' : undefined}>
      <ShownContext.Provider value={shown}>
        <Frozen route={route} />
      </ShownContext.Provider>
    </div>
  );
}

/** The screen on show, and the page in it that scrolls. */
const activeSlot = (host: HTMLElement) => host.querySelector('.k-slot[data-zone]') as HTMLElement | null;
const activePage = (host: HTMLElement) => host.querySelector('.k-slot[data-zone] [data-page]') as HTMLElement | null;

/** Remembers which card each screen had focused, so Back lands where you were. */
const lastFocus: Record<string, string> = {};

export function App() {
  const { stack, tabs } = useScreens();
  const route = stack[stack.length - 1];
  const playing = usePlaying();
  const key = format(route);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  /** Pressed a key on this screen yet? Until then, a late-arriving preferred target takes focus. */
  const pressed = useRef(false);
  const [navHidden, setNavHidden] = useState(false);
  const [updated, setUpdated] = useState<string | null>(() => newVersion());
  const leavingRef = useRef(false);
  useEffect(() => {
    if (!updated) return;
    const id = setTimeout(() => setUpdated(null), 7000);
    return () => clearTimeout(id);
  }, [updated]);
  const beforeLeave = useRef<HTMLElement | null>(null);
  useEffect(() => {
    leavingRef.current = leaving;
  }, [leaving]);

  // Keys: arrows move focus, OK activates, Back walks the stack (and asks before leaving the app).
  useEffect(
    () =>
      onKeys((action, e) => {
        if (player.get()) return playerKey(action);
        pressed.current = true;
        if (isTyping()) {
          if (action === 'up' || action === 'down') {
            (document.activeElement as HTMLElement).blur();
            move(action);
            return true;
          }
          if (action === 'ok' || action === 'done' || action === 'back') {
            (document.activeElement as HTMLElement).blur();
            return true;
          }
          return false;
        }
        if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
          if (paced(e)) move(action);
          return true;
        }
        if (action === 'ok') {
          activate();
          return true;
        }
        if (action === 'back') {
          const cur = focused();
          const atTab = router.depth() === 1;
          if (leavingRef.current) setLeaving(false);
          // On a tab, Back goes up to the nav first (like tvOS), then asks before leaving.
          else if (atTab && !(cur && cur.closest('.k-nav'))) focus(document.querySelector('.k-nav .k-tab.on') as HTMLElement | null);
          else if (!router.back()) {
            beforeLeave.current = focused();
            setLeaving(true);
          }
          return true;
        }
        return false;
      }),
    [],
  );

  // A new screen starts fresh: set synchronously with the route change, before anything re-renders.
  useEffect(
    () =>
      router.subscribe(() => {
        pressed.current = false;
      }),
    [],
  );
  // Screens fill in as data arrives; keep focus valid and land it on the right element when it shows up.
  // A layout effect, so a screen coming back is never drawn without its focus.
  useLayoutEffect(() => {
    const host = root.current;
    if (!host) return;
    let queued = 0;
    const settle = () => {
      queued = 0;
      // A screen on its way out, or under the player, doesn't get a say.
      if (player.get() || format(router.top()) !== key) return;
      const el = activeSlot(host);
      if (!el) return;
      const fresh = !pressed.current;
      const want = lastFocus[key];
      if (fresh && want) {
        const target = el.querySelector(`[data-k="${want.replace(/"/g, '\\"')}"]`) as HTMLElement | null;
        if (target) {
          if (focused() !== target) focus(target);
          return;
        }
      }
      const cur = focused();
      const auto = el.querySelector('[data-autofocus]') as HTMLElement | null;
      // Until a key is pressed, a preferred target that just appeared beats wherever focus fell back to.
      if (fresh && auto && cur !== auto && !want) return focus(auto);
      if (!usable(cur)) refocus();
    };
    const observer = new MutationObserver(() => {
      if (!queued) queued = window.setTimeout(settle, 0);
    });
    observer.observe(host, { childList: true, subtree: true });
    settle();
    // A screen kept from before may be scrolled down, where the nav stays tucked away.
    const cur = focused();
    setNavHidden(!(cur && cur.closest('.k-nav')) && Number(activePage(host)?.getAttribute('data-y')) > 0);
    return () => {
      observer.disconnect();
      if (queued) clearTimeout(queued);
    };
  }, [key]);

  useEffect(() => {
    if (leaving) return void setTimeout(() => focusInitial(), 0);
    const back = beforeLeave.current;
    beforeLeave.current = null;
    if (back && document.documentElement.contains(back)) focus(back);
    else refocus();
  }, [leaving]);

  // hls.js loads while the person browses, so Play doesn't wait for it.
  useEffect(() => {
    loadHls();
  }, []);

  // Back from the player: focus returns to the card it started from, on the screen as it was.
  const wasPlaying = useRef(!!playing);
  const beforePlay = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (playing && !wasPlaying.current) beforePlay.current = focused();
    if (!playing && wasPlaying.current) {
      const back = beforePlay.current;
      beforePlay.current = null;
      if (back && usable(back)) focus(back);
      else refocus();
    }
    wasPlaying.current = !!playing;
  }, [playing]);

  // While the TV's keyboard is up, the nav steps aside and the search page lifts above the keyboard.
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const field = (e: Event) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    };
    const onIn = (e: Event) => field(e) && host.classList.add('k-typing');
    const onOut = (e: Event) => field(e) && host.classList.remove('k-typing');
    host.addEventListener('focusin', onIn);
    host.addEventListener('focusout', onOut);
    return () => {
      host.removeEventListener('focusin', onIn);
      host.removeEventListener('focusout', onOut);
    };
  }, []);

  const tab = stack.length === 1 && isTab(route);
  const onTab = tab ? route.name : null;
  const slots: { key: string; route: Route; on: boolean }[] = tabs.map((t) => ({ key: `tab:${t}`, route: { name: t }, on: t === onTab }));
  stack.forEach((r, i) => {
    if (i > 0 || !isTab(r)) slots.push({ key: `${i}:${format(r)}`, route: r, on: i === stack.length - 1 });
  });

  // The nav tucks away while the page is scrolled down; focusing it brings the page back to the top.
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const onFocus = (e: Event) => {
      const target = e.target as HTMLElement;
      // Remember where the user put focus on each screen, so Back lands on the same card. (Focus
      // placed automatically on arrival isn't a choice, and the nav isn't part of the screen.)
      const k = target.getAttribute('data-k');
      if (k && pressed.current && !target.closest('[data-layer]') && !target.closest('.k-nav')) lastFocus[format(router.top())] = k;
      const page = activePage(host);
      if (target.closest('.k-nav')) {
        if (page) {
          page.style.transform = 'translate3d(0,0,0)';
          page.setAttribute('data-y', '0');
        }
        setNavHidden(false);
      } else setNavHidden(Number(page?.getAttribute('data-y')) > 0);
    };
    host.addEventListener('kfocus', onFocus);
    return () => host.removeEventListener('kfocus', onFocus);
  }, []);

  return (
    <div ref={root} style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080 }}>
      <div className={`k-screens${playing ? ' k-off' : ''}`}>
        {slots.map((s) => (
          <Slot key={s.key} route={s.route} top={s.on} showing={s.on && !playing} />
        ))}
        {tab ? <Nav active={route.name} hidden={navHidden} /> : null}
      </div>
      {playing ? <Player key={playing.episode.id} playing={playing} /> : null}
      {updated ? (
        <div className="k-updated">
          <Fox size={34} />
          <div>
            <div className="t-label">Kitsune updated to {updated}</div>
            {KITSUNE_NOTES ? <div className="t-caption k-dim">{KITSUNE_NOTES}</div> : null}
          </div>
        </div>
      ) : null}
      {leaving ? (
        <div className="k-modal" data-layer="">
          <div className="k-sheet">
            <Fox size={72} />
            <div className="t-title" style={{ marginTop: 18 }}>
              Leave Kitsune?
            </div>
            <div className="k-btns">
              <Btn k="exit:stay" autofocus primary label="Stay" onClick={() => setLeaving(false)} />
              <Btn k="exit:leave" label="Leave" onClick={exitApp} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'search':
      return <Search />;
    case 'schedule':
      return <Schedule />;
    case 'library':
      return <Library />;
    case 'show':
      return <ShowScreen id={route.id} />;
    case 'genre':
      return <GenreScreen id={route.id} title={route.title} />;
    default:
      return <Home />;
  }
}

/** Top bar: wordmark and the four tabs. */
function Nav({ active, hidden }: { active: string; hidden: boolean }) {
  const off = hidden ? { 'data-f-off': '' } : {};
  return (
    <div className={`k-nav${hidden ? ' hidden' : ''}`} data-g="nav" data-zone="">
      <div className="k-brand">
        <Fox size={50} />
        <span className="k-word">kitsune</span>
      </div>
      <div className="k-tabs">
        {TABS.map((t) => (
          <div
            key={t.name}
            className={`k-tab${t.name === active ? ' on' : ''}`}
            data-f=""
            {...off}
            data-k={`nav:${t.name}`}
            onClick={() => (t.name === active ? null : router.tab(t.name))}
          >
            {t.label}
          </div>
        ))}
      </div>
    </div>
  );
}
