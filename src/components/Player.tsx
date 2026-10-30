import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import { NavigationBar, setVisibilityAsync } from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
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
import { flushScript, playerScript, revealScript } from '@/lib/inject';
import { type Session, usePlayer } from '@/lib/player';
import { useStore } from '@/lib/store';
import { color, radius, spring } from '@/theme/tokens';
import { Button, IconButton } from './Button';
import { Spinner } from './Spinner';
import { T } from './T';

const ALLOWED = /(^|\.)(anime\.nexus|anime\.delivery|challenges\.cloudflare\.com|accounts\.google\.com|discord\.com)$/i;
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

  const uri = `https://anime.nexus/watch/${session.episodeId}/${session.slug}`;
  const pageUrl = useRef(uri);
  // Built once per episode: whether it starts as a preload is decided at mount.
  const script = useMemo(() => playerScript({ id: session.episodeId, t: session.startAt, preload: !visible }), [session.episodeId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Android runs the "before content" script from onPageStarted, which can land before the new
  // document exists and be lost. The script is idempotent, so re-inject at every load milestone.
  const inject = () => web.current?.injectJavaScript(script);

  const show = useSharedValue(visible ? 1 : 0);

  // Becoming visible: rotate, go immersive, and start playback if it was preloaded.
  useEffect(() => {
    if (!visible) return;
    show.set(withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    activateKeepAwakeAsync('player');
    web.current?.injectJavaScript(revealScript(session.startAt));
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      exit();
      return true;
    });
    return () => {
      back.remove();
      deactivateKeepAwake('player');
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      setVisibilityAsync('visible');
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
    web.current?.injectJavaScript(flushScript);
    show.set(withTiming(0, { duration: 200 }, (done) => done && scheduleOnRN(close)));
  }

  function onMessage(e: WebViewMessageEvent) {
    let msg: { type: string; id?: string; slug?: string; number?: number; t?: number; d?: number; text?: string };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'ready') setReady(true);
    if (msg.type === 'close') exit();
    if (msg.type === 'loading') {
      setReady(false);
      if (msg.number) setEpisode({ number: String(msg.number), title: '' });
    }
    if (msg.type === 'toast' && msg.text) {
      Haptics.selectionAsync();
      setToast({ text: msg.text, key: Date.now() });
    }
    if (msg.type === 'progress' && msg.id && msg.slug && msg.d && Number.isFinite(msg.d)) {
      recordProgress(session.showId, { id: msg.id, slug: msg.slug, number: msg.number }, msg.t ?? 0, msg.d);
      if (msg.id !== session.episodeId && msg.number) setEpisode({ number: String(msg.number), title: '' });
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
      <WebView<object>
        key={attempt}
        ref={web}
        source={{ uri }}
        style={styles.web}
        containerStyle={styles.web}
        injectedJavaScriptBeforeContentLoaded={script}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        onMessage={onMessage}
        onLoadStart={(e) => {
          inject();
          // A full page load to another episode: cover it with the loader until it plays.
          const url = e.nativeEvent.url;
          if (url !== pageUrl.current && url.includes('/watch/')) {
            pageUrl.current = url;
            setReady(false);
            setEpisode({ number: '', title: '' });
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
          if (e.nativeEvent.statusCode >= 500) setFailed(true);
        }}
        onRenderProcessGone={() => {
          setReady(false);
          setAttempt((n) => n + 1);
        }}
      />
      {visible && (!ready || failed) ? (
        <Loader
          name={session.showName}
          number={episode.number}
          title={episode.title}
          thumb={session.thumb}
          failed={failed}
          onRetry={() => {
            setFailed(false);
            setReady(false);
            setAttempt((n) => n + 1);
          }}
        />
      ) : null}
      {toast ? <Toast key={toast.key} text={toast.text} onDone={() => setToast(null)} /> : null}
      {visible && (!ready || failed) ? (
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

function Loader({ name, number, title, thumb, failed, onRetry }: { name: string; number: string; title: string; thumb?: string; failed: boolean; onRetry: () => void }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.loader]}>
      {thumb ? <Image source={{ uri: thumb }} blurRadius={18} contentFit="cover" style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} /> : null}
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
        {failed ? <Button label="Try again" icon="refresh" size="sm" onPress={onRetry} style={{ marginTop: 20 }} /> : null}
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
  toastWrap: { position: 'absolute', bottom: 24, alignSelf: 'center' },
  toast: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: radius.pill, backgroundColor: 'rgba(28,28,32,0.95)', borderWidth: StyleSheet.hairlineWidth, borderColor: color.line },
});

