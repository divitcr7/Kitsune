import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import { NavigationBar, setVisibilityAsync } from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewHttpErrorEvent } from 'react-native-webview/lib/WebViewTypes';
import { queryClient } from '@/lib/queries';
import { haptics, NotificationFeedbackType } from '@/lib/haptics';
import { flushScript, pauseScript, playerScript, revealScript, tvCommandScript, type TvCommand } from '@/lib/inject';
import { canOpenBrowser, openInBrowser } from '@/lib/browser';
import { findEpisode, watchUrl } from '@/lib/nav';
import { type Session, usePlayer } from '@/lib/player';
import { BLOCKED_FOR, resumePoint, useStore } from '@/lib/store';
import { isTV, tv } from '@/lib/tv';
import { color, radius, spring } from '@/theme/tokens';
import { Button, IconButton } from './Button';
import { FocusBlock } from './FocusBlock';
import { Icon } from './Icon';
import { PlayerOsd, type Tick } from './PlayerOsd';
import { Spinner } from './Spinner';
import { T } from './T';

const ALLOWED = /(^|\.)(anime\.nexus|anime\.delivery|challenges\.cloudflare\.com)$/i;
const READY_TIMEOUT = 15_000;

/** Renders the app's single player above everything; hidden while it preloads. */
export function PlayerHost() {
  const session = usePlayer((s) => s.session);
  const visible = usePlayer((s) => s.visible);
  if (!session) return null;
  return <Player key={session.episodeId} session={session} visible={visible} />;
}

