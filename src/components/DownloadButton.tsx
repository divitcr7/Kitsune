import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { Show } from '@/lib/api';
import { deleteDownload } from '@/lib/downloads/engine';
import { type DownloadItem, useDownloadLive, useDownloads } from '@/lib/downloads/store';
import { haptics } from '@/lib/haptics';
import { playEpisode } from '@/lib/nav';
import { type EpisodeLite, type ShowLite, useStore } from '@/lib/store';
import { isTV, tv } from '@/lib/tv';
import { color } from '@/theme/tokens';
import { Icon } from './Icon';

/** Queue episodes with the saved download preferences (or the ones given). */
export function downloadEpisodes(show: Show | ShowLite, episodes: EpisodeLite[], overrides?: Partial<{ audio: 'sub' | 'dub'; height: 'best' | number }>) {
  const prefs = useStore.getState().prefs;
  const want = { audio: overrides?.audio ?? prefs.download.audio, height: overrides?.height ?? prefs.download.height, audioLang: prefs.audioLang, subLang: prefs.subLang };
  const added = useDownloads.getState().enqueue(show, episodes, want);
  // The person is waiting on the first one: a Cloudflare check for it may be shown.
  if (episodes[0]) useDownloads.getState().setAsking(episodes[0].id);
  return added;
}

/** Percent done for an item, live while it downloads. */
export function useDownloadPercent(item?: DownloadItem): number {
  const live = useDownloadLive((s) => (item && s.id === item.id && s.total ? s.done / s.total : null));
  if (!item) return 0;
  if (item.status === 'done') return 1;
  if (live !== null) return live;
  return item.segs?.total ? item.segs.done / item.segs.total : 0;
}

export function statusLabel(item: DownloadItem, pct: number): string {
  switch (item.status) {
    case 'queued':
      return 'Waiting to download';
    case 'resolving':
      return 'Finding the stream…';
    case 'downloading':
      return `Downloading  ·  ${Math.floor(pct * 100)}%`;
    case 'paused':
      return pct > 0 ? `Paused  ·  ${Math.floor(pct * 100)}%` : 'Paused';
    case 'done':
      return 'Downloaded';
    case 'failed':
      return failLabel(item);
  }
}

export function failLabel(item: DownloadItem): string {
  switch (item.fail) {
    case 'space':
      return 'Not enough free space';
    case 'unmatched':
      return 'Couldn’t find this show on miruro.cx';
    case 'episode':
      return 'Not on miruro.cx yet';
    case 'blocked':
      return 'miruro.cx’s check needs you  ·  tap to try again';
    case 'protected':
      return 'This stream can’t be saved';
    case 'network':
      return 'Connection lost  ·  tap to try again';
    default:
      return 'No stream could be saved  ·  tap to try again';
  }
}

/**
 * The download control on an episode row: download, progress ring (tap to pause), resume, retry,
 * and once saved, a check (tap for Play or Delete).
 */
export function DownloadButton({ show, episode }: { show: Show | ShowLite; episode: EpisodeLite }) {
  const item = useDownloads((s) => s.items[episode.id]);
  const pct = useDownloadPercent(item);
  const size = isTV ? tv(30) : 28;

  function press() {
    haptics.selection();
    if (!item) {
      downloadEpisodes(show, [episode]);
      return;
    }
    const s = useDownloads.getState();
    switch (item.status) {
      case 'queued':
      case 'resolving':
      case 'downloading':
        s.pause(item.id);
        break;
      case 'paused':
      case 'failed':
        s.resume(item.id);
        s.setAsking(item.id);
        break;
      case 'done':
        Alert.alert(`Episode ${episode.number}`, 'Downloaded to this device.', [
          { text: 'Play', onPress: () => playEpisode(show, episode) },
          { text: 'Delete download', style: 'destructive', onPress: () => deleteDownload(item.id) },
          { text: 'Cancel', style: 'cancel' },
        ]);
        break;
    }
  }

  function longPress() {
    if (!item || item.status === 'done') return;
    Alert.alert(`Episode ${episode.number}`, statusLabel(item, pct), [
      { text: 'Cancel download', style: 'destructive', onPress: () => deleteDownload(item.id) },
      { text: 'Keep', style: 'cancel' },
    ]);
  }

  const label = item ? statusLabel(item, pct) : `Download episode ${episode.number}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={press}
      onLongPress={longPress}
      style={({ pressed, focused }) => [styles.hit, pressed && { opacity: 0.6 }, focused && styles.focused]}
    >
      {!item ? (
        <Icon name="download-outline" size={size} tint={color.textDim} />
      ) : item.status === 'done' ? (
        <Icon name="check-circle" size={size} tint={color.accent} />
      ) : item.status === 'failed' ? (
        <Icon name="alert-circle-outline" size={size} tint={color.danger} />
      ) : item.status === 'queued' ? (
        <Icon name="clock-outline" size={size} tint={color.textDim} />
      ) : (
        <Ring pct={pct} size={size} paused={item.status === 'paused'} />
      )}
    </Pressable>
  );
}

function Ring({ pct, size, paused }: { pct: number; size: number; paused: boolean }) {
  const stroke = Math.max(2.5, size / 10);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - Math.max(0.02, pct))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Icon name={paused ? 'play' : 'pause'} size={size * 0.45} tint={color.text} />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { padding: isTV ? tv(8) : 6, borderRadius: 999 },
  focused: { backgroundColor: 'rgba(255,255,255,0.14)' },
});
