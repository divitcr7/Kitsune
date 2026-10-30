import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Extrapolation, interpolate, type SharedValue, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Appear } from '@/components/Appear';
import { Action, Button, Chip, IconButton } from '@/components/Button';
import { ProgressBar } from '@/components/EpisodeCard';
import { Icon } from '@/components/Icon';
import { Skeleton } from '@/components/Skeleton';
import { T } from '@/components/T';
import { TopBar } from '@/components/TopBar';
import type { Episode, Show, Stats } from '@/lib/api';
import { clock, compact, minutes, year } from '@/lib/format';
import { art, imgUrl, webUrl } from '@/lib/img';
import { playEpisode, preloadEpisode, previewOf } from '@/lib/nav';
import { usePlayer } from '@/lib/player';
import { q } from '@/lib/queries';
import { type EpisodeLite, fraction, resumePoint, useStore } from '@/lib/store';
import { color, radius } from '@/theme/tokens';

const PER_PAGE = 100;

export default function ShowScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const heroH = Math.round(width * 1.25);

  const show = useQuery({ ...q.show(id), placeholderData: previewOf(id) });
  const stats = useQuery(q.stats(id));
  const s = show.data;

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  return (
    <View style={styles.fill}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}>
        <Backdrop show={s} height={heroH} scrollY={scrollY} />
        <View style={[styles.head, { marginTop: heroH - 150 }]}>
          {s ? (
            <Appear distance={16}>
              <Title show={s} />
            </Appear>
          ) : null}
        </View>
        {s ? <Body show={s} stats={stats.data} /> : <BodySkeleton />}
      </Animated.ScrollView>

      <TopBar
        scrollY={scrollY}
        from={heroH - 260}
        to={heroH - 140}
        title={s?.name}
        left={<IconButton icon="arrow-left" label="Back" variant="scrim" onPress={() => router.back()} />}
      />
    </View>
  );
}

function Backdrop({ show, height, scrollY }: { show?: Show; height: number; scrollY: SharedValue<number> }) {
  const image = art(show?.poster ?? show?.background, show?.poster ? 'poster' : 'background', show?.poster ? '1560x2340' : '1360x768');
  const style = useAnimatedStyle(() => {
    const y = scrollY.value;
    if (y < 0) return { transform: [{ translateY: y / 2 }, { scale: 1 + -y / height }] };
    return { transform: [{ translateY: y * 0.4 }] };
  });
  // Fade only the art: on Android a view's opacity applies to each child separately, so fading
  // the whole layer would also thin out the black gradient and let the art show through it.
  const fade = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [0, height * 0.8], [1, 0.2], Extrapolation.CLAMP) }));
  return (
    <Animated.View style={[styles.backdrop, { height }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, fade]}>
        <Image source={image.source} placeholder={image.placeholder} placeholderContentFit="cover" contentFit="cover" contentPosition="top" transition={350} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <LinearGradient
        colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.96)', color.bg]}
        locations={[0, 0.2, 0.5, 0.78, 1]}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

/** Title art when the show has it, otherwise the name set big. */
function Title({ show }: { show: Show }) {
  const logo = imgUrl(show.logo, 'logo', 'large');
  return (
    <View style={styles.titleWrap}>
      {logo ? (
        <Image source={{ uri: logo }} contentFit="contain" style={styles.logo} transition={300} accessibilityLabel={show.name} />
      ) : (
        <T variant="hero" numberOfLines={3} style={styles.name}>
          {show.name}
        </T>
      )}
    </View>
  );
}

