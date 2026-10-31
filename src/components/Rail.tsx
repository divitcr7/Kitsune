import type { ReactElement } from 'react';
import { FlatList, Pressable, StyleSheet, TVFocusGuideView, View } from 'react-native';
import { EDGE, isTV, tv } from '@/lib/tv';
import { color } from '@/theme/tokens';
import { Appear } from './Appear';
import { Icon } from './Icon';
import { Skeleton } from './Skeleton';
import { T } from './T';

type Props<T> = {
  title: string;
  data: T[] | undefined;
  keyOf: (item: T) => string;
  render: (item: T, index: number) => ReactElement;
  /** Width of one item, used for snapping and the loading skeleton. */
  itemWidth: number;
  itemHeight: number;
  gap?: number;
  onMore?: () => void;
};

// Room above and below a TV rail for the focused card to lift into without being clipped.
const LIFT = isTV ? tv(12) : 0;
// TV: where a shelf settles when focus moves into it (in a ScrollView with snapToAlignment="item").
export const RAIL_SNAP = isTV ? tv(76) : undefined;

/** A titled horizontal shelf that snaps item by item. */
export function Rail<T>({ title, data, keyOf, render, itemWidth, itemHeight, gap = 10, onMore }: Props<T>) {
  const list = data ? (
    <FlatList
      horizontal
      data={data}
      keyExtractor={keyOf}
      renderItem={({ item, index }) => render(item, index)}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.list, { gap }]}
      // A remote scrolls the shelf by moving focus; snapping would fight it.
      snapToInterval={isTV ? undefined : itemWidth + gap}
      decelerationRate="fast"
      initialNumToRender={isTV ? 8 : 5}
      windowSize={isTV ? 7 : 5}
      removeClippedSubviews={!isTV}
    />
  ) : null;

  return (
    <View style={styles.rail} scrollSnapOffset={RAIL_SNAP}>
      <Pressable disabled={!onMore} focusable={!!onMore} onPress={onMore} style={styles.head}>
        <T variant="title">{title}</T>
        {onMore ? <Icon name="chevron-right" size={22} tint={color.textDim} /> : null}
      </Pressable>

      {list ? (
        <Appear distance={8}>
          {/* Coming back to a shelf lands on the card you left it on. */}
          {isTV ? <TVFocusGuideView autoFocus>{list}</TVFocusGuideView> : list}
        </Appear>
      ) : (
        <View style={[styles.list, { gap, flexDirection: 'row' }]}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ width: itemWidth, height: itemHeight }} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { marginTop: isTV ? tv(16) : 28 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: EDGE, marginBottom: isTV ? tv(2) : 12 },
  list: { paddingHorizontal: EDGE, paddingVertical: LIFT },
});
