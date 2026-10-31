import { useQuery } from '@tanstack/react-query';
import { useTabTrigger } from 'expo-router/ui';
import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedRef, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '@/components/Button';
import { ContinueCard, EpisodeCard } from '@/components/EpisodeCard';
import { Hero } from '@/components/Hero';
import { Wordmark } from '@/components/Logo';
import { PosterCard, RankCard } from '@/components/Poster';
import { Rail } from '@/components/Rail';
import { useTabScroll } from '@/components/TabBarContext';
import { TopBar } from '@/components/TopBar';
import { T } from '@/components/T';
import { q, queryClient } from '@/lib/queries';
import { useStore } from '@/lib/store';
import { isTV, tv } from '@/lib/tv';
import { useSignal, useUi } from '@/lib/ui';
import { color, TAB_BAR_HEIGHT } from '@/theme/tokens';

export default function Home() {
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const onScroll = useTabScroll(scrollY);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [refreshing, setRefreshing] = useState(false);
  const { switchTab } = useTabTrigger({ name: 'discover' });
  const fire = useUi((s) => s.fire);

  const featured = useQuery(q.featured);
  const popular = useQuery(q.popular);
  const latest = useQuery(q.latest);
  const seasonal = useQuery(q.seasonal);
  const trending = useQuery(q.trending);
  const recent = useQuery(q.recent);

  const history = useStore((s) => s.history);
  const continueWatching = useMemo(() => Object.values(history).sort((a, b) => b.at - a.at).slice(0, 12), [history]);

  useSignal('reselect:home', () => scrollRef.current?.scrollTo({ y: 0, animated: true }));

  const refresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ predicate: (query) => query.meta?.persist === true });
    setRefreshing(false);
  };

  return (
    <View style={styles.fill}>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        // TV: the shelf (or billboard) the remote moves into settles at a fixed height.
        snapToAlignment={isTV ? 'item' : undefined}
        contentContainerStyle={{ paddingBottom: isTV ? tv(40) : TAB_BAR_HEIGHT + insets.bottom + 32 }}
        refreshControl={
          isTV ? undefined : (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              progressViewOffset={insets.top + 64}
              colors={[color.accent]}
              progressBackgroundColor={color.container2}
            />
          )
        }
      >
        <Hero items={featured.data} />

        {featured.isError && !featured.data ? (
          <View style={styles.error}>
            <T variant="heading">Can’t reach Anime Nexus</T>
            <T variant="caption" dim style={{ marginTop: 6, textAlign: 'center' }}>
              {isTV ? 'Check your connection. Kitsune keeps trying.' : 'Check your connection and pull down to try again.'}
            </T>
          </View>
        ) : null}

        {continueWatching.length ? (
          <Rail
            title="Continue Watching"
            data={continueWatching}
            keyOf={(e) => e.show.id}
            itemWidth={S.continue}
            itemHeight={S.continue * 0.5625}
            render={(e) => <ContinueCard entry={e} width={S.continue} />}
          />
        ) : null}

        <Rail
          title="Top 10 Today"
          data={popular.data?.slice(0, 10)}
          keyOf={(s) => s.id}
          itemWidth={S.rankItem}
          itemHeight={S.rank * 1.5}
          gap={4}
          render={(s, i) => <RankCard show={s} rank={i + 1} width={S.rank} />}
        />

        <Rail
          title="New Episodes"
          data={latest.data}
          keyOf={(l) => l.episode.id}
          itemWidth={S.episode}
          itemHeight={S.episode * 0.5625}
          render={(l) => <EpisodeCard item={l} width={S.episode} />}
        />

        <Rail
          title="Airing This Season"
          data={seasonal.data?.slice(0, 24)}
          keyOf={(s) => s.id}
          itemWidth={S.poster}
          itemHeight={S.poster * 1.5}
          render={(s) => <PosterCard show={s} width={S.poster} bare />}
        />

        <Rail
          title="Trending Now"
          data={trending.data}
          keyOf={(s) => s.id}
          itemWidth={S.large}
          itemHeight={S.large * 1.5}
          render={(s) => <PosterCard show={s} width={S.large} bare />}
        />

        <Rail
          title="Recently Added"
          data={recent.data?.slice(0, 24)}
          keyOf={(s) => s.id}
          itemWidth={S.poster}
          itemHeight={S.poster * 1.5}
          render={(s) => <PosterCard show={s} width={S.poster} bare />}
        />
      </Animated.ScrollView>

      {isTV ? null : (
        <TopBar
          scrollY={scrollY}
          from={120}
          to={260}
          left={
            <View style={styles.brand}>
              <Wordmark size={22} />
            </View>
          }
          right={
            <IconButton
              icon="magnify"
              label="Search"
              onPress={() => {
                switchTab('discover', {});
                fire('focus-search');
              }}
            />
          }
        />
      )}
    </View>
  );
}

// Shelf item widths: phone sizes, or 10-foot sizes on a TV (about seven posters across).
const S = isTV
  ? { continue: tv(230), rank: tv(100), rankItem: tv(140), episode: tv(230), poster: tv(108), large: tv(126) }
  : { continue: 280, rank: 118, rankItem: 166, episode: 260, poster: 118, large: 150 };

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  brand: { flex: 1, paddingLeft: 8 },
  error: { alignItems: 'center', paddingHorizontal: 40, marginTop: 30 },
});