function Body({ show, stats }: { show: Show; stats?: Stats }) {
  const [expanded, setExpanded] = useState(false);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const episodes = useQuery(q.episodes(show.id, page, order));
  const entry = useStore((st) => st.history[show.id]);
  // Only the progress of the episode we might resume, not the whole map (avoids re-rendering on every tick).
  const lastProgress = useStore((st) => (entry ? st.progress[entry.episode.id] : undefined));
  const inList = useStore((st) => st.myList.some((m) => m.id === show.id));
  const toggle = useStore((st) => st.toggleList);

  const total = episodes.data?.meta.total ?? 0;
  const pages = Math.ceil(total / PER_PAGE);
  const list = episodes.data?.data;

  const upNext: EpisodeLite | undefined = useMemo(() => {
    if (entry) {
      if (lastProgress && fraction(lastProgress) > 0.92) return list?.find((e) => e.number === entry.episode.number + 1) ?? entry.episode;
      return entry.episode;
    }
    return order === 'asc' && page === 1 ? list?.[0] : undefined;
  }, [entry, lastProgress, list, order, page]);
  const resumeAt = upNext && entry && upNext.id === entry.episode.id ? resumePoint(lastProgress) : 0;

  usePreloadUpNext(show, upNext);

  const score = stats?.average?.score ?? show.average?.score;
  const eps = show.episode_count_current ?? show.episode_count;
  const dub = stats?.audio_languages?.some((l) => /^(eng|english)/i.test(l));
  const meta = [show.type, year(show.release_date), eps ? `${eps} Episodes` : undefined, stats?.audio_languages?.length ? (dub ? 'Sub & Dub' : 'Sub') : undefined].filter(Boolean);

  return (
    <Appear distance={10}>
      <View style={styles.metaRow}>
        {score ? (
          <View style={styles.score}>
            <Icon name="star" size={13} tint={color.star} />
            <T variant="caption" style={{ fontWeight: '700' }}>
              {score.toFixed(1)}
            </T>
          </View>
        ) : null}
        <T variant="caption" dim numberOfLines={1}>
          {meta.join('  ·  ')}
        </T>
      </View>
      {show.genres?.length ? (
        <T variant="caption" faint numberOfLines={1} style={styles.genreLine}>
          {show.genres
            .slice(0, 4)
            .map((g) => g.name)
            .join('  ·  ')}
        </T>
      ) : null}

      <View style={styles.play}>
        <Button
          size="lg"
          icon="play"
          disabled={!upNext}
          label={upNext ? `${resumeAt ? 'Resume' : 'Play'} Episode ${upNext.number}` : 'Play'}
          sub={resumeAt && lastProgress ? `· ${clock(lastProgress.d - lastProgress.t)} left` : undefined}
          onPress={() => upNext && playEpisode(show, upNext)}
        />
        {resumeAt && lastProgress ? <ProgressBar value={fraction(lastProgress)} style={styles.playBar} /> : null}
      </View>

      <View style={styles.actions}>
        <Action icon={inList ? 'check' : 'plus'} label="My List" active={inList} onPress={() => toggle(show)} />
        <Action icon="share-variant-outline" label="Share" onPress={() => Share.share({ message: `${show.name}\n${webUrl(`/series/${show.id}/${show.slug}`)}` })} />
        <Action
          icon={order === 'asc' ? 'sort-numeric-ascending' : 'sort-numeric-descending'}
          label={order === 'asc' ? 'Oldest first' : 'Newest first'}
          onPress={() => {
            setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
            setPage(1);
          }}
        />
      </View>

      {show.description ? (
        <Pressable style={styles.section} onPress={() => setExpanded((v) => !v)}>
          <T dim numberOfLines={expanded ? undefined : 3} style={styles.synopsis}>
            {show.description.trim()}
          </T>
          {expanded ? null : (
            <T variant="micro" style={{ marginTop: 6 }}>
              More
            </T>
          )}
        </Pressable>
      ) : null}

      <View style={styles.epHead}>
        <T variant="title">Episodes</T>
        {total ? (
          <T variant="caption" faint>
            {total}
          </T>
        ) : null}
      </View>

      {pages > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {Array.from({ length: pages }, (_, i) => {
            const a = order === 'asc' ? i * PER_PAGE + 1 : total - i * PER_PAGE;
            const b = order === 'asc' ? Math.min(total, (i + 1) * PER_PAGE) : Math.max(1, total - (i + 1) * PER_PAGE + 1);
            return <Chip key={i} label={`${a}–${b}`} selected={page === i + 1} onPress={() => setPage(i + 1)} />;
          })}
        </ScrollView>
      ) : null}

      <View style={[styles.episodes, episodes.isPlaceholderData && { opacity: 0.5 }]}>
        {list
          ? list.map((ep, i) => (
              <Appear key={ep.id} index={i < 10 ? i : 0} distance={i < 10 ? 10 : 0}>
                <EpisodeRow show={show} ep={ep} current={upNext?.id === ep.id} />
              </Appear>
            ))
          : [0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 80, marginBottom: 16 }} />)}
        {list && !list.length ? (
          <T dim style={{ textAlign: 'center', marginTop: 20 }}>
            No episodes yet. Check back soon.
          </T>
        ) : null}
      </View>

      <Info show={show} stats={stats} />
    </Appear>
  );
}

/**
 * While this page is open, quietly load the up-next episode so Play starts instantly.
 * Keyed on ids, not objects: the show object is replaced when full data lands, and
 * restarting the preload then would throw away the page it already loaded.
 */
function usePreloadUpNext(show: Show, upNext: EpisodeLite | undefined) {
  const latest = useRef({ show, upNext });
  useEffect(() => {
    latest.current = { show, upNext };
  });
  const showId = show.id;
  const episodeId = upNext?.id;
  useFocusEffect(
    useCallback(() => {
      if (!episodeId) return;
      const id = setTimeout(() => {
        const { show: s, upNext: ep } = latest.current;
        if (ep) preloadEpisode(s, ep);
      }, 900);
      return () => {
        clearTimeout(id);
        if (!usePlayer.getState().visible) usePlayer.getState().dropPreload(showId);
      };
    }, [showId, episodeId]),
  );
}

