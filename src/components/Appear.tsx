import { type ReactNode, useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { spring } from '@/theme/tokens';

/**
 * Rises and fades in once on mount, staggered by `index`. Animates transform and
 * opacity only, so it never fights layout the way entering layout-animations can
 * inside scroll views.
 */
export function Appear({ index = 0, distance = 18, children, style }: { index?: number; distance?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(Math.min(index, 10) * 36, withSpring(1, spring.smooth));
  }, [index, t]);
  const animated = useAnimatedStyle(() => ({
    opacity: Math.min(1, t.value * 1.3),
    transform: [{ translateY: (1 - t.value) * distance }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