function Player({ session, visible }: { session: Session; visible: boolean }) {
  const web = useRef<WebView<object>>(null);
  const close = usePlayer((s) => s.close);
  const recordProgress = useStore((s) => s.recordProgress);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [episode, setEpisode] = useState({ number: String(session.number), title: session.title });
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [problem, setProblem] = useState<{ kind: 'auth' | 'stream' | 'blocked'; text: string; blocked?: string[] } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [closing, setClosing] = useState(false);
  // What the page should load; a retry swaps in the episode now playing and where it got to.
  const [target, setTarget] = useState({ id: session.episodeId, slug: session.slug, t: session.startAt });
  // The episode on screen right now (the site can move on to the next one by itself).
  const now = useRef({ id: session.episodeId, slug: session.slug, number: session.number });

  const uri = `https://anime.nexus/watch/${target.id}/${target.slug}`;
  const pageUrl = useRef(uri);
  // Built per load: whether it starts as a preload is decided when it's created.
  const script = useMemo(() => playerScript({ id: target.id, t: target.t, preload: !visible, tv: isTV }), [target]); // eslint-disable-line react-hooks/exhaustive-deps
  // Android runs the "before content" script from onPageStarted, which can land before the new
  // document exists and be lost. The script is idempotent, so re-inject at every load milestone.
  const inject = () => web.current?.injectJavaScript(script);

  const show = useSharedValue(visible ? 1 : 0);
  // TV: the OSD reads the page's once-a-second 'tick' straight from here.
  const feedRef = useRef<((t: Tick) => void) | null>(null);
  // Whether the loader's backdrop image has finished decoding (see refused()).
  const thumbLoaded = useRef(!session.thumb);

  // Becoming visible: rotate, go immersive, and start playback if it was preloaded.
  useEffect(() => {
    if (!visible) return;
    show.set(withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
    // A TV is already landscape (and some boxes would honour a portrait lock, sideways).
    if (!isTV) ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    activateKeepAwakeAsync('player');
    web.current?.injectJavaScript(revealScript(session.startAt));
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      exit();
      return true;
    });
    return () => {
      back.remove();
      deactivateKeepAwake('player');
      if (!isTV) {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        setVisibilityAsync('visible');
      }
      queryClient.invalidateQueries({ queryKey: ['episodes', session.showId] });
    };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the page never reports a playable video, show it anyway so a captcha or error is visible.
  useEffect(() => {
    if (ready || !visible) return;
    const id = setTimeout(() => setReady(true), READY_TIMEOUT);
    return () => clearTimeout(id);
  }, [ready, attempt, visible]);

  function exit() {
    // Black out the page first: pausing makes the site flash its own overlays. Rotate back to
    // portrait behind the black, then fade out.
    setClosing(true);
    if (!isTV) ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    requestAnimationFrame(() => web.current?.injectJavaScript(flushScript));
    show.set(withDelay(240, withTiming(0, { duration: 200 }, (done) => done && scheduleOnRN(close))));
  }

  /** Reload the episode on screen, picking up where it got to. */
  function retry() {
    const cur = now.current;
    const t = Math.floor(resumePoint(useStore.getState().progress[cur.id]));
    pageUrl.current = `https://anime.nexus/watch/${cur.id}/${cur.slug}`;
    setProblem(null);
    setFailed(false);
    setVerifying(false);
    setReady(false);
    setTarget({ id: cur.id, slug: cur.slug, t });
    setAttempt((n) => n + 1);
  }

  /**
   * anime.nexus turned the page away (it refuses pages opened inside apps). Remember that, and hand
   * the episode to the phone's browser, where it plays; a TV has no browser, so say what happened.
   */
  async function refused() {
    usePlayer.getState().backOff();
    useStore.getState().setBlockedUntil(Date.now() + BLOCKED_FOR);
    if (!visible) return close();
    const url = watchUrl(now.current);
    if (await canOpenBrowser()) {
      // Don't send the app to the background while the loader's image is still decoding: the
      // image decoder (expo-image's AVIF plugin) can crash if it's torn down mid-frame.
      for (let waited = 0; !thumbLoaded.current && waited < 2500; waited += 100) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 400));
      // Close the player only once the browser is really up (it opens over the app).
      if (await openInBrowser(url)) return exit();
    }
    setProblem({ kind: 'blocked', text: '' });
  }

  /** Next / previous episode from the remote: load it in place, picking up where it was left. */
  async function jump(step: 1 | -1) {
    const cur = now.current;
    const ep = await findEpisode(session.showId, cur.number + step).catch(() => undefined);
    if (!ep) {
      setToast({ text: step > 0 ? 'That’s the latest episode' : 'This is the first episode', key: Date.now() });
      return;
    }
    web.current?.injectJavaScript(flushScript);
    const entry = useStore.getState().history[session.showId];
    if (entry) useStore.getState().recordPlay(entry.show, ep);
    now.current = { id: ep.id, slug: ep.slug, number: ep.number };
    pageUrl.current = `https://anime.nexus/watch/${ep.id}/${ep.slug}`;
    setEpisode({ number: String(ep.number), title: ep.title ?? '' });
    setProblem(null);
    setFailed(false);
    setVerifying(false);
    setReady(false);
    setTarget({ id: ep.id, slug: ep.slug, t: Math.floor(resumePoint(useStore.getState().progress[ep.id])) });
    setAttempt((n) => n + 1);
  }

  const command = (cmd: TvCommand, arg?: number) => web.current?.injectJavaScript(tvCommandScript(cmd, arg));

  /** Close the player and open the anime.nexus account screen; playback resumes after sign-in. */
  function signIn() {
    const cur = now.current;
    usePlayer.getState().setResume({
      ...session,
      episodeId: cur.id,
      slug: cur.slug,
      number: cur.number,
      title: cur.id === session.episodeId ? session.title : '',
      startAt: Math.floor(resumePoint(useStore.getState().progress[cur.id])),
    });
    exit();
    router.push('/account');
  }

  function onMessage(e: WebViewMessageEvent) {
    let msg: { type: string; id?: string; slug?: string; number?: number; t?: number; d?: number; text?: string; kind?: string; on?: boolean; blocked?: string[] } & Partial<Tick>;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      setReady(true);
      // The in-app player works again: stop sending episodes to the browser.
      if (useStore.getState().blockedUntil) useStore.getState().setBlockedUntil(0);
    }
    if (msg.type === 'close') exit();
    if (msg.type === 'loading') {
      setReady(false);
      if (msg.number) setEpisode({ number: String(msg.number), title: '' });
    }
    if (msg.type === 'tick') {
      feedRef.current?.({ t: msg.t ?? 0, d: msg.d ?? 0, paused: !!msg.paused, buffering: !!msg.buffering, audio: msg.audio ?? null, subs: msg.subs ?? null, fill: !!msg.fill });
      return;
    }
    if (msg.type === 'toast' && msg.text) {
      haptics.selection();
      setToast({ text: msg.text, key: Date.now() });
    }
    if (msg.type === 'progress' && msg.id && msg.slug && msg.d && Number.isFinite(msg.d)) {
      recordProgress(session.showId, { id: msg.id, slug: msg.slug, number: msg.number }, msg.t ?? 0, msg.d);
      now.current = { id: msg.id, slug: msg.slug, number: msg.number ?? now.current.number };
      if (msg.id !== session.episodeId && msg.number) setEpisode({ number: String(msg.number), title: '' });
    }
    if (msg.type === 'verify') {
      setVerifying(!!msg.on);
      // TV: hand the remote to the page so it can reach the check (the script focuses it).
      if (isTV && msg.on) setTimeout(() => web.current?.requestFocus(), 50);
    }
    if (msg.type === 'signin') signIn();
    if (msg.type === 'problem' && msg.text) {
      // The site is refusing streams for now; stop preloading so we don't make it worse.
      usePlayer.getState().backOff();
      if (msg.kind === 'auth') web.current?.injectJavaScript(pauseScript);
      haptics.notify(NotificationFeedbackType.Warning);
      setProblem({ kind: msg.kind === 'auth' ? 'auth' : 'stream', text: msg.text, blocked: msg.blocked });
    }
  }

  // Only top-level navigation is fenced in; ad iframes are already stopped inside the page.
  function allow(req: ShouldStartLoadRequest) {
    if (req.isTopFrame === false) return true;
    try {
      return ALLOWED.test(new URL(req.url).hostname) || req.url.startsWith('about:') || req.url.startsWith('blob:');
    } catch {
      return false;
    }
  }

  const layer = useAnimatedStyle(() => ({ opacity: show.value, transform: [{ scale: 1.04 - show.value * 0.04 }] }));

  return (
    <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, styles.root, layer]}>
      {visible ? (
        <>
          <StatusBar hidden />
          <NavigationBar hidden />
        </>
      ) : null}
      <FocusBlock enabled={verifying} style={styles.web}>
        <WebView<object>
          key={attempt}
          ref={web}
          source={{ uri }}
          style={styles.web}
          containerStyle={[styles.web, closing && styles.hidden]}
          injectedJavaScriptBeforeContentLoaded={script}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          onMessage={onMessage}
          onLoadStart={(e) => {
            inject();
            // A full page load to another episode: cover it with the loader until it plays. (The
            // same episode at another address, e.g. a redirect, keeps what we know about it.)
            const url = e.nativeEvent.url;
            if (url !== pageUrl.current && url.includes('/watch/')) {
              pageUrl.current = url;
              const id = url.match(/\/watch\/([^/?#]+)/)?.[1];
              if (id !== now.current.id) {
                setReady(false);
                setEpisode({ number: '', title: '' });
              }
            }
          }}
          onLoadProgress={inject}
          onLoadEnd={inject}
          onShouldStartLoadWithRequest={allow}
          setSupportMultipleWindows
          onOpenWindow={() => {
            /* popups go nowhere */
          }}
          javaScriptCanOpenWindowsAutomatically={false}
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          domStorageEnabled
          setBuiltInZoomControls={false}
          overScrollMode="never"
          androidLayerType="hardware"
          webviewDebuggingEnabled={__DEV__}
          onError={() => setFailed(true)}
          onHttpError={(e: WebViewHttpErrorEvent) => {
            const { statusCode, url } = e.nativeEvent;
            if (statusCode >= 500) setFailed(true);
            else if (statusCode >= 400 && url.includes('/watch/')) refused();
          }}
          onRenderProcessGone={() => {
            setReady(false);
            setAttempt((n) => n + 1);
          }}
        />
      </FocusBlock>
      {visible && (!ready || failed) && !verifying && !problem ? (
        <Loader
          name={session.showName}
          number={episode.number}
          title={episode.title}
          thumb={session.thumb}
          failed={failed}
          onRetry={retry}
          onThumbLoad={() => (thumbLoaded.current = true)}
        />
      ) : null}
      {isTV && visible && ready && !failed && !problem && !verifying && !closing ? (
        <PlayerOsd
          title={session.showName}
          episode={episode.number ? `Episode ${episode.number}` : 'Now playing'}
          feedRef={feedRef}
          onCommand={command}
          onJump={jump}
          onExit={exit}
        />
      ) : null}
      {isTV && visible && verifying && !problem ? (
        <View pointerEvents="none" style={styles.verifyHint}>
          <T variant="label">Use the remote to tick the box  ·  Back to leave</T>
        </View>
      ) : null}
      {visible && problem ? <Problem kind={problem.kind} text={problem.text} blocked={problem.blocked} onRetry={retry} onSignIn={signIn} /> : null}
      {toast && !problem ? <Toast key={toast.key} text={toast.text} onDone={() => setToast(null)} /> : null}
      {closing ? <View style={[StyleSheet.absoluteFill, styles.blackout]} /> : null}
      {/* A TV has a Back key; a focusable button here would only steal the remote. */}
      {!isTV && visible && !closing && (!ready || failed || verifying || problem) ? (
        <View style={styles.back}>
          <IconButton icon="arrow-left" label="Close player" variant="scrim" onPress={exit} />
        </View>
      ) : null}
    </Animated.View>
  );
}

/** Small pill notice: rises from the bottom, holds, then fades away. */
function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withSequence(withSpring(1, spring.snappy), withDelay(1100, withTiming(0, { duration: 220 }, (done) => done && scheduleOnRN(onDone)))));
  }, [t, onDone]);
  const style = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: (1 - t.value) * 24 }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.toastWrap, style]}>
      <View style={styles.toast}>
        <T variant="label">
          {text}
        </T>
      </View>
    </Animated.View>
  );
}

