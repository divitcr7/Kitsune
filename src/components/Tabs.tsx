import { type ComponentRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, TVFocusGuideView, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { haptics } from '@/lib/haptics';
import { isTV, tv } from '@/lib/tv';
import { color } from '@/theme/tokens';
import { T } from './T';

const INDICATOR = 28;
// On a TV, moving into the tabs lands on the chosen one.
const Row = isTV ? TVFocusGuideView : View;

/**
 * M3 primary tabs with a rounded indicator that tracks `position` (in tab units,
 * e.g. pager offset / page width) continuously while swiping. On a TV a tab is chosen as soon as
 * the remote's focus lands on it.
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
  const [focused, setFocused] = useState(-1);
  const [chosen, setChosen] = useState<ComponentRef<typeof View> | null>(null);
  const slot = width / items.length;
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: position.value * slot + (slot - INDICATOR) / 2 }] }));

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <Row destinations={chosen ? [chosen] : undefined} style={styles.row}>
        {items.map((it, i) => (
          <Pressable
            key={it.key}
            ref={i === index ? setChosen : undefined}
            android_ripple={isTV ? undefined : { color: 'rgba(255,255,255,0.12)' }}
            style={[styles.tab, focused === i && styles.tabFocus]}
            onFocus={() => {
              setFocused(i);
              if (isTV && i !== index) onChange(i);
            }}
            onBlur={() => setFocused((f) => (f === i ? -1 : f))}
            onPress={() => {
              if (i !== index) haptics.selection();
              onChange(i);
            }}
          >
            <T variant="label" color={isTV && focused === i ? color.onPrimary : i === index ? color.text : color.textFaint} style={{ fontWeight: i === index ? '700' : '500' }}>
              {it.label}
            </T>
            {it.dot ? <View style={styles.dot} /> : null}
          </Pressable>
        ))}
      </Row>
      {width ? <Animated.View style={[styles.indicator, indicator]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  row: { flexDirection: 'row' },
  tab: { flex: 1, height: isTV ? tv(40) : 48, alignItems: 'center', justifyContent: 'center', borderRadius: isTV ? tv(20) : 0 },
  tabFocus: isTV ? { backgroundColor: color.primary } : {},
  dot: { position: 'absolute', top: 10, right: '24%', width: 5, height: 5, borderRadius: 3, backgroundColor: color.accent },
  indicator: { position: 'absolute', bottom: 0, width: INDICATOR, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: color.accent },
});
