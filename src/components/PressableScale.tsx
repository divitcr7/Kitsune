import { createContext, useContext } from 'react';
import { Pressable, type PressableProps, type StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { haptics } from '@/lib/haptics';
import { isTV, tv } from '@/lib/tv';
import { color, spring } from '@/theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** 0..1 while a TV remote's focus is on the surrounding PressableScale. */
const Focus = createContext<SharedValue<number> | null>(null);

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  haptic?: boolean;
};

/**
 * Pressable that dips slightly under the finger and springs back. On a TV it lifts while it has
 * the remote's focus, and any FocusRing inside it lights up.
 */
export function PressableScale({ scaleTo = 0.96, haptic, onPressIn, onPressOut, onPress, onFocus, onBlur, style, ...rest }: Props) {
  const scale = useSharedValue(1);
  const focus = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Focus.Provider value={focus}>
      <AnimatedPressable
        unstable_pressDelay={40}
        {...rest}
        onPressIn={(e) => {
          scale.set(withSpring(scaleTo, spring.snappy));
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          scale.set(withSpring(focus.get() ? 1.06 : 1, spring.bouncy));
          onPressOut?.(e);
        }}
        onFocus={(e) => {
          focus.set(withTiming(1, { duration: 140 }));
          scale.set(withSpring(1.06, spring.snappy));
          onFocus?.(e);
        }}
        onBlur={(e) => {
          focus.set(withTiming(0, { duration: 180 }));
          scale.set(withSpring(1, spring.smooth));
          onBlur?.(e);
        }}
        onPress={(e) => {
          if (haptic) haptics.selection();
          onPress?.(e);
        }}
        style={[style, animated]}
      />
    </Focus.Provider>
  );
}

/** White outline drawn over artwork while its card has the TV remote's focus. Nothing on phones. */
export function FocusRing({ radius }: { radius: number }) {
  const focus = useContext(Focus);
  const style = useAnimatedStyle(() => ({ opacity: focus ? focus.value : 0 }));
  if (!isTV || !focus) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ring, { borderRadius: radius }, style]} />;
}

const styles = StyleSheet.create({
  ring: { borderWidth: tv(3), borderColor: color.text },
});
