import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useTabTrigger } from 'expo-router/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, TVFocusGuideView, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useStore } from '@/lib/store';
import { tv, EDGE, TV_NAV } from '@/lib/tv';
import { color, radius, spring } from '@/theme/tokens';
import { Icon } from './Icon';
import { Wordmark } from './Logo';
import { TABS } from './NavBar';
import { useTabBarHidden } from './TabBarContext';
import { T } from './T';

/**
 * The TV's navigation: a quiet bar across the top (Apple TV style) with the wordmark, the four
 * sections and the anime.nexus account. It tucks away while you scroll down a page and comes back
 * as soon as the remote's focus reaches it.
 */
export function TvNav({ onReselect }: { onReselect?: (name: string) => void }) {
  const hidden = useTabBarHidden();
  const { switchTab, getTrigger } = useTabTrigger({ name: 'home' });
  const active = Math.max(0, TABS.findIndex((t) => getTrigger(t.name)?.isFocused));
  const signedIn = useStore((s) => s.signedIn);

  // Back from any section goes Home first (the TV convention); Back on Home leaves the app.
  const current = useRef(active);
  useEffect(() => {
    current.current = active;
  });
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (current.current === 0) return false;
        switchTab('home', {});
        return true;
      });
      return () => sub.remove();
    }, [switchTab]),
  );

  const slide = useAnimatedStyle(() => {
    const h = hidden?.value ?? 0;
    return { opacity: 1 - h, transform: [{ translateY: interpolate(h, [0, 1], [0, -TV_NAV]) }] };
  });
  const reveal = () => hidden?.set(withSpring(0, spring.smooth));

  return (
    <Animated.View style={[styles.bar, slide]}>
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0)']} style={StyleSheet.absoluteFill} />
      <Wordmark size={tv(17)} />
      <TVFocusGuideView autoFocus style={styles.tabs}>
        {TABS.map((tab, i) => (
          <Tab
            key={tab.name}
            label={tab.label}
            active={i === active}
            onFocus={reveal}
            onPress={() => (i === active ? onReselect?.(tab.name) : switchTab(tab.name, {}))}
          />
        ))}
      </TVFocusGuideView>
      <Tab label={signedIn ? 'Signed in' : 'Sign in'} icon={signedIn ? 'account-check' : 'account-circle-outline'} onFocus={reveal} onPress={() => router.push('/account')} />
    </Animated.View>
  );
}

function Tab({ label, icon, active, onPress, onFocus }: { label: string; icon?: 'account-check' | 'account-circle-outline'; active?: boolean; onPress: () => void; onFocus: () => void }) {
  const [focused, setFocused] = useState(false);
  const fg = focused ? color.onPrimary : active ? color.text : color.textDim;
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => setFocused(false)}
      style={[styles.tab, focused && styles.tabOn]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      {icon ? <Icon name={icon} size={tv(18)} tint={fg} /> : null}
      <T variant="label" color={fg} style={{ fontWeight: active || focused ? '700' : '500' }}>
        {label}
      </T>
      {active && !focused ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: TV_NAV + tv(16),
    paddingTop: tv(14),
    paddingHorizontal: EDGE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tv(24),
  },
  tabs: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: tv(6) },
  tab: { flexDirection: 'row', alignItems: 'center', gap: tv(6), height: tv(34), paddingHorizontal: tv(16), borderRadius: radius.pill },
  tabOn: { backgroundColor: color.primary },
  dot: { position: 'absolute', bottom: tv(2), alignSelf: 'center', left: '50%', width: tv(4), height: tv(4), borderRadius: tv(2), backgroundColor: color.accent },
});
