import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, TVFocusGuideView, useTVEventHandler, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { clock } from '@/lib/format';
import type { TvCommand } from '@/lib/inject';
import { EDGE, tv } from '@/lib/tv';
import { color, radius } from '@/theme/tokens';
import { Button } from './Button';
import { Icon } from './Icon';
import { T } from './T';

/** What the player page reports once a second on a TV (see playerScript's `tv` mode). */
export type Tick = { t: number; d: number; paused: boolean; buffering: boolean; audio: string | null; subs: string | null; fill: boolean };

const HIDE_AFTER = 4000;
// Presses of the same arrow this close together count as one gesture and seek further each time.
const STREAK = 700;
const SCRUB_EVERY = 220;

/**
 * The TV player's controls, drawn by the app over the site's video: a focus sink that keeps the
 * remote off the web page, the remote's keys, and an OSD (title, progress, time) that shows on
 * any key and fades while playing. Down opens a row: next episode, audio, subtitles, fill.
 */
export function PlayerOsd({
  title,
  episode,
  feedRef,
  onCommand,
  onJump,
  onExit,
}: {
  title: string;
  episode: string;
  /** The player hands each 'tick' to this (kept out of React state so the WebView doesn't re-render). */
  feedRef: { current: ((t: Tick) => void) | null };
  onCommand: (cmd: TvCommand, arg?: number) => void;
  onJump: (step: 1 | -1) => void;
  onExit: () => void;
}) {
  const [tick, setTick] = useState<Tick | null>(null);
  const [shown, setShown] = useState(true);
  const [menu, setMenu] = useState(false);
  // Where a seek is headed until the page catches up, so the bar answers the remote at once.
  const [pending, setPending] = useState<number | null>(null);
  const [nudge, setNudge] = useState<{ text: string; icon: 'rewind' | 'fast-forward' | 'play' | 'pause'; key: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const streak = useRef({ dir: 0, at: 0, n: 0, total: 0 });
  const scrub = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const menuClosedAt = useRef(0);
  const latest = useRef<Tick | null>(null);
  const opacity = useSharedValue(1);

  useEffect(() => {
    feedRef.current = (t) => {
      latest.current = t;
      setTick(t);
      setPending((p) => (p !== null && Math.abs(p - t.t) < 3 ? null : p));
    };
    return () => {
      feedRef.current = null;
    };
  }, [feedRef]);

  const paused = !!tick?.paused;
  const visible = shown || menu || paused;
  useEffect(() => {
    opacity.set(withTiming(visible ? 1 : 0, { duration: visible ? 160 : 400 }));
  }, [visible, opacity]);

  // Show the OSD as playback starts, then let it fade.
  useEffect(() => {
    hideTimer.current = setTimeout(() => setShown(false), HIDE_AFTER);
    return () => {
      clearTimeout(hideTimer.current);
      clearInterval(scrub.current);
    };
  }, []);

  // A seek the page never confirmed (e.g. before metadata) shouldn't pin the bar forever.
  useEffect(() => {
    if (pending === null) return;
    const id = setTimeout(() => setPending(null), 2500);
    return () => clearTimeout(id);
  }, [pending]);

  function poke() {
    setShown(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShown(false), HIDE_AFTER);
  }

  function seek(dir: 1 | -1, step?: number) {
    const now = Date.now();
    const s = streak.current;
    const same = s.dir === dir && now - s.at < STREAK;
    s.n = same ? s.n + 1 : 0;
    s.total = same ? s.total : 0;
    s.dir = dir;
    s.at = now;
    // 10 s for the first two presses, 30 s for the next three, then 60 s (same as the Samsung app).
    const by = step ?? (s.n >= 5 ? 60 : s.n >= 2 ? 30 : 10);
    s.total += by;
    onCommand('seek', dir * by);
    const t = latest.current;
    if (t?.d) setPending((p) => Math.max(0, Math.min(t.d - 1, (p ?? t.t) + dir * by)));
    setNudge({ text: `${dir > 0 ? '+' : '−'}${clock(s.total)}`, icon: dir > 0 ? 'fast-forward' : 'rewind', key: now });
    poke();
  }

  function toggle() {
    const wasPaused = latest.current?.paused;
    onCommand('toggle');
    setNudge({ text: '', icon: wasPaused ? 'play' : 'pause', key: Date.now() });
    poke();
  }

  function openMenu() {
    setMenu(true);
    poke();
  }

  function closeMenu() {
    menuClosedAt.current = Date.now();
    setMenu(false);
    poke();
  }

  // Back closes the row first; the player handles Back after that.
  useEffect(() => {
    if (!menu) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeMenu();
      return true;
    });
    return () => sub.remove();
  }, [menu]); // eslint-disable-line react-hooks/exhaustive-deps

  // Android TV sends JS each key as it's released, plus long* events when a key is held down.
  useTVEventHandler((e) => {
    const up = Number(e.eventKeyAction) === 1;
    const type = e.eventType;
    if (/^long(Left|Right|Rewind|FastForward)$/.test(type)) {
      clearInterval(scrub.current);
      if (menu || up) return;
      const dir = /Left|Rewind/.test(type) ? -1 : 1;
      scrub.current = setInterval(() => seek(dir, 15), SCRUB_EVERY);
      return;
    }
    if (!up) return;
    if (menu) {
      // Inside the row the system moves focus and presses buttons; up leaves the row.
      if (type === 'up') closeMenu();
      else poke();
      return;
    }
    switch (type) {
      case 'select':
        // The OK that pressed a button in the row (and closed it) isn't also a play/pause.
        if (Date.now() - menuClosedAt.current > 350) toggle();
        break;
      case 'playPause':
        toggle();
        break;
      case 'play':
      case 'pause':
        onCommand(type);
        poke();
        break;
      case 'left':
      case 'rewind':
        seek(-1);
        break;
      case 'right':
      case 'fastForward':
        seek(1);
        break;
      case 'down':
      case 'menu':
      case 'info':
        openMenu();
        break;
      case 'up':
        poke();
        break;
      case 'next':
        onJump(1);
        break;
      case 'previous':
        onJump(-1);
        break;
      case 'stop':
        onExit();
        break;
    }
  });

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const d = tick?.d ?? 0;
  const t = pending ?? tick?.t ?? 0;
  const progress = d ? Math.min(1, t / d) : 0;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Holds the remote's focus while the row is closed, so the web page never gets it. */}
      {menu ? null : <View focusable hasTVPreferredFocus style={StyleSheet.absoluteFill} />}

      {nudge ? <Nudge key={nudge.key} text={nudge.text} icon={nudge.icon} onDone={() => setNudge(null)} /> : null}

      <Animated.View pointerEvents="box-none" style={[styles.bottom, fade]}>
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)', 'rgba(0,0,0,0.9)']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <T variant="micro" color={color.accent}>
              {episode}
            </T>
            <T variant="title" numberOfLines={1} style={{ marginTop: tv(2) }}>
              {title}
            </T>
          </View>
          <Icon name={paused ? 'pause' : 'play'} size={tv(26)} tint={color.text} />
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
          {d ? <View style={[styles.knob, { left: `${progress * 100}%` }]} /> : null}
        </View>
        <View style={styles.times}>
          <T variant="caption" dim>
            {clock(t)}
          </T>
          <T variant="caption" faint>
            {menu ? 'Up or Back to close' : '◀ ▶ seek   ·   OK pause   ·   ▼ more'}
          </T>
          <T variant="caption" dim>
            {d ? `−${clock(d - t)}` : ''}
          </T>
        </View>
        {menu ? (
          <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.menu}>
            <Button
              label="Next episode"
              icon="skip-next"
              size="sm"
              hasTVPreferredFocus
              onPress={() => {
                closeMenu();
                onJump(1);
              }}
            />
            {tick?.audio ? <Button label={`Audio: ${tick.audio}`} icon="translate" size="sm" variant="secondary" onPress={() => onCommand('audio')} /> : null}
            {tick?.subs ? <Button label={`Subtitles: ${tick.subs}`} icon="subtitles-outline" size="sm" variant="secondary" onPress={() => onCommand('subs')} /> : null}
            <Button label={tick?.fill ? 'Fit screen' : 'Fill screen'} icon={tick?.fill ? 'fit-to-screen-outline' : 'fullscreen'} size="sm" variant="secondary" onPress={() => onCommand('fill')} />
          </TVFocusGuideView>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** Centre-screen acknowledgement of a seek (−0:30) or play/pause. */
function Nudge({ text, icon, onDone }: { text: string; icon: 'rewind' | 'fast-forward' | 'play' | 'pause'; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 700);
    return () => clearTimeout(id);
  }, [onDone]);
  return (
    <Animated.View entering={FadeIn.duration(90)} exiting={FadeOut.duration(220)} pointerEvents="none" style={styles.nudgeWrap}>
      <View style={styles.nudge}>
        <Icon name={icon} size={tv(30)} tint={color.text} />
        {text ? <T variant="title">{text}</T> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: EDGE, paddingTop: tv(80), paddingBottom: tv(30) },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: tv(16) },
  track: { height: tv(4), borderRadius: tv(2), backgroundColor: 'rgba(255,255,255,0.25)', marginTop: tv(14) },
  fill: { height: '100%', borderRadius: tv(2), backgroundColor: color.accent },
  knob: { position: 'absolute', top: -tv(4), width: tv(12), height: tv(12), marginLeft: -tv(6), borderRadius: tv(6), backgroundColor: color.text },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: tv(8) },
  menu: { flexDirection: 'row', gap: tv(10), marginTop: tv(16) },
  nudgeWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  nudge: { flexDirection: 'row', alignItems: 'center', gap: tv(10), paddingHorizontal: tv(22), paddingVertical: tv(14), borderRadius: radius.pill, backgroundColor: 'rgba(20,20,24,0.82)' },
});
