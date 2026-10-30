import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { Button, IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Spinner } from '@/components/Spinner';
import { T } from '@/components/T';
import { accountScript } from '@/lib/inject';
import { usePlayer } from '@/lib/player';
import { useStore } from '@/lib/store';
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

  function resumePlayback() {
    const s = usePlayer.getState().resume;
    usePlayer.getState().setResume(null);
    router.back();
    if (s) setTimeout(() => usePlayer.getState().open(s), 350);
  }

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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingRight: 16, height: 60 },
  hint: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: radius.md, backgroundColor: color.container1 },
  webWrap: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  web: { flex: 1, backgroundColor: color.bg },
  loading: { alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg },
});
