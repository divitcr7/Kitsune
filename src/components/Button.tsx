import { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { haptics } from '@/lib/haptics';
import { isTV, tv } from '@/lib/tv';
import { color, radius, spring } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { sized, T } from './T';

/**
 * Press feedback used everywhere: a quick dim and a hair of scale, no bounce. On a TV, also the
 * remote's focus: the focused control lifts a little and turns white, like Apple TV.
 */
function usePress() {
  const p = useSharedValue(0);
  const f = useSharedValue(0);
  const [focused, setFocused] = useState(false);
  const style = useAnimatedStyle(() => ({ opacity: 1 - p.value * 0.25, transform: [{ scale: (1 - p.value * 0.035) * (1 + f.value * 0.06) }] }));
  return {
    style,
    focused,
    in: () => p.set(withTiming(1, { duration: 90 })),
    out: () => p.set(withTiming(0, { duration: 180 })),
    focus: () => {
      setFocused(true);
      f.set(withSpring(1, spring.snappy));
    },
    blur: () => {
      setFocused(false);
      f.set(withSpring(0, spring.smooth));
    },
  };
}

type PressHandlers = {
  hasTVPreferredFocus?: boolean;
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  onFocus?: () => void;
  onBlur?: () => void;
};

export function Button({
  label,
  sub,
  icon,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  style,
  onFocus,
  onBlur,
  ...focus
}: {
  label: string;
  sub?: string;
  icon?: IconName;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'accent' | 'text';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  style?: ViewStyle;
} & PressHandlers) {
  const press = usePress();
  const h = isTV ? tv(size === 'lg' ? 44 : size === 'sm' ? 34 : 40) : size === 'lg' ? 52 : size === 'sm' ? 38 : 46;
  // TV: every button sits translucent until it has focus, then it's the white one.
  const on = isTV && press.focused;
  const look = isTV && variant !== 'text' ? (on ? 'primary' : variant === 'accent' ? 'accent' : 'secondary') : variant;
  const bg = look === 'primary' ? color.primary : look === 'secondary' ? color.ghost : look === 'accent' ? color.accent : on ? color.ghost : 'transparent';
  const fg = look === 'primary' ? color.onPrimary : look === 'text' ? color.accent : color.text;
  return (
    <Animated.View style={[{ opacity: disabled ? 0.4 : 1 }, press.style, style]}>
      <Pressable
        {...focus}
        disabled={disabled}
        onPressIn={press.in}
        onPressOut={press.out}
        onFocus={() => {
          press.focus();
          onFocus?.();
        }}
        onBlur={() => {
          press.blur();
          onBlur?.();
        }}
        onPress={() => {
          haptics.selection();
          onPress?.();
        }}
        style={[styles.button, { height: h, backgroundColor: bg, paddingHorizontal: variant === 'text' ? (isTV ? tv(10) : 4) : size === 'sm' ? 16 : 22 }]}
      >
        {icon ? <Icon name={icon} size={sized(size === 'lg' ? 24 : 20)} tint={fg} /> : null}
        <T variant={size === 'lg' ? 'heading' : 'label'} color={fg} style={{ fontWeight: '700', fontSize: sized(size === 'lg' ? 16 : 14) }}>
          {label}
        </T>
        {sub ? (
          <T variant="caption" color={fg} style={{ opacity: 0.6 }}>
            {sub}
          </T>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/** Round icon button: `plain`, `scrim` (dark disc over artwork) or `ghost` (light translucent disc). */
export function IconButton({
  icon,
  onPress,
  variant = 'plain',
  size = 44,
  tint = color.text,
  label,
  style,
  onFocus,
  onBlur,
  ...focus
}: {
  icon: IconName;
  onPress?: () => void;
  variant?: 'plain' | 'scrim' | 'ghost';
  size?: number;
  tint?: string;
  label: string;
  style?: ViewStyle;
} & PressHandlers) {
  const press = usePress();
  const on = isTV && press.focused;
  const bg = on ? color.primary : variant === 'scrim' ? color.scrim : variant === 'ghost' ? color.ghost : 'transparent';
  return (
    <Animated.View style={[press.style, style]}>
      <Pressable
        {...focus}
        accessibilityLabel={label}
        hitSlop={6}
        onPressIn={press.in}
        onPressOut={press.out}
        onFocus={() => {
          press.focus();
          onFocus?.();
        }}
        onBlur={() => {
          press.blur();
          onBlur?.();
        }}
        onPress={() => {
          haptics.selection();
          onPress?.();
        }}
        style={[styles.icon, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}
      >
        <Icon name={icon} size={Math.round(size * 0.52)} tint={on ? color.onPrimary : tint} />
      </Pressable>
    </Animated.View>
  );
}

/** Streaming-app action: icon over a small label ("My List", "Share"). */
export function Action({ icon, label, onPress, active }: { icon: IconName; label: string; onPress?: () => void; active?: boolean }) {
  const press = usePress();
  const on = isTV && press.focused;
  return (
    <Animated.View style={press.style}>
      <Pressable
        onPressIn={press.in}
        onPressOut={press.out}
        onFocus={press.focus}
        onBlur={press.blur}
        onPress={() => {
          haptics.selection();
          onPress?.();
        }}
        style={[styles.action, on && styles.actionOn]}
        accessibilityLabel={label}
      >
        <Icon name={icon} size={sized(26)} tint={on ? color.onPrimary : active ? color.accent : color.text} />
        <T variant="caption" dim={!on} color={on ? color.onPrimary : undefined} style={{ marginTop: 6 }}>
          {label}
        </T>
      </Pressable>
    </Animated.View>
  );
}

/** Minimal pill; `selected` turns it white. On a TV the focused one gets an outline. */
export function Chip({ label, selected, onPress, onFocus }: { label: string; selected?: boolean; onPress?: () => void; onFocus?: () => void }) {
  const press = usePress();
  return (
    <Animated.View style={press.style}>
      <Pressable
        onPressIn={press.in}
        onPressOut={press.out}
        onFocus={() => {
          press.focus();
          onFocus?.();
        }}
        onBlur={press.blur}
        onPress={onPress}
        style={[styles.chip, selected && styles.chipOn, isTV && press.focused && styles.chipFocus]}
      >
        <T variant="label" color={selected ? color.onPrimary : color.text} style={{ fontSize: sized(13) }}>
          {label}
        </T>
      </Pressable>
    </Animated.View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.md },
  icon: { alignItems: 'center', justifyContent: 'center' },
  action: { alignItems: 'center', minWidth: 72, paddingVertical: 4, paddingHorizontal: isTV ? tv(10) : 0, borderRadius: radius.md },
  actionOn: { backgroundColor: color.primary },
  chip: { height: isTV ? tv(30) : 34, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.container2 },
  chipOn: { backgroundColor: color.primary },
  chipFocus: { borderWidth: tv(2), borderColor: color.accent },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },
});