/** Quiet facts block at the foot of the page, label over value. */
function Info({ show, stats }: { show: Show; stats?: Stats }) {
  const items = [
    { label: 'Status', value: show.status?.replace('Currently Airing', 'Airing').replace('Finished Airing', 'Finished') },
    { label: 'Premiered', value: show.premiered ? `${show.premiered[0].toUpperCase()}${show.premiered.slice(1)} ${year(show.release_date) ?? ''}` : undefined },
    { label: 'Rated', value: show.parental_rating?.split(' - ')[0] },
    { label: 'Subtitles', value: stats?.subtitle_languages?.length ? `${stats.subtitle_languages.length} languages` : undefined },
    { label: 'Followers', value: compact(stats?.followers) },
    { label: 'Also known as', value: show.name_alt && show.name_alt !== show.name ? show.name_alt : undefined },
  ].filter((f): f is { label: string; value: string } => !!f.value);
  if (!items.length) return null;
  return (
    <View style={styles.info}>
      <T variant="title" style={{ marginBottom: 14 }}>
        Information
      </T>
      <View style={styles.infoGrid}>
        {items.map((f) => (
          <View key={f.label} style={styles.infoItem}>
            <T variant="caption" faint>
              {f.label}
            </T>
            <T variant="label" numberOfLines={2} style={{ marginTop: 3 }}>
              {f.value}
            </T>
          </View>
        ))}
      </View>
    </View>
  );
}

function EpisodeRow({ show, ep, current }: { show: Show; ep: Episode; current: boolean }) {
  const p = useStore((st) => st.progress[ep.id]);
  const thumb = art(ep.image, 'episode', '640x360');
  const tags = [ep.is_filler ? 'Filler' : null, ep.is_recap ? 'Recap' : null].filter(Boolean);
  return (
    <Pressable onPress={() => playEpisode(show, ep)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <View style={styles.rowThumb}>
        <Image source={thumb.source} placeholder={thumb.placeholder} placeholderContentFit="cover" contentFit="cover" transition={200} recyclingKey={ep.id} style={StyleSheet.absoluteFill} />
        <View style={styles.rowPlay}>
          <Icon name="play" size={18} tint="#fff" />
        </View>
        <ProgressBar value={fraction(p)} onDark style={styles.rowBar} />
      </View>
      <View style={styles.rowText}>
        <T variant="micro" color={current ? color.accent : color.textFaint}>
          {current ? 'Up next  ·  ' : ''}Episode {ep.number}
          {tags.length ? `  ·  ${tags.join(' · ')}` : ''}
        </T>
        <T variant="heading" numberOfLines={2} style={{ marginTop: 3 }}>
          {ep.title || `Episode ${ep.number}`}
        </T>
        <T variant="caption" faint style={{ marginTop: 3 }}>
          {minutes(ep.duration)}
        </T>
      </View>
    </Pressable>
  );
}

function BodySkeleton() {
  return (
    <View style={{ paddingHorizontal: 20, marginTop: 24, gap: 14 }}>
      <Skeleton style={{ height: 14, width: '60%', alignSelf: 'center' }} />
      <Skeleton style={{ height: 52 }} />
      <Skeleton style={{ height: 80 }} />
      <Skeleton style={{ height: 80 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  head: { paddingHorizontal: 28, minHeight: 96, justifyContent: 'flex-end' },
  titleWrap: { alignItems: 'center' },
  logo: { width: '86%', height: 96 },
  name: { textAlign: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20, marginTop: 16 },
  score: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  genreLine: { textAlign: 'center', marginTop: 6, paddingHorizontal: 20 },
  play: { paddingHorizontal: 20, marginTop: 20 },
  playBar: { marginTop: 10, marginHorizontal: 4 },
  actions: { flexDirection: 'row', justifyContent: 'space-evenly', paddingHorizontal: 20, marginTop: 18 },
  section: { paddingHorizontal: 20, marginTop: 18 },
  synopsis: { fontSize: 14, lineHeight: 21 },
  chips: { paddingHorizontal: 20, gap: 8, marginTop: 4, marginBottom: 6 },
  epHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 20, marginTop: 30, marginBottom: 10 },
  episodes: { paddingHorizontal: 20, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  rowThumb: { width: 142, height: 80, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: color.container2 },
  rowPlay: { position: 'absolute', left: 6, bottom: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  rowBar: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  rowText: { flex: 1 },
  info: { paddingHorizontal: 20, marginTop: 24 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 18 },
  infoItem: { width: '50%', paddingRight: 12 },
});
