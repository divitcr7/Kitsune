import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import type { ImageSet, LatestItem } from '@/lib/api';
import { audioLabel, minutes } from '@/lib/format';
import { art } from '@/lib/img';
import { openShow, playEpisode } from '@/lib/nav';
import { fraction, type HistoryEntry, useStore } from '@/lib/store';
import { color, radius } from '@/theme/tokens';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { T } from './T';

/** Thin watched-progress line; hidden when nothing's watched. */
export function ProgressBar({ value, style, onDark }: { value: number; style?: ViewStyle; onDark?: boolean }) {
  if (value <= 0) return null;
  const pct = Math.max(3, Math.min(100, value * 100));
  return (
    <View style={[styles.track, onDark && styles.trackOnDark, style]}>
      <View style={[styles.fill, { width: `${pct}%` }]} />
    </View>
  );
}

function Thumb({ image, fallback, width, children }: { image?: ImageSet; fallback?: ImageSet; width: number; children?: React.ReactNode }) {
  const ep = art(image, 'episode', width > 300 ? '1024x576' : '640x360');
  const bg = art(fallback, 'background', '960x540');
  return (
    <View style={[styles.thumb, { width, height: (width * 9) / 16 }]}>
      <Image
        source={ep.source ?? bg.source}
        placeholder={ep.placeholder ?? bg.placeholder}
        placeholderContentFit="cover"
        contentFit="cover"
        transition={250}
        cachePolicy="memory-disk"
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.8)']} locations={[0.5, 1]} style={StyleSheet.absoluteFill} />
      {children}
    </View>
  );
}

/** A freshly released episode: tap plays it, long-press opens the show. */
export function EpisodeCard({ item, width = 260 }: { item: LatestItem; width?: number }) {
  const ep = item.episode;
  const progress = useStore((s) => fraction(s.progress[ep.id]));
  const audio = audioLabel(ep.video_meta?.audio_languages);
  return (
    <PressableScale onPress={() => playEpisode(item, ep)} onLongPress={() => openShow(item)} delayLongPress={350} style={{ width }}>
      <Thumb image={ep.image} fallback={item.poster} width={width}>
        <View style={styles.corner}>
          <Icon name="play" size={16} tint="#fff" />
          <T variant="micro" color="#fff">
            EP {ep.number}
          </T>
          {audio ? (
            <T variant="micro" color="rgba(255,255,255,0.7)">
              · {audio}
            </T>
          ) : null}
        </View>
        <ProgressBar value={progress} onDark style={styles.edgeBar} />
      </Thumb>
      <T variant="label" numberOfLines={1} style={styles.title}>
        {item.name}
      </T>
      <T variant="caption" dim numberOfLines={1} style={styles.sub}>
        {ep.title || `Episode ${ep.number}`} · {minutes(ep.duration)}
      </T>
    </PressableScale>
  );
}

/** Up Next card: still frame with the progress line along the bottom edge, time left underneath. */
export function ContinueCard({ entry, width = 280 }: { entry: HistoryEntry; width?: number }) {
  const p = useStore((s) => s.progress[entry.episode.id]);
  const remove = useStore((s) => s.removeHistory);
  const left = p && p.d ? Math.max(0, p.d - p.t) : 0;
  return (
    <PressableScale onPress={() => playEpisode(entry.show, entry.episode)} onLongPress={() => openShow(entry.show)} style={{ width }}>
      <Thumb image={entry.episode.image} fallback={entry.show.background ?? entry.show.poster} width={width}>
        <View style={styles.playRing}>
          <Icon name="play" size={22} tint="#fff" />
        </View>
        <Pressable hitSlop={10} style={styles.close} onPress={() => remove(entry.show.id)} accessibilityLabel="Remove from Continue Watching">
          <Icon name="close" size={14} tint="#fff" />
        </Pressable>
        <ProgressBar value={Math.max(0.03, fraction(p))} onDark style={styles.edgeBar} />
      </Thumb>
      <T variant="label" numberOfLines={1} style={styles.title}>
        {entry.show.name}
      </T>
      <T variant="caption" dim numberOfLines={1} style={styles.sub}>
        Episode {entry.episode.number}
        {left > 60 ? `  ·  ${minutes(left)} left` : ''}
      </T>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  thumb: { overflow: 'hidden', borderRadius: radius.md, backgroundColor: color.container2 },
  title: { marginTop: 10 },
  sub: { marginTop: 2 },
  corner: { position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  track: { height: 3, borderRadius: 2, backgroundColor: color.container4, overflow: 'hidden' },
  trackOnDark: { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 0 },
  fill: { height: '100%', backgroundColor: color.accent },
  edgeBar: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  playRing: {
    position: 'absolute',
    left: 12,
    bottom: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  close: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
