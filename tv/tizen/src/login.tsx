import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { accountScript, loginFillScript } from '@/lib/inject';
import { installBridge, type Msg, onMessage, runScript } from './bridge';
import { activate, focus, focusInitial, focused, move } from './focus';
import { type Action, isTyping, onKeys } from './keys';
import { backToUi, watchUrl } from './nav';
import { addStyles, fit, isChallenge, whenParsed } from './shell';
import { driveSite, hint } from './site';
import { session, store } from './store';
import { Btn, Fox, plainText } from './ui/kit';

const TIMEOUT = 15_000;

let handle: ((a: Action) => boolean) | null = null;
let started = false;

/**
 * anime.nexus's sign-in page with Kitsune's own form on top: typing with a remote into a web page is
 * miserable, so the TV's keyboard fills two plain fields and the shared loginFillScript submits the
 * site's real form. The password is never stored; it only goes to anime.nexus.
 */
export function startLogin() {
  if (started) return;
  started = true;
  installBridge();
  runScript(accountScript);
  onKeys((a) => (handle ? handle(a) : a === 'back' ? (backToUi({ name: 'account' }), true) : false));
  whenParsed(() => {
    if (isChallenge()) return;
    addStyles();
    const host = document.createElement('div');
    host.id = 'kitsune-login';
    host.setAttribute('data-kitsune-keep', '');
    host.setAttribute('style', 'position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:2147483646;-webkit-transform-origin:0 0;transform-origin:0 0');
    document.body.appendChild(host);
    fit(host);
    render(<Login />, host);
    // The site may autofocus its own email field, which pops the TV keyboard over Kitsune's form.
    const calm = setInterval(() => {
      const a = document.activeElement as HTMLElement | null;
      if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && !a.closest('#kitsune-login') && !a.hasAttribute('data-kitsune-site')) a.blur();
    }, 200);
    setTimeout(() => clearInterval(calm), 4000);
  });
}

/** Signed in: pick the interrupted episode back up, or return to Kitsune. */
export function finishSignIn() {
  store.setSignedIn(true);
  session.set('loginPending', null);
  const resume = session.get<{ id: string; slug: string }>('resume');
  session.set('resume', null);
  if (window.__kitsuneDev) return console.log('[dev] signed in; resume', resume);
  if (resume) location.replace(watchUrl(resume));
  else backToUi({ name: 'account' });
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [site, setSite] = useState(false);
  const sawSignedOut = useRef(false);
  const timer = useRef(0);
  const stopSite = useRef<(() => void) | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      onMessage((m: Msg) => {
        if (m.type === 'auth' && typeof m.signedIn === 'boolean') {
          if (!m.signedIn) sawSignedOut.current = true;
          else if (sawSignedOut.current) {
            clearTimeout(timer.current);
            finishSignIn();
          } else store.setSignedIn(true);
        }
        if (m.type === 'login') {
          if (m.state === 'noform') fail('Couldn’t find anime.nexus’s sign-in form. Use the site’s form instead.');
          if (m.state === 'error') fail(m.text || 'That didn’t work. Check your email and password.');
        }
      }, true),
    [],
  );

  useEffect(() => {
    if (site) {
      stopSite.current = driveSite();
      hint('Arrows move  ·  OK selects  ·  Back shows Kitsune’s form');
      setTimeout(() => focusInitial(), 300);
    } else {
      stopSite.current?.();
      stopSite.current = null;
      const pill = document.getElementById('kitsune-hint');
      if (pill) pill.parentNode?.removeChild(pill);
      setTimeout(() => focusInitial(), 0);
    }
  }, [site]);

  function fail(text: string) {
    clearTimeout(timer.current);
    setBusy(false);
    setError(text);
  }

  function submit() {
    if (busy) return;
    if (!email.trim() || !password) return setError('Enter your anime.nexus email and password.');
    setError('');
    setBusy(true);
    // If the site answers with a full page load, Kitsune's UI finishes the sign-in (see main.ts).
    session.set('loginPending', Date.now());
    runScript(loginFillScript(email.trim(), password));
    timer.current = window.setTimeout(() => fail('That didn’t go through. Try again, or use the site’s form.'), TIMEOUT);
  }

  handle = (a: Action) => {
    if (site) {
      if (isTyping()) {
        if (a === 'up' || a === 'down') {
          (document.activeElement as HTMLElement).blur();
          move(a);
          return true;
        }
        if (a === 'done' || a === 'back') {
          (document.activeElement as HTMLElement).blur();
          return true;
        }
        return false;
      }
      if (a === 'back') setSite(false);
      else if (a === 'left' || a === 'right' || a === 'up' || a === 'down') move(a);
      else if (a === 'ok') activate();
      else return false;
      return true;
    }
    if (isTyping()) {
      const field = document.activeElement as HTMLInputElement;
      if (a === 'up' || a === 'down') {
        field.blur();
        move(a);
        return true;
      }
      if (a === 'ok' || a === 'done') {
        field.blur();
        // Done on the email field goes on to the password; on the password it signs in.
        if (field === emailRef.current) focus(passRef.current?.parentElement as HTMLElement);
        else if (field === passRef.current) submit();
        return true;
      }
      if (a === 'back') {
        field.blur();
        return true;
      }
      return false;
    }
    if (a === 'back') backToUi({ name: 'account' });
    else if (a === 'left' || a === 'right' || a === 'up' || a === 'down') move(a);
    else if (a === 'ok') activate();
    else return false;
    return true;
  };

  if (site) return null;

  const field = (ref: { current: HTMLInputElement | null }, k: string, type: string, value: string, set: (v: string) => void, placeholder: string, auto?: boolean) => (
    <div className="l-field" data-f="" data-k={k} {...(auto ? { 'data-autofocus': '' } : {})} onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="none"
        {...plainText}
        onInput={(e) => set((e.target as HTMLInputElement).value)}
        onBlur={() => {
          const wrap = ref.current?.parentElement as HTMLElement | null;
          if (wrap && focused() !== wrap && !document.activeElement?.closest('.l-field')) focus(wrap);
        }}
      />
    </div>
  );

  return (
    <div className="k-modal" style={{ background: 'rgba(0,0,0,.92)' }}>
      <div className="k-sheet l-form">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Fox size={56} />
          <div style={{ marginLeft: 18 }}>
            <div className="t-title">Sign in to anime.nexus</div>
            <div className="t-caption k-faint">Kitsune streams as you, with no guest limits</div>
          </div>
        </div>
        {field(emailRef, 'login:email', 'email', email, setEmail, 'Email', true)}
        {field(passRef, 'login:password', 'password', password, setPassword, 'Password')}
        {error ? <div className="l-error">{error}</div> : null}
        <div className="k-btns" style={{ marginTop: 30, justifyContent: 'flex-start' }}>
          <Btn k="login:go" primary icon="login" label={busy ? 'Signing in…' : 'Sign in'} onClick={submit} />
          <Btn k="login:site" small label="Use the site’s form" onClick={() => setSite(true)} />
        </div>
        <div className="l-note">
          Your password is only sent to anime.nexus and is never saved by Kitsune. Signed up with Google? Google doesn’t allow its sign-in on TVs:
          add a password on anime.nexus in a browser first.
        </div>
      </div>
    </div>
  );
}
