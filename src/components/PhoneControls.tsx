import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { clock } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import type { TvCommand } from '@/lib/inject';
import { color, radius } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import type { Tick } from './PlayerOsd';
import { T } from './T';

const HIDE_AFTER = 3500;

/**
 * The phone player's controls, drawn by the app over the native video: tap to show or hide; play,
 * ±10 s, a seek bar you can drag, next episode, sub/dub, subtitles and the settings panel. Fed by
 * the same ticks as the TV's OSD.
 */
export function PhoneControls({
  title,
  episode,
  feedRef,
  onCommand,
  onJump,
  onExit,
  onSettings,
}: {
  title: string;
  episode: string;
  feedRef: { current: ((t: Tick) => void) | null };
  onCommand: (cmd: TvCommand, arg?: number) => void;
  onJump: (step: 1 | -1) => void;
  onExit: () => void;
  onSettings: () => void;
}) {
  const [tick, setTick] = useState<Tick | null>(null);
  const [shown, setShown] = useState(true);
  // Where the finger is on the bar while dragging (seconds), or null.
  const [scrub, setScrub] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<Tick | null>(null);
  const barWidth = useRef(1);
  const opacity = useSharedValue(1);
  // The bar's gesture handler is made once; it reaches the current callback through this.
  const command = useRef(onCommand);
  useEffect(() => {
    command.current = onCommand;
  }, [onCommand]);

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
  const visible = shown || paused || scrub !== null;
  useEffect(() => {
    opacity.set(withTiming(visible ? 1 : 0, { duration: visible ? 140 : 320 }));
  }, [visible, opacity]);

  useEffect(() => {
    poke();
    return () => clearTimeout(hideTimer.current);
  }, []);

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

  function seekBy(by: number) {
    haptics.selection();
    onCommand('seek', by);
    const t = latest.current;
    if (t?.d) setPending((p) => Math.max(0, Math.min(t.d - 1, (p ?? t.t) + by)));
    poke();
  }

  const toTime = (x: number) => {
    const d = latest.current?.d ?? 0;
    return Math.max(0, Math.min(d, (x / barWidth.current) * d));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        clearTimeout(hideTimer.current);
        setScrub(toTime(e.nativeEvent.locationX));
      },
      onPanResponderMove: (e) => setScrub(toTime(e.nativeEvent.locationX)),
      onPanResponderRelease: (e) => {
        const to = toTime(e.nativeEvent.locationX);
        command.current('seekTo', to);
        setPending(to);
        setScrub(null);
        poke();
      },
      onPanResponderTerminate: () => {
        setScrub(null);
        poke();
      },
    }),
  ).current;

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const d = tick?.d ?? 0;
  const t = scrub ?? pending ?? tick?.t ?? 0;
  const progress = d ? Math.min(1, t / d) : 0;

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={() => (visible && !paused ? setShown(false) : poke())}>
      <Animated.View pointerEvents={visible ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, fade]}>
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.75)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']} locations={[0, 0.3, 0.6, 1]} style={StyleSheet.absoluteFill} />

        <View style={styles.top}>
          <Round icon="arrow-left" label="Close player" onPress={onExit} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <T variant="micro" color={color.accent}>
              {episode}
            </T>
            <T variant="title" numberOfLines={1}>
              {title}
            </T>
          </View>
          {tick?.audio ? <Chip icon="translate" text={tick.audio} onPress={() => (onCommand('audio'), poke())} /> : null}
          {tick?.subs ? <Chip icon="subtitles-outline" text={tick.subs} onPress={() => (onCommand('subs'), poke())} /> : null}
          <Round icon={tick?.fill ? 'fit-to-screen-outline' : 'fullscreen'} label={tick?.fill ? 'Fit screen' : 'Fill screen'} onPress={() => (onCommand('fill'), poke())} />
          <Round icon="cog-outline" label="Settings" onPress={onSettings} />
        </View>

        <View pointerEvents="box-none" style={styles.middle}>
          <Round icon="skip-previous" label="Previous episode" onPress={() => onJump(-1)} />
          <Round icon="rewind-10" label="Back 10 seconds" big onPress={() => seekBy(-10)} />
          <Round
            icon={paused ? 'play' : 'pause'}
            label={paused ? 'Play' : 'Pause'}
            huge
            onPress={() => {
              haptics.selection();
              onCommand('toggle');
              poke();
            }}
          />
          <Round icon="fast-forward-10" label="Forward 10 seconds" big onPress={() => seekBy(10)} />
          <Round icon="skip-next" label="Next episode" onPress={() => onJump(1)} />
        </View>

        <View style={styles.bottom}>
          <T variant="caption" style={styles.time}>
            {clock(t)}
          </T>
          <View
            style={styles.barHit}
            onLayout={(e) => {
              barWidth.current = Math.max(1, e.nativeEvent.layout.width);
            }}
            {...pan.panHandlers}
          >
            <View pointerEvents="none" style={styles.track}>
              <View style={[styles.fill, { width: `${progress * 100}%` }]} />
            </View>
            {d ? <View pointerEvents="none" style={[styles.knob, scrub !== null && styles.knobActive, { left: `${progress * 100}%` }]} /> : null}
          </View>
          <T variant="caption" style={styles.time}>
            {d ? `−${clock(Math.max(0, d - t))}` : ''}
          </T>
        </View>
      </Animated.View>
    </Pressable>
  );
}

function Round({ icon, label, onPress, big, huge }: { icon: IconName; label: string; onPress: () => void; big?: boolean; huge?: boolean }) {
  const size = huge ? 72 : big ? 56 : 44;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress} style={({ pressed }) => [styles.round, { width: size, height: size, borderRadius: size / 2, opacity: pressed ? 0.6 : 1 }, huge && styles.roundHuge]}>
      <Icon name={icon} size={huge ? 40 : big ? 32 : 26} tint={color.text} />
    </Pressable>
  );
}

function Chip({ icon, text, onPress }: { icon: IconName; text: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" hitSlop={6} onPress={onPress} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={16} tint={color.text} />
      <T variant="caption" numberOfLines={1} style={{ maxWidth: 110 }}>
        {text}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 12, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  middle: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 26 },
  bottom: { position: 'absolute', left: 20, right: 20, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  time: { minWidth: 48, textAlign: 'center', fontVariant: ['tabular-nums'] },
  barHit: { flex: 1, height: 32, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: color.accent },
  knob: { position: 'absolute', width: 14, height: 14, marginLeft: -7, borderRadius: 7, backgroundColor: color.text, top: 9 },
  knobActive: { width: 20, height: 20, marginLeft: -10, borderRadius: 10, top: 6 },
  round: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20,20,24,0.55)' },
  roundHuge: { backgroundColor: 'rgba(20,20,24,0.7)' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: radius.pill, backgroundColor: 'rgba(20,20,24,0.7)' },
});
