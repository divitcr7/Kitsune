import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { color } from '@/theme/tokens';
import { T } from './T';

const INDICATOR = 28;

/**
 * M3 primary tabs with a rounded indicator that tracks `position` (in tab units,
 * e.g. pager offset / page width) continuously while swiping.
 */
export function Tabs({
  items,
  index,
  onChange,
  position,
}: {
  items: { key: string; label: string; dot?: boolean }[];
  index: number;
  onChange: (i: number) => void;
  position: SharedValue<number>;
}) {
  const [width, setWidth] = useState(0);
  const slot = width / items.length;
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: position.value * slot + (slot - INDICATOR) / 2 }] }));

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.row}>
        {items.map((it, i) => (
          <Pressable
            key={it.key}
            android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
            style={styles.tab}
            onPress={() => {
              if (i !== index) Haptics.selectionAsync();
              onChange(i);
            }}
          >
            <T variant="label" color={i === index ? color.text : color.textFaint} style={{ fontWeight: i === index ? '700' : '500' }}>
              {it.label}
            </T>
            {it.dot ? <View style={styles.dot} /> : null}
          </Pressable>
        ))}
      </View>
      {width ? <Animated.View style={[styles.indicator, indicator]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  row: { flexDirection: 'row' },
  tab: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 10, right: '24%', width: 5, height: 5, borderRadius: 3, backgroundColor: color.accent },
  indicator: { position: 'absolute', bottom: 0, width: INDICATOR, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: color.accent },
});
