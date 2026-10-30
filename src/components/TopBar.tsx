import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolate, type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color } from '@/theme/tokens';
import { T } from './T';

export const TOP_BAR = 64;

/**
 * M3 top app bar: transparent at rest, fills with a tonal surface once content
 * scrolls under it (between `from` and `to`), when the optional title also fades in.
 */
export function TopBar({
  scrollY,
  title,
  left,
  right,
  from = 0,
  to = 48,
}: {
  scrollY: SharedValue<number>;
  title?: string;
  left?: ReactNode;
  right?: ReactNode;
  from?: number;
  to?: number;
}) {
  const insets = useSafeAreaInsets();
  const surface = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [from, to], [0, 1], 'clamp') }));
  const label = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [to - 12, to + 16], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(scrollY.value, [to - 12, to + 16], [6, 0], 'clamp') }],
  }));
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { height: insets.top + TOP_BAR }]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.surface, surface]} />
      <View pointerEvents="box-none" style={[styles.row, { marginTop: insets.top }]}>
        {left}
        <Animated.View pointerEvents="none" style={[styles.title, label]}>
          {title ? (
            <T variant="title" numberOfLines={1} style={{ fontSize: 17 }}>
              {title}
            </T>
          ) : null}
        </Animated.View>
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  surface: { backgroundColor: 'rgba(0,0,0,0.94)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  row: { height: TOP_BAR, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 },
  title: { flex: 1, paddingHorizontal: 8 },
});
