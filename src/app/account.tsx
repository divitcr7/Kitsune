import { router } from 'expo-router';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { Button, IconButton } from '@/components/Button';
import { FocusBlock } from '@/components/FocusBlock';
import { Icon } from '@/components/Icon';
import { Spinner } from '@/components/Spinner';
import { T } from '@/components/T';
import { haptics, NotificationFeedbackType } from '@/lib/haptics';
import { canOpenBrowser, openInBrowser } from '@/lib/browser';
import { accountScript, loginFillScript } from '@/lib/inject';
import { usePlayer } from '@/lib/player';
import { useStore } from '@/lib/store';
import { EDGE, isTV, tv } from '@/lib/tv';
import { color, radius } from '@/theme/tokens';

// Signed out, the site redirects this to its sign-in form; signed in, it's the account settings
// (where you can also sign out).
const START = 'https://anime.nexus/user/settings';
const ALLOWED = /(^|\.)(anime\.nexus|anime\.delivery|cloudflare\.com)$/i;

/**
 * anime.nexus's own account pages in an ad-free WebView. Cookies are shared with the player, so
 * signing in here signs the player in too.
 */
export default function Account() {
  return isTV ? <TvAccount /> : <PhoneAccount />;
}

function PhoneAccount() {
  const insets = useSafeAreaInsets();
  const web = useRef<WebView<object>>(null);
  const signedIn = useStore((s) => s.signedIn);
  const setSignedIn = useStore((s) => s.setSignedIn);
  const resume = usePlayer((s) => s.resume);
  const [loading, setLoading] = useState(true);
  const [google, setGoogle] = useState(false);
  // Only a switch from signed out to signed in (an actual sign-in) resumes playback by itself.
  const sawSignedOut = useRef(false);
  const inject = () => web.current?.injectJavaScript(accountScript);

  // Leaving without signing in drops the pending episode.
  useEffect(() => () => usePlayer.getState().setResume(null), []);

  function onMessage(e: WebViewMessageEvent) {
    let msg: { type: string; signedIn?: boolean };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type !== 'auth' || typeof msg.signedIn !== 'boolean') return;
    setSignedIn(msg.signedIn);
    if (!msg.signedIn) {
      sawSignedOut.current = true;
      return;
    }
    if (sawSignedOut.current) {
      sawSignedOut.current = false;
      haptics.notify(NotificationFeedbackType.Success);
      if (usePlayer.getState().resume) resumePlayback();
    }
  }

  function allow(req: ShouldStartLoadRequest) {
    if (req.isTopFrame === false) return true;
    try {
      const h = new URL(req.url).hostname;
      if (/(^|\.)google\.com$/i.test(h)) {
        setGoogle(true);
        return false;
      }
      return ALLOWED.test(h) || req.url.startsWith('about:') || req.url.startsWith('blob:');
    } catch {
      return false;
    }
  }

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="close" label="Close" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <T variant="heading" style={{ fontWeight: '700' }}>
            anime.nexus account
          </T>
          <T variant="caption" color={signedIn ? color.accent : color.textFaint} style={{ marginTop: 1 }}>
            {signedIn ? 'Signed in' : signedIn === false ? 'Not signed in' : 'Checking…'}
          </T>
        </View>
        {resume && signedIn ? <Button label="Resume" icon="play" size="sm" onPress={resumePlayback} /> : null}
      </View>

      {signedIn ? null : (
        <View style={styles.hint}>
          <Icon name={google ? 'google' : 'information-outline'} size={18} tint={google ? color.accent : color.textDim} />
          <T variant="caption" dim style={{ flex: 1, lineHeight: 17 }}>
            {google
              ? 'Google doesn’t allow signing in inside apps. Sign in with your email and password instead. Signed up with Google? Add a password on anime.nexus in a browser first.'
              : 'Sign in with your anime.nexus email and password. Your login stays on this phone and is only sent to anime.nexus.'}
          </T>
        </View>
      )}

      <View style={[styles.webWrap, { paddingBottom: insets.bottom }]}>
        <WebView<object>
          ref={web}
          source={{ uri: START }}
          style={styles.web}
          containerStyle={styles.web}
          injectedJavaScriptBeforeContentLoaded={accountScript}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          onMessage={onMessage}
          onLoadStart={inject}
          onLoadProgress={inject}
          onLoadEnd={() => {
            inject();
            setLoading(false);
          }}
          onShouldStartLoadWithRequest={allow}
          onHttpError={async (e) => {
            // anime.nexus turns away its pages inside apps: use its account page in the browser,
            // where episodes play while that lasts.
            if (e.nativeEvent.statusCode >= 400 && (await canOpenBrowser())) {
              router.back();
              openInBrowser(START);
            }
          }}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          domStorageEnabled
          overScrollMode="never"
          webviewDebuggingEnabled={__DEV__}
        />
        {loading ? (
          <View style={[StyleSheet.absoluteFill, styles.loading]}>
            <Spinner size={32} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Resumes the episode that was waiting on a sign-in, if any. */
function resumePlayback() {
  const s = usePlayer.getState().resume;
  usePlayer.getState().setResume(null);
  router.back();
  if (s) setTimeout(() => usePlayer.getState().open(s), 350);
}

type Phase = 'idle' | 'sending' | 'error';

/**
 * Sign-in on a TV. Typing into a web page with a remote is miserable, so this is a native form:
 * what's typed here is filled into anime.nexus's own sign-in form (loaded out of sight below it)
 * and submitted there. The details live only in this screen's state and only ever go to
 * anime.nexus. "Use the web page" shows the site's page itself, e.g. for a verification check.
 */
function TvAccount() {
  const web = useRef<WebView<object>>(null);
  const password = useRef<ComponentRef<typeof TextInput>>(null);
  const signedIn = useStore((s) => s.signedIn);
  const setSignedIn = useStore((s) => s.setSignedIn);
  const resume = usePlayer((s) => s.resume);
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState('');
  const [page, setPage] = useState(false);
  const sawSignedOut = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inject = () => web.current?.injectJavaScript(accountScript);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      usePlayer.getState().setResume(null);
    },
    [],
  );

  // Back from the web page returns to the form rather than leaving.
  useEffect(() => {
    if (!page) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPage(false);
      return true;
    });
    return () => sub.remove();
  }, [page]);

  function fail(text: string) {
    clearTimeout(timer.current);
    setPhase('error');
    setNote(text);
    haptics.notify(NotificationFeedbackType.Error);
  }

  function submit() {
    if (!email.trim() || !secret) return fail('Enter your anime.nexus email and password.');
    setPhase('sending');
    setNote('');
    web.current?.injectJavaScript(loginFillScript(email.trim(), secret));
    clearTimeout(timer.current);
    // Some sign-ins finish without leaving the page: ask the account page directly after a while.
    timer.current = setTimeout(() => {
      web.current?.injectJavaScript(`location.href = ${JSON.stringify(START)};true;`);
      timer.current = setTimeout(() => fail('That didn’t go through. Check your details, or use the web page.'), 8000);
    }, 6000);
  }

  function onMessage(e: WebViewMessageEvent) {
    let msg: { type: string; signedIn?: boolean; state?: string; text?: string };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'login') {
      if (msg.state === 'error') fail(`anime.nexus says: “${msg.text}”`);
      if (msg.state === 'noform') fail('The sign-in form didn’t load. Try again, or use the web page.');
      return;
    }
    if (msg.type !== 'auth' || typeof msg.signedIn !== 'boolean') return;
    setSignedIn(msg.signedIn);
    if (!msg.signedIn) {
      sawSignedOut.current = true;
      return;
    }
    clearTimeout(timer.current);
    setPhase('idle');
    setSecret('');
    setPage(false);
    if (sawSignedOut.current) {
      sawSignedOut.current = false;
      haptics.notify(NotificationFeedbackType.Success);
      if (usePlayer.getState().resume) resumePlayback();
    }
  }

  function allow(req: ShouldStartLoadRequest) {
    if (req.isTopFrame === false) return true;
    try {
      return ALLOWED.test(new URL(req.url).hostname) || req.url.startsWith('about:') || req.url.startsWith('blob:');
    } catch {
      return false;
    }
  }

  const sending = phase === 'sending';

  return (
    <View style={styles.fill}>
      <View style={[styles.tvBody, page && styles.hidden]}>
        <T variant="micro" color={color.accent}>
          anime.nexus account
        </T>
        {signedIn ? (
          <>
            <T variant="display" style={{ marginTop: tv(6) }}>
              You’re signed in
            </T>
            <T dim style={styles.tvLead}>
              Kitsune streams as you now, without guest limits.
            </T>
            <View style={styles.tvActions}>
              {resume ? <Button label="Resume watching" icon="play" hasTVPreferredFocus onPress={resumePlayback} /> : null}
              <Button label="Done" icon="check" variant={resume ? 'secondary' : 'primary'} hasTVPreferredFocus={!resume} onPress={() => router.back()} />
              <Button label="Account settings" icon="cog-outline" variant="secondary" onPress={() => setPage(true)} />
            </View>
          </>
        ) : (
          <>
            <T variant="display" style={{ marginTop: tv(6) }}>
              Sign in to keep watching
            </T>
            <T dim style={styles.tvLead}>
              Signing in lifts anime.nexus’s guest limits. Your email and password go only to anime.nexus, and Kitsune doesn’t keep them.
            </T>
            <Field
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => password.current?.focus()}
              editable={!sending}
              hasTVPreferredFocus
            />
            <Field
              ref={password}
              value={secret}
              onChangeText={setSecret}
              placeholder="Password"
              secureTextEntry
              autoComplete="password"
              returnKeyType="go"
              onSubmitEditing={submit}
              editable={!sending}
            />
            <View style={styles.tvActions}>
              <Button label={sending ? 'Signing in…' : 'Sign in'} icon="login" disabled={sending} onPress={submit} />
              <Button label="Use the web page" variant="secondary" onPress={() => setPage(true)} />
            </View>
            {note ? (
              <T variant="caption" color={phase === 'error' ? color.danger : color.textDim} style={styles.tvNote}>
                {note}
              </T>
            ) : null}
            {sending ? (
              <View style={styles.tvSending}>
                <Spinner size={tv(18)} />
                <T variant="caption" dim>
                  Signing in on anime.nexus…
                </T>
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* The site's own page: out of sight under the form, or full screen as "the web page". */}
      <View pointerEvents={page ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, !page && styles.under]}>
        <FocusBlock enabled={page} style={styles.web}>
          <WebView<object>
            ref={web}
            source={{ uri: START }}
            style={styles.web}
            containerStyle={styles.web}
            injectedJavaScriptBeforeContentLoaded={accountScript}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly
            onMessage={onMessage}
            onLoadStart={inject}
            onLoadProgress={inject}
            onLoadEnd={() => {
              inject();
              if (page) web.current?.requestFocus();
            }}
            onShouldStartLoadWithRequest={allow}
            onHttpError={(e) => {
              if (e.nativeEvent.statusCode >= 400) fail('anime.nexus won’t open its sign-in page inside apps right now. Kitsune tries again by itself; nothing to fix on this TV.');
            }}
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically={false}
            thirdPartyCookiesEnabled
            sharedCookiesEnabled
            domStorageEnabled
            overScrollMode="never"
            webviewDebuggingEnabled={__DEV__}
          />
        </FocusBlock>
        {page ? (
          <View pointerEvents="none" style={styles.tvPageHint}>
            <T variant="caption">Back returns to Kitsune’s sign-in</T>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A TV text field: OK opens the system keyboard; the outline shows where the remote is. A text
 * input can't claim the first focus itself, so its wrapper does and hands it straight down (which
 * focuses the field without popping the keyboard up).
 */
function Field({ ref, hasTVPreferredFocus, ...props }: React.ComponentProps<typeof TextInput> & { ref?: React.Ref<ComponentRef<typeof TextInput>> }) {
  const [focused, setFocused] = useState(false);
  return (
    <View hasTVPreferredFocus={hasTVPreferredFocus}>
      <TextInput
        ref={ref}
        {...props}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={color.textFaint}
        selectionColor={color.accent}
        cursorColor={color.accent}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.field, focused && styles.fieldOn]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingRight: 16, height: 60 },
  hint: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: radius.md, backgroundColor: color.container1 },
  webWrap: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  web: { flex: 1, backgroundColor: color.bg },
  loading: { alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg },
  tvBody: { position: 'absolute', top: tv(48), left: EDGE, width: tv(460), zIndex: 1 },
  tvLead: { marginTop: tv(8), lineHeight: tv(22) },
  tvActions: { flexDirection: 'row', flexWrap: 'wrap', gap: tv(10), marginTop: tv(18) },
  tvNote: { marginTop: tv(14), lineHeight: tv(18) },
  tvSending: { flexDirection: 'row', alignItems: 'center', gap: tv(10), marginTop: tv(14) },
  tvPageHint: { position: 'absolute', bottom: tv(18), alignSelf: 'center', paddingHorizontal: tv(16), paddingVertical: tv(8), borderRadius: radius.pill, backgroundColor: 'rgba(28,28,32,0.95)' },
  field: {
    height: tv(44),
    marginTop: tv(14),
    paddingHorizontal: tv(16),
    borderRadius: radius.md,
    borderWidth: tv(2),
    borderColor: 'transparent',
    backgroundColor: color.container2,
    color: color.text,
    fontSize: tv(16),
  },
  fieldOn: { borderColor: color.text, backgroundColor: color.container3 },
  // Kept laid out (the sign-in script needs a real page) but out of sight under the form.
  under: { opacity: 0 },
  hidden: { display: 'none' },
});
