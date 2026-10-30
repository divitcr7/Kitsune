import * as Haptics from 'expo-haptics';
import { useTabTrigger } from 'expo-router/ui';
import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, TAB_BAR_HEIGHT } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { useTabBarHidden } from './TabBarContext';
import { T } from './T';

const TABS: { name: string; label: string; on: IconName; off: IconName }[] = [
  { name: 'home', label: 'Home', on: 'home', off: 'home-outline' },
  { name: 'discover', label: 'Search', on: 'magnify', off: 'magnify' },
  { name: 'schedule', label: 'Schedule', on: 'calendar-blank', off: 'calendar-blank-outline' },
  { name: 'library', label: 'My Stuff', on: 'bookmark', off: 'bookmark-outline' },
];

/** Quiet black tab bar: white when active, grey otherwise, a small accent dot under the active tab. */
export function NavBar({ onReselect }: { onReselect?: (name: string) => void }) {
  const insets = useSafeAreaInsets();
  const hidden = useTabBarHidden();
  const { switchTab, getTrigger } = useTabTrigger({ name: 'home' });
  const active = Math.max(0, TABS.findIndex((t) => getTrigger(t.name)?.isFocused));

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(hidden?.value ?? 0, [0, 1], [0, TAB_BAR_HEIGHT + insets.bottom]) }],
  }));

  return (
    <Animated.View style={[styles.bar, { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }, slide]}>
      {TABS.map((tab, i) => (
        <Item
          key={tab.name}
          tab={tab}
          focused={i === active}
          onPress={() => {
            if (i === active) return onReselect?.(tab.name);
            Haptics.selectionAsync();
            switchTab(tab.name, {});
          }}
        />
      ))}
    </Animated.View>
  );
}

function Item({ tab, focused, onPress }: { tab: (typeof TABS)[number]; focused: boolean; onPress: () => void }) {
  const on = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(focused ? 1 : 0, { duration: 200 }));
  }, [focused, on]);
  const dot = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scale: on.value }] }));

  return (
    <Pressable onPress={onPress} style={styles.item} accessibilityRole="tab" accessibilityState={{ selected: focused }}>
      <Icon name={focused ? tab.on : tab.off} size={24} tint={focused ? color.text : color.textFaint} />
      <T variant="caption" color={focused ? color.text : color.textFaint} style={{ marginTop: 3, fontSize: 11, fontWeight: focused ? '700' : '500' }}>
        {tab.label}
      </T>
      <Animated.View style={[styles.dot, dot]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: color.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 4 },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 4, backgroundColor: color.accent },
});
