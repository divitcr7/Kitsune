import type { ReactElement } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { type ScrollHandlerProcessed } from 'react-native-reanimated';
import type { Show } from '@/lib/api';
import { EDGE, isTV, tv } from '@/lib/tv';
import { Appear } from './Appear';
import { PosterCard } from './Poster';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';

const COLS = isTV ? 6 : 3;
const GAP = isTV ? tv(16) : 10;
const SIDE = EDGE;

/** Poster grid (three columns, six on a TV) with infinite loading. */
export function ShowGrid({
  data,
  loading,
  fetchingMore,
  onEndReached,
  header,
  empty,
  onScroll,
  topPad = 0,
  bottomPad = 0,
  listRef,
}: {
  data: Show[] | undefined;
  loading: boolean;
  fetchingMore?: boolean;
  onEndReached?: () => void;
  header?: ReactElement | null;
  empty?: ReactElement | null;
  onScroll?: ScrollHandlerProcessed<Record<string, unknown>>;
  topPad?: number;
  bottomPad?: number;
  listRef?: React.RefObject<Animated.FlatList<Show> | null>;
}) {
  const { width } = useWindowDimensions();
  const itemW = Math.floor((width - SIDE * 2 - GAP * (COLS - 1)) / COLS);

  return (
    <Animated.FlatList
      ref={listRef}
      data={loading ? [] : data}
      numColumns={COLS}
      keyExtractor={(s) => s.id}
      onScroll={onScroll}
      scrollEventThrottle={16}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: topPad, paddingBottom: bottomPad }}
      columnWrapperStyle={styles.row}
      ListHeaderComponent={header ?? undefined}
      ListEmptyComponent={
        loading ? (
          <View style={[styles.row, styles.skeletons]}>
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} style={{ width: itemW, height: itemW * 1.5 + 34 }} radius={6} />
            ))}
          </View>
        ) : (
          (empty ?? undefined)
        )
      }
      ListFooterComponent={fetchingMore ? <View style={styles.more}>
            <Spinner size={28} />
          </View> : undefined}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      initialNumToRender={COLS * 4}
      maxToRenderPerBatch={COLS * 4}
      windowSize={9}
      renderItem={({ item, index }) => (
        <Appear index={index < 18 ? index : 0}>
          <PosterCard show={item} width={itemW} />
        </Appear>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { gap: GAP, paddingHorizontal: SIDE, marginBottom: isTV ? tv(20) : 18 },
  skeletons: { flexWrap: 'wrap', rowGap: 18 },
  more: { alignItems: 'center', marginVertical: 24 },
});
