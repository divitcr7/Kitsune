import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { Show } from '@/lib/api';
import { year } from '@/lib/format';
import { art, imgUrl } from '@/lib/img';
import { openShow, playShow } from '@/lib/nav';
import { useStore } from '@/lib/store';
import { color } from '@/theme/tokens';
import { Appear } from './Appear';
import { Button } from './Button';
import { PressableScale } from './PressableScale';
import { Skeleton } from './Skeleton';
import { T } from './T';

const DWELL = 7000;

/**
 * Full-bleed cinematic hero: key art edge to edge with a slow Ken Burns push,
 * title art and actions over a deep fade, and story-style progress bars.
 */
export function Hero({ items }: { items: Show[] | undefined }) {
  const { width } = useWindowDimensions();
  const height = Math.round(width * 1.38);
  const x = useSharedValue(0);
  const ref = useAnimatedRef<Animated.FlatList<Show>>();
  const [active, setActive] = useState(0);
  const dragging = useRef(false);
  const dwell = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      x.value = e.contentOffset.x;
    },
  });
  useAnimatedReaction(
    () => Math.round(x.value / width),
    (i, prev) => {
      if (i !== prev) scheduleOnRN(setActive, i);
    },
    [width],
  );

  // Each slide dwells for DWELL ms (drives the Ken Burns push and the progress bar), then advances.
  useEffect(() => {
    if (!items?.length) return;
    dwell.set(0);
    dwell.set(withTiming(1, { duration: DWELL, easing: Easing.linear }));
    const id = setTimeout(() => {
      if (!dragging.current) ref.current?.scrollToOffset({ offset: ((active + 1) % items.length) * width, animated: true });
    }, DWELL);
    return () => {
      clearTimeout(id);
      cancelAnimation(dwell);
    };
  }, [active, items?.length, width, ref, dwell]);

  const current = items?.[Math.min(active, items.length - 1)];
  if (!items?.length || !current) {
    return (
      <View style={{ height }}>
        <Skeleton style={styles.fill} radius={0} />
      </View>
    );
  }

  return (
    <View style={{ height }}>
      <Animated.FlatList
        ref={ref}
        horizontal
        pagingEnabled
        data={items}
        keyExtractor={(s) => s.id}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => (dragging.current = true)}
        onMomentumScrollEnd={() => (dragging.current = false)}
        renderItem={({ item, index }) => <Slide item={item} index={index} x={x} width={width} height={height} dwell={dwell} active={index === active} />}
      />
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} style={[styles.top, { height: height * 0.22 }]} />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)', '#000', '#000']}
        locations={[0, 0.35, 0.7, 0.88, 1]}
        style={[styles.bottom, { height: height * 0.58 }]}
      />
      <View pointerEvents="box-none" style={styles.info}>
        <Appear key={current.id} distance={8}>
          <Title show={current} />
          <T variant="caption" dim numberOfLines={1} style={styles.meta}>
            {[...(current.genres ?? []).slice(0, 3).map((g) => g.name), year(current.release_date)].filter(Boolean).join('  ·  ')}
          </T>
          <Actions show={current} />
        </Appear>
        <Progress count={items.length} active={active} dwell={dwell} />
      </View>
    </View>
  );
}

function Slide({ item, index, x, width, height, dwell, active }: { item: Show; index: number; x: SharedValue<number>; width: number; height: number; dwell: SharedValue<number>; active: boolean }) {
  const style = useAnimatedStyle(() => {
    const p = (x.value - index * width) / width;
    return {
      transform: [
        { translateX: interpolate(p, [-1, 0, 1], [-width * 0.25, 0, width * 0.25], Extrapolation.CLAMP) },
        { scale: 1.02 + (active ? dwell.value * 0.08 : 0) },
      ],
    };
  });
  const { source, placeholder } = art(item.poster, 'poster', '1560x2340');
  return (
    <PressableScale onPress={() => openShow(item)} scaleTo={1} style={{ width, height, overflow: 'hidden' }}>
      <Animated.View style={[StyleSheet.absoluteFill, style]}>
        <Image source={source} placeholder={placeholder} placeholderContentFit="cover" contentFit="cover" contentPosition="top" transition={400} cachePolicy="memory-disk" style={StyleSheet.absoluteFill} />
      </Animated.View>
    </PressableScale>
  );
}

function Title({ show }: { show: Show }) {
  const logo = imgUrl(show.logo, 'logo', 'large');
  if (logo) return <Image source={{ uri: logo }} contentFit="contain" contentPosition="left" style={styles.logo} transition={300} accessibilityLabel={show.name} />;
  return (
    <T variant="hero" numberOfLines={2}>
      {show.name}
    </T>
  );
}

function Actions({ show }: { show: Show }) {
  const inList = useStore((s) => s.myList.some((m) => m.id === show.id));
  const toggle = useStore((s) => s.toggleList);
  return (
    <View style={styles.actions}>
      <Button label="Play" icon="play" size="lg" onPress={() => playShow(show)} style={{ flex: 1 }} />
      <Button label={inList ? 'In My List' : 'My List'} icon={inList ? 'check' : 'plus'} variant="secondary" size="lg" onPress={() => toggle(show)} style={{ flex: 1 }} />
    </View>
  );
}

/** Story-style segments: the active one fills over the dwell time. */
function Progress({ count, active, dwell }: { count: number; active: number; dwell: SharedValue<number> }) {
  return (
    <View style={styles.progress}>
      {Array.from({ length: count }, (_, i) => (
        <Segment key={i} state={i < active ? 'done' : i === active ? 'active' : 'todo'} dwell={dwell} />
      ))}
    </View>
  );
}

function Segment({ state, dwell }: { state: 'done' | 'active' | 'todo'; dwell: SharedValue<number> }) {
  const fill = useAnimatedStyle(() => ({ width: `${state === 'done' ? 100 : state === 'active' ? dwell.value * 100 : 0}%` }));
  return (
    <View style={styles.segment}>
      <Animated.View style={[styles.segmentFill, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  info: { position: 'absolute', left: 20, right: 20, bottom: 18 },
  logo: { width: 260, height: 92 },
  meta: { marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  progress: { flexDirection: 'row', gap: 4, marginTop: 18 },
  segment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  segmentFill: { height: '100%', backgroundColor: color.text },
});
