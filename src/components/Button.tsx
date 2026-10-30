import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { color, radius } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { T } from './T';

/** Press feedback used everywhere: a quick dim and a hair of scale, no bounce. */
function usePress() {
  const p = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ opacity: 1 - p.value * 0.25, transform: [{ scale: 1 - p.value * 0.035 }] }));
  return {
    style,
    in: () => p.set(withTiming(1, { duration: 90 })),
    out: () => p.set(withTiming(0, { duration: 180 })),
  };
}

export function Button({
  label,
  sub,
  icon,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  style,
}: {
  label: string;
  sub?: string;
  icon?: IconName;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'accent' | 'text';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const press = usePress();
  const h = size === 'lg' ? 52 : size === 'sm' ? 38 : 46;
  const bg = variant === 'primary' ? color.primary : variant === 'secondary' ? color.ghost : variant === 'accent' ? color.accent : 'transparent';
  const fg = variant === 'primary' ? color.onPrimary : variant === 'text' ? color.accent : color.text;
  return (
    <Animated.View style={[{ opacity: disabled ? 0.4 : 1 }, press.style, style]}>
      <Pressable
        disabled={disabled}
        onPressIn={press.in}
        onPressOut={press.out}
        onPress={() => {
          Haptics.selectionAsync();
          onPress?.();
        }}
        style={[styles.button, { height: h, backgroundColor: bg, paddingHorizontal: variant === 'text' ? 4 : size === 'sm' ? 16 : 22 }]}
      >
        {icon ? <Icon name={icon} size={size === 'lg' ? 24 : 20} tint={fg} /> : null}
        <T variant={size === 'lg' ? 'heading' : 'label'} color={fg} style={{ fontWeight: '700', fontSize: size === 'lg' ? 16 : 14 }}>
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
}: {
  icon: IconName;
  onPress?: () => void;
  variant?: 'plain' | 'scrim' | 'ghost';
  size?: number;
  tint?: string;
  label: string;
  style?: ViewStyle;
}) {
  const press = usePress();
  const bg = variant === 'scrim' ? color.scrim : variant === 'ghost' ? color.ghost : 'transparent';
  return (
    <Animated.View style={[press.style, style]}>
      <Pressable
        accessibilityLabel={label}
        hitSlop={6}
        onPressIn={press.in}
        onPressOut={press.out}
        onPress={() => {
          Haptics.selectionAsync();
          onPress?.();
        }}
        style={[styles.icon, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}
      >
        <Icon name={icon} size={Math.round(size * 0.52)} tint={tint} />
      </Pressable>
    </Animated.View>
  );
}

/** Streaming-app action: icon over a small label ("My List", "Share"). */
export function Action({ icon, label, onPress, active }: { icon: IconName; label: string; onPress?: () => void; active?: boolean }) {
  const press = usePress();
  return (
    <Animated.View style={press.style}>
      <Pressable
        onPressIn={press.in}
        onPressOut={press.out}
        onPress={() => {
          Haptics.selectionAsync();
          onPress?.();
        }}
        style={styles.action}
        accessibilityLabel={label}
      >
        <Icon name={icon} size={26} tint={active ? color.accent : color.text} />
        <T variant="caption" dim style={{ marginTop: 6 }}>
          {label}
        </T>
      </Pressable>
    </Animated.View>
  );
}

/** Minimal pill; `selected` turns it white. */
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const press = usePress();
  return (
    <Animated.View style={press.style}>
      <Pressable onPressIn={press.in} onPressOut={press.out} onPress={onPress} style={[styles.chip, selected && styles.chipOn]}>
        <T variant="label" color={selected ? color.onPrimary : color.text} style={{ fontSize: 13 }}>
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
  action: { alignItems: 'center', minWidth: 72, paddingVertical: 4 },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.container2 },
  chipOn: { backgroundColor: color.primary },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },
});
