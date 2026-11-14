import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { bridgeScript } from '@/lib/inject';
import {
  attachBridge,
  bridgeBlocked,
  bridgeCheck,
  bridgeLoading,
  bridgeLost,
  bridgeReady,
  bridgeResponse,
  useBridge,
} from '@/lib/miruro/bridge';
import { usePlayer } from '@/lib/player';
import { isTV, tv } from '@/lib/tv';
import { radius } from '@/theme/tokens';
import { FocusBlock } from './FocusBlock';
import { T } from './T';

// A plain-text file on the site: the tab gets miruro.cx's origin without running any of its scripts
// (and so none of its ads). Not an /api/ path: the site's firewall blocks opening those as a page.
const HOME = 'https://www.miruro.cx/robots.txt';
const ALLOWED = /(^|\.)(miruro\.cx|challenges\.cloudflare\.com)$/i;
// Most of Cloudflare's checks pass by themselves within a few seconds; only show one that doesn't.
const GATE_GRACE = 3500;
// A check that keeps coming back after it passes won't let Kitsune through.
const MAX_CHECKS = 4;

/**
 * The app's hidden miruro.cx tab (see lib/miruro/bridge.ts). Mounted once something asks the API
 * for data. Invisible unless Cloudflare's check needs a person while an episode is waiting.
 */
export function MiruroBridge() {
  // 'off' again only after the site couldn't be reached at all; the next request starts afresh.
  const state = useBridge((s) => s.state);
  return state === 'off' ? null : <Tab />;
}

function Tab() {
  const web = useRef<WebView<object>>(null);
  const reload = useBridge((s) => s.reload);
  const state = useBridge((s) => s.state);
  // Only the player waits on the API with someone watching; a check is never shown over browsing.
  const playing = usePlayer((s) => !!s.session);
  const [grace, setGrace] = useState(false);
  const shown = grace && state === 'check' && playing;
  const checks = useRef(0);
  const inject = () => web.current?.injectJavaScript(bridgeScript);

  useEffect(() => {
    attachBridge((js) => web.current?.injectJavaScript(js));
    return () => attachBridge(null);
  }, []);

  // A request found Cloudflare in the way: load the site again so its check can be seen.
  useEffect(() => {
    if (!reload) return;
    checks.current = 0;
    web.current?.reload();
  }, [reload]);

  // Keep a check out of sight for a grace period; most pass on their own.
  useEffect(() => {
    if (state !== 'check' || !playing) return;
    const id = setTimeout(() => setGrace(true), GATE_GRACE);
    return () => {
      clearTimeout(id);
      setGrace(false);
    };
  }, [state, playing]);

  useEffect(() => {
    if (isTV && shown) web.current?.requestFocus();
  }, [shown]);

  function onMessage(e: WebViewMessageEvent) {
    let msg: { type: string; kind?: string; status?: number; text?: string; id?: string; ctype?: string; b64?: string };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'res') return bridgeResponse(msg);
    if (msg.type === 'bridge') {
      checks.current = 0;
      return bridgeReady();
    }
    if (msg.type === 'gate' && msg.kind === 'check') {
      checks.current += 1;
      if (checks.current > MAX_CHECKS) {
        bridgeBlocked();
        return;
      }
      bridgeCheck();
    }
    // 'refused' (an error page instead of the file) still runs the bridge; the API calls
    // themselves report what's wrong, with the site's own words.
  }

  function allow(req: ShouldStartLoadRequest) {
    if (req.isTopFrame === false) return true;
    try {
      return ALLOWED.test(new URL(req.url).hostname) || req.url.startsWith('about:');
    } catch {
      return false;
    }
  }

  return (
    <View pointerEvents={shown ? 'auto' : 'none'} style={shown ? styles.shown : styles.hidden}>
      <FocusBlock enabled={shown} style={styles.fill}>
        <WebView<object>
          ref={web}
          source={{ uri: HOME }}
          style={styles.fill}
          injectedJavaScriptBeforeContentLoaded={bridgeScript}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          onLoadStart={() => {
            bridgeLost();
            bridgeLoading();
            inject();
          }}
          onLoadProgress={inject}
          onLoadEnd={inject}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={allow}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          domStorageEnabled
          overScrollMode="never"
          webviewDebuggingEnabled={__DEV__}
          onRenderProcessGone={() => {
            bridgeLost();
            web.current?.reload();
          }}
        />
      </FocusBlock>
      {shown ? (
        <View pointerEvents="none" style={styles.hint}>
          <T variant="label">{isTV ? 'Use the remote to tick the box  ·  Back to leave' : 'miruro.cx is checking your connection  ·  your episode starts right after'}</T>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Off screen but alive: a WebView that isn't laid out may stop running its page.
  hidden: { position: 'absolute', left: -4, top: -4, width: 2, height: 2, opacity: 0 },
  shown: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, backgroundColor: '#000' },
  fill: { flex: 1, backgroundColor: '#000' },
  hint: { position: 'absolute', bottom: tv(28), alignSelf: 'center', paddingHorizontal: tv(18), paddingVertical: tv(10), borderRadius: radius.pill, backgroundColor: 'rgba(28,28,32,0.95)' },
});
