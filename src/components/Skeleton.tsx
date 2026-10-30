import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

/** A placeholder block with a soft light sweep. */
export function Skeleton({ style, radius = 10 }: { style?: ViewStyle; radius?: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), -1, false));
  }, [t]);
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: -260 + t.value * 620 }] }));
  return (
    <View style={[styles.base, { borderRadius: radius }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, sweep]}>
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.band}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: '#121215', overflow: 'hidden' },
  band: { width: 260, height: '100%' },
});
