import { Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, IconButton } from '@/components/Button';
import { statusLabel, useDownloadPercent } from '@/components/DownloadButton';
import { ProgressBar } from '@/components/EpisodeCard';
import { Icon } from '@/components/Icon';
import { T } from '@/components/T';
import { TopBar } from '@/components/TopBar';
import { deleteDownload } from '@/lib/downloads/engine';
import { type DownloadItem, useDownloadLive, useDownloads } from '@/lib/downloads/store';
import { formatBytes } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { playEpisode } from '@/lib/nav';
import { EDGE, isTV, rowFocus, tv } from '@/lib/tv';
import { color } from '@/theme/tokens';

/** Everything saved or on its way, by show: play, pause or resume, delete; space used and free. */
export default function Downloads() {
  const insets = useSafeAreaInsets();
  const items = useDownloads((s) => s.items);
  const order = useDownloads((s) => s.order);
  const paused = useDownloads((s) => s.paused);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const groups = useMemo(() => {
    const byShow = new Map<string, DownloadItem[]>();
    for (const id of order) {
      const it = items[id];
      if (!it) continue;
      const list = byShow.get(it.show.id) ?? [];
      list.push(it);
      byShow.set(it.show.id, list);
    }
    return [...byShow.values()].map((list) => list.sort((a, b) => a.episode.number - b.episode.number));
  }, [items, order]);

  const all = Object.values(items);
  const done = all.filter((d) => d.status === 'done');
  const active = all.filter((d) => d.status !== 'done' && d.status !== 'failed');
  const used = all.reduce((n, d) => n + (d.bytes || 0), 0);
  const free = (() => {
    try {
      return Paths.availableDiskSpace;
    } catch {
      return 0;
    }
  })();

  return (
    <View style={styles.fill}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingTop: isTV ? tv(36) : insets.top + 64, paddingBottom: isTV ? tv(40) : insets.bottom + 40 }}>
        <View style={styles.head}>
          <T variant="hero">Downloads</T>
          <T dim style={{ marginTop: 4 }}>
            {done.length} episode{done.length === 1 ? '' : 's'} saved  ·  {formatBytes(used)} used{free ? `  ·  ${formatBytes(free)} free` : ''}
          </T>
          {active.length ? (
            <View style={styles.headButtons}>
              {paused ? (
                <Button label="Resume all" icon="play" size="sm" onPress={() => useDownloads.getState().resume()} hasTVPreferredFocus />
              ) : (
                <Button label="Pause all" icon="pause" size="sm" variant="secondary" onPress={() => useDownloads.getState().pause()} hasTVPreferredFocus />
              )}
            </View>
          ) : null}
          <T variant="caption" faint style={{ marginTop: 10 }}>
            Downloads run while Kitsune is open and carry on from where they stopped next time you open it.
          </T>
        </View>

        {groups.length ? (
          groups.map((list) => (
            <View key={list[0].show.id} style={styles.group}>
              <T variant="title" numberOfLines={1}>
                {list[0].show.name}
              </T>
              {list.map((it, i) => (
                <Row key={it.id} item={it} first={i === 0} />
              ))}
            </View>
          ))
        ) : (
          <View style={styles.empty}>
            <Icon name="download-outline" size={isTV ? tv(48) : 44} tint={color.textFaint} />
            <T dim style={{ textAlign: 'center', marginTop: 10 }}>
              Nothing downloaded yet. Open a show and tap the download button next to an episode, or Download for the whole season.
            </T>
          </View>
        )}
      </Animated.ScrollView>
      {isTV ? null : <TopBar scrollY={scrollY} from={10} to={60} title="Downloads" left={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />} />}
    </View>
  );
}

function Row({ item, first }: { item: DownloadItem; first: boolean }) {
  const pct = useDownloadPercent(item);
  const bps = useDownloadLive((s) => (s.id === item.id ? s.bps : 0));
  const s = useDownloads.getState();

  function press() {
    haptics.selection();
    switch (item.status) {
      case 'done':
        playEpisode(item.show, item.episode);
        break;
      case 'paused':
      case 'failed':
        s.resume(item.id);
        s.setAsking(item.id);
        break;
      default:
        s.pause(item.id);
    }
  }

  function remove() {
    Alert.alert(item.status === 'done' ? 'Delete this download?' : 'Cancel this download?', `${item.show.name}, episode ${item.episode.number}`, [
      { text: item.status === 'done' ? 'Delete' : 'Cancel download', style: 'destructive', onPress: () => deleteDownload(item.id) },
      { text: 'Keep', style: 'cancel' },
    ]);
  }

  const icon = item.status === 'done' ? 'play-circle-outline' : item.status === 'failed' ? 'refresh' : item.status === 'paused' ? 'play' : 'pause';
  const detail = [statusLabel(item, pct), item.status === 'downloading' && bps > 0 ? `${formatBytes(bps)}/s` : null, item.status === 'done' && item.got?.height ? `${item.got.height}p` : null, item.bytes ? formatBytes(item.bytes) : null]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View style={[styles.rowWrap, !first && styles.rule]}>
      <Pressable accessibilityRole="button" onPress={press} style={({ pressed, focused }) => [styles.row, pressed && { opacity: 0.6 }, focused && rowFocus]}>
        <Icon name={icon} size={isTV ? tv(30) : 28} tint={item.status === 'failed' ? color.danger : color.text} />
        <View style={{ flex: 1 }}>
          <T variant="heading" numberOfLines={1}>
            Episode {item.episode.number}
            {item.episode.title ? `  ·  ${item.episode.title}` : ''}
          </T>
          <T variant="caption" faint numberOfLines={1} style={{ marginTop: 3 }}>
            {detail}  ·  {item.want.audio === 'dub' ? 'Dub' : 'Sub'}
          </T>
          {item.status !== 'done' && item.status !== 'failed' ? <ProgressBar value={pct} style={{ marginTop: 8 }} /> : null}
        </View>
      </Pressable>
      <IconButton icon="trash-can-outline" label={item.status === 'done' ? 'Delete download' : 'Cancel download'} tint={color.danger} onPress={remove} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  head: { paddingHorizontal: EDGE, marginBottom: 12 },
  headButtons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  group: { paddingHorizontal: EDGE, marginTop: 22 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: isTV ? tv(12) : 12 },
  empty: { alignItems: 'center', paddingHorizontal: EDGE * 2, marginTop: 60 },
});