/** The site refused or paused the stream: say why in plain words and offer the way forward. */
function Problem({ kind, text, blocked, onRetry, onSignIn }: { kind: 'auth' | 'stream' | 'blocked'; text: string; blocked?: string[]; onRetry: () => void; onSignIn: () => void }) {
  const auth = kind === 'auth';
  if (kind === 'blocked') {
    return (
      <View style={[StyleSheet.absoluteFill, styles.loader]}>
        <View style={styles.problem}>
          <Icon name="television-off" size={36} tint={color.accent} />
          <T variant="title" style={styles.cardTitle}>
            anime.nexus won’t play inside apps right now
          </T>
          <T dim style={styles.problemBody}>
            anime.nexus is turning away its player when it’s opened inside an app, so Kitsune can’t play it here. On a phone, Kitsune hands episodes to the browser instead; this TV has no browser to hand them to. Kitsune tries its own player again by itself every few hours.
          </T>
          <View style={styles.problemActions}>
            <Button label="Try again" icon="refresh" size="sm" hasTVPreferredFocus onPress={onRetry} />
          </View>
        </View>
      </View>
    );
  }
  return (
    <View style={[StyleSheet.absoluteFill, styles.loader]}>
      <View style={styles.problem}>
        <Icon name={auth ? 'account-lock-outline' : 'alert-circle-outline'} size={36} tint={color.accent} />
        <T variant="title" style={styles.cardTitle}>
          {auth ? 'Sign in to keep watching' : 'This episode won’t start right now'}
        </T>
        <T dim style={styles.problemBody}>
          {auth
            ? 'anime.nexus paused this stream and wants you signed in. Sign in once with your anime.nexus account and Kitsune picks up right where you left off.'
            : 'anime.nexus couldn’t start the stream. That’s usually a short limit on their side, so give it a minute and try again. Signing in to anime.nexus helps too.'}
        </T>
        <View style={styles.problemActions}>
          <Button label={auth ? 'Sign in' : 'Try again'} icon={auth ? 'login' : 'refresh'} size="sm" hasTVPreferredFocus onPress={auth ? onSignIn : onRetry} />
          <Button label={auth ? 'Try again' : 'Sign in'} variant="secondary" size="sm" onPress={auth ? onRetry : onSignIn} />
        </View>
        <T variant="caption" faint numberOfLines={2} style={styles.problemNote}>
          anime.nexus says: “{text}”
        </T>
        {blocked?.length ? (
          <T variant="caption" faint numberOfLines={2} style={{ marginTop: 4, textAlign: 'center' }}>
            Kitsune held back: {blocked.join(', ')}
          </T>
        ) : null}
      </View>
    </View>
  );
}

