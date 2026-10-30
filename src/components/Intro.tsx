import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { color } from '@/theme/tokens';
import { Fox } from './Logo';

const SIZE = 92;

/**
 * Picks up from the native splash (same fox, same spot): a thin accent ring
 * widens out, the fox settles, then zooms through into the app.
 */
export function Intro({ ready }: { ready: boolean }) {
  const [done, setDone] = useState(false);
  const tilt = useSharedValue(0);
  const ring = useSharedValue(0);
  const out = useSharedValue(0);

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hide();
    tilt.set(withSequence(withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }), withTiming(0, { duration: 260, easing: Easing.inOut(Easing.cubic) })));
    ring.set(withDelay(200, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) })));
    out.set(
      withDelay(
        520,
        withTiming(1, { duration: 420, easing: Easing.bezier(0.7, 0, 0.2, 1) }, (finished) => {
          if (finished) scheduleOnRN(setDone, true);
        }),
      ),
    );
  }, [ready, tilt, ring, out]);

  const veil = useAnimatedStyle(() => ({ opacity: 1 - Math.max(0, (out.value - 0.3) / 0.7) }));
  const fox = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(0, (out.value - 0.5) / 0.5),
    transform: [{ scale: (1 + tilt.value * 0.04) * (1 + out.value * out.value * 12) }],
  }));
  const bloom = useAnimatedStyle(() => ({ opacity: (1 - ring.value) * 0.9, transform: [{ scale: 0.6 + ring.value * 2.6 }] }));

  if (done) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.veil, veil]}>
      <Animated.View style={[styles.ring, bloom]} />
      <Animated.View style={fox}>
        <Fox size={SIZE} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  veil: { backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: SIZE * 1.4, height: SIZE * 1.4, borderRadius: SIZE, borderWidth: 1.5, borderColor: color.accent },
});
