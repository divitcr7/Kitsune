import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Appear } from '@/components/Appear';
import { Icon } from '@/components/Icon';
import { Skeleton } from '@/components/Skeleton';
import { useTabScroll } from '@/components/TabBarContext';
import { Tabs } from '@/components/Tabs';
import { T } from '@/components/T';
import type { Show } from '@/lib/api';
import { broadcastTime, WEEKDAYS } from '@/lib/format';
import { art } from '@/lib/img';
import { openShow } from '@/lib/nav';
import { q } from '@/lib/queries';
import { useSignal } from '@/lib/ui';
import { color, radius, TAB_BAR_HEIGHT } from '@/theme/tokens';

// Monday-first week.
const DAYS = [1, 2, 3, 4, 5, 6, 0].map((d) => WEEKDAYS[d]);
const HEADER = 112;

export default function Schedule() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const today = DAYS.indexOf(WEEKDAYS[new Date().getDay()]);
  const [index, setIndex] = useState(today);
  const pager = useRef<Animated.FlatList<string>>(null);
  const position = useSharedValue(today);

  const schedule = useQuery(q.schedule);
  const byDay = useMemo(() => {
    const map: Record<string, Show[]> = {};
    for (const s of schedule.data ?? []) (map[s.release_day ?? ''] ??= []).push(s);
    for (const list of Object.values(map)) list.sort((a, b) => (a.broadcast ?? '99').localeCompare(b.broadcast ?? '99'));
    return map;
  }, [schedule.data]);

  const onPagerScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      position.value = e.contentOffset.x / width;
    },
  });

  const go = (i: number) => {
    setIndex(i);
    pager.current?.scrollToOffset({ offset: i * width, animated: true });
  };

  useSignal('reselect:schedule', () => go(today));

  return (
    <View style={styles.fill}>
      <Animated.FlatList
        ref={pager}
        horizontal
        pagingEnabled
        data={DAYS}
        keyExtractor={(d) => d}
        initialScrollIndex={today}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        showsHorizontalScrollIndicator={false}
        onScroll={onPagerScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        windowSize={3}
        renderItem={({ item }) => (
          <Day width={width} shows={byDay[item]} loading={schedule.isPending} top={insets.top + HEADER} bottom={TAB_BAR_HEIGHT + insets.bottom + 32} />
        )}
      />
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <T variant="hero" style={styles.title}>
          Schedule
        </T>
        <Tabs items={DAYS.map((d, i) => ({ key: d, label: d.slice(0, 3), dot: i === today }))} index={index} onChange={go} position={position} />
      </View>
    </View>
  );
}

function Day({ width, shows, loading, top, bottom }: { width: number; shows?: Show[]; loading: boolean; top: number; bottom: number }) {
  const onScroll = useTabScroll();
  return (
    <Animated.FlatList
      style={{ width }}
      data={shows ?? []}
      keyExtractor={(s) => s.id}
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: top + 8, paddingBottom: bottom, paddingHorizontal: 20 }}
      initialNumToRender={8}
      windowSize={7}
      ListEmptyComponent={
        loading ? (
          <View style={{ gap: 16, marginTop: 12 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} style={{ height: 78 }} />
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Icon name="weather-night" size={40} tint={color.textFaint} />
            <T dim style={{ marginTop: 8 }}>
              Nothing airing this day.
            </T>
          </View>
        )
      }
      renderItem={({ item, index }) => (
        <Appear index={index < 8 ? index : 0} distance={index < 8 ? 14 : 0}>
          <Row show={item} first={index === 0} />
        </Appear>
      )}
    />
  );
}

/** TV-guide row: air time on the left, then the show. */
function Row({ show, first }: { show: Show; first: boolean }) {
  const poster = art(show.poster, 'poster', '240x360');
  const time = broadcastTime(show.broadcast);
  return (
    <Pressable onPress={() => openShow(show)} style={({ pressed }) => [styles.row, !first && styles.rule, pressed && { opacity: 0.6 }]}>
      <View style={styles.time}>
        <T variant="label" style={{ fontWeight: '700' }}>
          {time ?? 'TBA'}
        </T>
        {time ? (
          <T variant="micro" faint style={{ marginTop: 2 }}>
            JST
          </T>
        ) : null}
      </View>
      <View style={styles.poster}>
        <Image source={poster.source} placeholder={poster.placeholder} placeholderContentFit="cover" contentFit="cover" transition={200} style={StyleSheet.absoluteFill} />
      </View>
      <View style={{ flex: 1 }}>
        <T variant="heading" numberOfLines={2}>
          {show.name}
        </T>
        <T variant="caption" faint numberOfLines={1} style={{ marginTop: 3 }}>
          {[show.type, show.genres?.slice(0, 2).map((g) => g.name).join(', ')].filter(Boolean).join('  ·  ')}
        </T>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  header: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: color.bg },
  title: { marginTop: 6, marginLeft: 20, height: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  time: { width: 64 },
  poster: { width: 52, height: 78, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: color.container2 },
  empty: { alignItems: 'center', marginTop: 60 },
});
