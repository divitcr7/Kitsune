import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { interpolate, interpolateColor, type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Appear } from '@/components/Appear';
import { Icon } from '@/components/Icon';
import { ShowGrid } from '@/components/ShowGrid';
import { useTabScroll } from '@/components/TabBarContext';
import { T } from '@/components/T';
import type { Show } from '@/lib/api';
import { q } from '@/lib/queries';
import { useSignal } from '@/lib/ui';
import { PressableScale } from '@/components/PressableScale';
import { color, radius, TAB_BAR_HEIGHT } from '@/theme/tokens';

const HEADER = 124;
// Deep, low-key gradients for the category tiles: colour without shouting.
const TILES: [string, string][] = [
  ['#6B2A16', '#1C0C07'],
  ['#2A2870', '#0B0B20'],
  ['#0F5552', '#061817'],
  ['#5A1F57', '#170818'],
  ['#6A1A2C', '#1C070C'],
  ['#2B4060', '#0B1119'],
  ['#6A4C14', '#1C1406'],
  ['#3E4A18', '#111506'],
];

export default function Discover() {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const list = useRef<Animated.FlatList<Show>>(null);
  const scrollY = useSharedValue(0);
  const onScroll = useTabScroll(scrollY);

  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), 280);
    return () => clearTimeout(id);
  }, [text]);

  useSignal('focus-search', () => setTimeout(() => input.current?.focus(), 280));
  useSignal('reselect:discover', () => {
    list.current?.scrollToOffset({ offset: 0, animated: true });
    input.current?.focus();
  });

  const searching = query.length > 1;
  const results = useInfiniteQuery(q.search(query));
  const popular = useInfiniteQuery(q.popularWeek);
  const genres = useQuery(q.genres);

  const source = searching ? results : popular;
  const data = useMemo(() => source.data?.pages.flatMap((p) => p.data), [source.data]);
  const mainGenres = useMemo(() => genres.data?.filter((g) => g.type === 'genre'), [genres.data]);

  const header = (
    <View>
      {!searching && mainGenres?.length ? (
        <Appear distance={10}>
          <T variant="title" style={styles.sectionLabel}>
            Browse Categories
          </T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.genres}>
            {chunk(mainGenres, 2).map((pair, i) => (
              <View key={i} style={{ gap: 10 }}>
                {pair.map((g, j) => (
                  <Tile key={g.id} label={g.name} colors={TILES[(i * 2 + j) % TILES.length]} onPress={() => router.push({ pathname: '/genre/[id]', params: { id: g.id, name: g.name } })} />
                ))}
              </View>
            ))}
          </ScrollView>
        </Appear>
      ) : null}
      <Appear key={searching ? 'r' : 'p'} distance={8}>
        <T variant="title" style={styles.gridTitle}>
          {searching ? (results.data ? `${results.data.pages[0].meta.total} Results` : 'Searching…') : 'Popular This Week'}
        </T>
      </Appear>
    </View>
  );

  return (
    <View style={styles.fill}>
      <ShowGrid
        listRef={list}
        data={data}
        loading={source.isPending && !source.data}
        fetchingMore={source.isFetchingNextPage}
        onEndReached={() => source.hasNextPage && !source.isFetchingNextPage && source.fetchNextPage()}
        header={header}
        onScroll={onScroll}
        topPad={insets.top + HEADER}
        bottomPad={TAB_BAR_HEIGHT + insets.bottom + 32}
        empty={
          searching ? (
            <View style={styles.empty}>
              <Icon name="magnify-close" size={40} tint={color.textFaint} />
              <T variant="heading" style={{ marginTop: 10 }}>
                Nothing for “{query}”
              </T>
              <T variant="caption" dim style={{ marginTop: 4 }}>
                Try the English or Japanese title.
              </T>
            </View>
          ) : null
        }
      />
      <Header top={insets.top} text={text} setText={setText} input={input} scrollY={scrollY} />
    </View>
  );
}

/** Large title that slides away on scroll, with a search field that stays put. */
function Header({
  top,
  text,
  setText,
  input,
  scrollY,
}: {
  top: number;
  text: string;
  setText: (s: string) => void;
  input: React.RefObject<ComponentRef<typeof TextInput> | null>;
  scrollY: SharedValue<number>;
}) {
  const focus = useSharedValue(0);
  const bar = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(focus.value, [0, 1], [color.container2, color.container3]),
    borderColor: interpolateColor(focus.value, [0, 1], ['rgba(255,255,255,0)', 'rgba(255,255,255,0.18)']),
  }));
  const surface = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [0, 40], [0, 1], 'clamp') }));
  const title = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 50], [1, 0], 'clamp'),
    transform: [{ translateY: interpolate(scrollY.value, [0, 50], [0, -10], 'clamp') }],
  }));

  return (
    <View pointerEvents="box-none" style={[styles.header, { paddingTop: top, height: top + HEADER }]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.surface, surface]} />
      <Animated.View style={title}>
        <T variant="hero" style={styles.title}>
          Search
        </T>
      </Animated.View>
      <Animated.View style={[styles.search, bar]}>
        <Icon name="magnify" size={22} tint={color.textDim} />
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          placeholder="Shows, movies, Japanese titles"
          placeholderTextColor={color.textFaint}
          selectionColor={color.accent}
          cursorColor={color.accent}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          style={styles.input}
          onFocus={() => focus.set(withTiming(1, { duration: 180 }))}
          onBlur={() => focus.set(withTiming(0, { duration: 200 }))}
        />
        {text ? (
          <Pressable hitSlop={10} onPress={() => setText('')} accessibilityLabel="Clear search">
            <Icon name="close-circle" size={20} tint={color.textDim} />
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

function Tile({ label, colors, onPress }: { label: string; colors: [string, string]; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={styles.tile} accessibilityLabel={label}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <T variant="heading" numberOfLines={2} style={styles.tileText}>
        {label}
      </T>
    </PressableScale>
  );
}

function chunk<T>(arr: T[], n: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16 },
  surface: { backgroundColor: color.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  title: { marginTop: 6, marginLeft: 4, height: 44 },
  search: {
    marginTop: 10,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
  },
  input: { flex: 1, color: color.text, fontSize: 16, paddingVertical: 0 },
  sectionLabel: { paddingHorizontal: 20, marginTop: 10, marginBottom: 12 },
  genres: { paddingHorizontal: 20, gap: 10 },
  tile: { width: 156, height: 84, borderRadius: radius.md, overflow: 'hidden', justifyContent: 'flex-end', padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' },
  tileText: { fontWeight: '700' },
  gridTitle: { paddingHorizontal: 20, marginTop: 30, marginBottom: 14 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 40 },
});
