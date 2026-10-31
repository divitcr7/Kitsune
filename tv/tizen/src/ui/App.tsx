/* eslint-disable react-hooks/immutability -- false positives: the React Compiler lint does not recognise preact/hooks' useRef, so it treats ref writes (even inside effects) as mutating a frozen hook value. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { activate, focus, focusInitial, focused, move, refocus } from '../focus';
import { exitApp, isTyping, onKeys } from '../keys';
import { format, type Route, router, TABS } from '../nav';
import { useStore } from '../store';
import { Account, Library } from './Library';
import { GenreScreen, Schedule, Search } from './Browse';
import { Home } from './Home';
import { ShowScreen } from './Show';
import { Btn, Fox, Icon } from './kit';

function useRoute() {
  const [route, setRoute] = useState(router.top());
  useEffect(() => router.subscribe(() => setRoute(router.top())), []);
  return route;
}

/** Remembers which card each screen had focused, so Back lands where you were. */
const lastFocus: Record<string, string> = {};

export function App() {
  const route = useRoute();
  const key = format(route);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  /** Pressed a key on this screen yet? Until then, a late-arriving preferred target takes focus. */
  const pressed = useRef(false);
  const [navHidden, setNavHidden] = useState(false);
  const leavingRef = useRef(false);
  const beforeLeave = useRef<HTMLElement | null>(null);
  useEffect(() => {
    leavingRef.current = leaving;
  }, [leaving]);

  // Keys: arrows move focus, OK activates, Back walks the stack (and asks before leaving the app).
  useEffect(
    () =>
      onKeys((action) => {
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
          move(action);
          return true;
        }
        if (action === 'ok') {
          activate();
          return true;
        }
        if (action === 'back') {
          const cur = focused();
          const atTab = router.depth() === 1 && router.top().name !== 'account';
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
  useEffect(() => setNavHidden(false), [key]);

  // Screens fill in as data arrives; keep focus valid and land it on the right element when it shows up.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let queued = 0;
    const settle = () => {
      queued = 0;
      // A screen that's on its way out doesn't get a say.
      if (format(router.top()) !== key) return;
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
      if (!cur || !el.contains(cur)) refocus();
    };
    const observer = new MutationObserver(() => {
      if (!queued) queued = window.setTimeout(settle, 0);
    });
    observer.observe(el, { childList: true, subtree: true });
    settle();
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

  const tab = route.name === 'home' || route.name === 'search' || route.name === 'schedule' || route.name === 'library';

  // The nav tucks away while the page is scrolled down; focusing it brings the page back to the top.
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const onFocus = (e: Event) => {
      const target = e.target as HTMLElement;
      // Remember where the user put focus on each screen, so Back lands on the same card. (Focus
      // placed automatically on arrival isn't a choice, so it isn't remembered.)
      const k = target.getAttribute('data-k');
      if (k && pressed.current && !target.closest('[data-layer]')) lastFocus[format(router.top())] = k;
      const page = host.querySelector('[data-page]') as HTMLElement | null;
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
      <Screen key={key} route={route} />
      {tab ? <Nav active={route.name} hidden={navHidden} /> : null}
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
    case 'account':
      return <Account />;
    case 'show':
      return <ShowScreen id={route.id} />;
    case 'genre':
      return <GenreScreen id={route.id} title={route.title} />;
    default:
      return <Home />;
  }
}

/** Top bar: wordmark, the four tabs, and the anime.nexus account at the right. */
function Nav({ active, hidden }: { active: string; hidden: boolean }) {
  const signedIn = useStore((s) => s.signedIn);
  const off = hidden ? { 'data-f-off': '' } : {};
  return (
    <div className={`k-nav${hidden ? ' hidden' : ''}`} data-g="nav">
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
      <div className="k-acct" data-f="" {...off} data-k="nav:account" onClick={() => router.go({ name: 'account' })}>
        <span className={`dot${signedIn ? ' on' : ''}`} />
        <Icon name="accountCircleOutline" size={30} />
        <span style={{ marginLeft: 10 }}>{signedIn ? 'Signed in' : 'Sign in'}</span>
      </div>
    </div>
  );
}
