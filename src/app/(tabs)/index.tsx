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
        contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            progressViewOffset={insets.top + 64}
            colors={[color.accent]}
            progressBackgroundColor={color.container2}
          />
        }
      >
        <Hero items={featured.data} />

        {featured.isError && !featured.data ? (
          <View style={styles.error}>
            <T variant="heading">Can’t reach Anime Nexus</T>
            <T variant="caption" dim style={{ marginTop: 6, textAlign: 'center' }}>
              Check your connection and pull down to try again.
            </T>
          </View>
        ) : null}

        {continueWatching.length ? (
          <Rail
            title="Continue Watching"
            data={continueWatching}
            keyOf={(e) => e.show.id}
            itemWidth={280}
            itemHeight={158}
            render={(e) => <ContinueCard entry={e} />}
          />
        ) : null}

        <Rail
          title="Top 10 Today"
          data={popular.data?.slice(0, 10)}
          keyOf={(s) => s.id}
          itemWidth={166}
          itemHeight={177}
          gap={4}
          render={(s, i) => <RankCard show={s} rank={i + 1} />}
        />

        <Rail
          title="New Episodes"
          data={latest.data}
          keyOf={(l) => l.episode.id}
          itemWidth={260}
          itemHeight={146}
          render={(l) => <EpisodeCard item={l} />}
        />

        <Rail
          title="Airing This Season"
          data={seasonal.data?.slice(0, 24)}
          keyOf={(s) => s.id}
          itemWidth={118}
          itemHeight={177}
          render={(s) => <PosterCard show={s} width={118} bare />}
        />

        <Rail
          title="Trending Now"
          data={trending.data}
          keyOf={(s) => s.id}
          itemWidth={150}
          itemHeight={225}
          render={(s) => <PosterCard show={s} width={150} bare />}
        />

        <Rail
          title="Recently Added"
          data={recent.data?.slice(0, 24)}
          keyOf={(s) => s.id}
          itemWidth={118}
          itemHeight={177}
          render={(s) => <PosterCard show={s} width={118} bare />}
        />
      </Animated.ScrollView>

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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  brand: { flex: 1, paddingLeft: 8 },
  error: { alignItems: 'center', paddingHorizontal: 40, marginTop: 30 },
});
