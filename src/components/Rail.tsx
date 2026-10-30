import type { ReactElement } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
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

/** A titled horizontal shelf that snaps item by item. */
export function Rail<T>({ title, data, keyOf, render, itemWidth, itemHeight, gap = 10, onMore }: Props<T>) {
  return (
    <View style={styles.rail}>
      <Pressable disabled={!onMore} onPress={onMore} style={styles.head}>
        <T variant="title">{title}</T>
        {onMore ? <Icon name="chevron-right" size={22} tint={color.textDim} /> : null}
      </Pressable>

      {data ? (
        <Appear distance={8}>
          <FlatList
            horizontal
            data={data}
            keyExtractor={keyOf}
            renderItem={({ item, index }) => render(item, index)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.list, { gap }]}
            snapToInterval={itemWidth + gap}
            decelerationRate="fast"
            initialNumToRender={5}
            windowSize={5}
            removeClippedSubviews
          />
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
  rail: { marginTop: 28 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 20, marginBottom: 12 },
  list: { paddingHorizontal: 20 },
});
