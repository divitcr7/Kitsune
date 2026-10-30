import { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { color } from '@/theme/tokens';

/** Thin rotating arc, the quiet loader streaming apps use. */
export function Spinner({ size = 40, stroke = 2.5, tint = color.text }: { size?: number; stroke?: number; tint?: string }) {
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false));
  }, [turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Animated.View style={[{ width: size, height: size }, spin]}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={tint} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${c * 0.28} ${c}`} />
      </Svg>
    </Animated.View>
  );
}