function Loader({ name, number, title, thumb, failed, onRetry, onThumbLoad }: { name: string; number: string; title: string; thumb?: string; failed: boolean; onRetry: () => void; onThumbLoad?: () => void }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.loader]}>
      {thumb ? (
        <Image source={{ uri: thumb }} blurRadius={18} contentFit="cover" onLoad={onThumbLoad} onError={onThumbLoad} style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} />
      ) : null}
      <LinearGradient colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.94)']} style={StyleSheet.absoluteFill} />
      <View style={styles.card}>
        {failed ? null : <Spinner size={44} />}
        <T variant="micro" color={color.accent} style={{ marginTop: failed ? 0 : 22 }}>
          {failed ? 'Connection hiccup' : number ? `Episode ${number}` : 'Up next'}
        </T>
        <T variant="title" numberOfLines={2} style={styles.cardTitle}>
          {name}
        </T>
        {title && !failed ? (
          <T dim numberOfLines={1} style={{ marginTop: 2 }}>
            {title}
          </T>
        ) : null}
        {failed ? <Button label="Try again" icon="refresh" size="sm" hasTVPreferredFocus onPress={onRetry} style={{ marginTop: 20 }} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#000', zIndex: 100 },
  web: { flex: 1, backgroundColor: '#000' },
  loader: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  card: { width: 360, alignItems: 'center' },
  cardTitle: { marginTop: 6, textAlign: 'center' },
  back: { position: 'absolute', top: 16, left: 16 },
  blackout: { backgroundColor: '#000' },
  hidden: { opacity: 0 },
  problem: { width: 460, maxWidth: '90%', alignItems: 'center' },
  problemBody: { marginTop: 8, textAlign: 'center', lineHeight: 21 },
  problemActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  problemNote: { marginTop: 14, textAlign: 'center' },
  toastWrap: { position: 'absolute', bottom: 24, alignSelf: 'center' },
  verifyHint: { position: 'absolute', bottom: tv(28), alignSelf: 'center', paddingHorizontal: tv(18), paddingVertical: tv(10), borderRadius: radius.pill, backgroundColor: 'rgba(28,28,32,0.95)' },
  toast: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: radius.pill, backgroundColor: 'rgba(28,28,32,0.95)', borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
});

