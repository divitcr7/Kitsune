import { useInfiniteQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '@/components/Button';
import { ShowGrid } from '@/components/ShowGrid';
import { T } from '@/components/T';
import { TopBar } from '@/components/TopBar';
import { q } from '@/lib/queries';
import { color } from '@/theme/tokens';

export default function Genre() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const insets = useSafeAreaInsets();
  const shows = useInfiniteQuery(q.genre(id));
  const data = useMemo(() => shows.data?.pages.flatMap((p) => p.data), [shows.data]);
  const total = shows.data?.pages[0]?.meta.total;
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  return (
    <View style={styles.fill}>
      <ShowGrid
        data={data}
        loading={shows.isPending}
        fetchingMore={shows.isFetchingNextPage}
        onEndReached={() => shows.hasNextPage && !shows.isFetchingNextPage && shows.fetchNextPage()}
        onScroll={onScroll}
        topPad={insets.top + 64}
        bottomPad={insets.bottom + 40}
        header={
          <View style={styles.head}>
            <T variant="hero">{name}</T>
            {total ? (
              <T dim style={{ marginTop: 4 }}>
                {total} shows
              </T>
            ) : null}
          </View>
        }
      />
      <TopBar scrollY={scrollY} from={10} to={60} title={name} left={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  head: { paddingHorizontal: 20, marginBottom: 20 },
});
