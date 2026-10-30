import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useTabTrigger } from 'expo-router/ui';
import { useMemo } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Appear } from '@/components/Appear';
import { Button, Divider } from '@/components/Button';
import { ContinueCard, ProgressBar } from '@/components/EpisodeCard';
import { Icon } from '@/components/Icon';
import { Fox } from '@/components/Logo';
import { PosterCard } from '@/components/Poster';
import { useTabScroll } from '@/components/TabBarContext';
import { TopBar } from '@/components/TopBar';
import { T } from '@/components/T';
import type { Show } from '@/lib/api';
import { minutes, timeAgo } from '@/lib/format';
import { art } from '@/lib/img';
import { openShow, playEpisode } from '@/lib/nav';
import { fraction, type HistoryEntry, useStore } from '@/lib/store';
import { color, radius, TAB_BAR_HEIGHT } from '@/theme/tokens';

const GITHUB = 'https://github.com/divitcr7';
const REPO = 'https://github.com/divitcr7/Kitsune';
const EMAIL = 'divit.p09@gmail.com';

export default function Library() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scrollY = useSharedValue(0);
  const onScroll = useTabScroll(scrollY);

  const history = useStore((s) => s.history);
  const progress = useStore((s) => s.progress);
  const myList = useStore((s) => s.myList);
  const entries = useMemo(() => Object.values(history).sort((a, b) => b.at - a.at), [history]);
  const inProgress = useMemo(
    () => entries.filter((e) => fraction(progress[e.episode.id]) < 0.92).slice(0, 10),
    [entries, progress],
  );

  const stats = useMemo(() => {
    let done = 0;
    let seconds = 0;
    for (const p of Object.values(progress)) {
      if (p.d && p.t / p.d > 0.85) done++;
      seconds += Math.min(p.t, p.d || p.t);
    }
    const hours = seconds / 3600;
    return { shows: entries.length, done, hours: hours < 10 ? hours.toFixed(1) : String(Math.round(hours)) };
  }, [progress, entries.length]);

  const itemW = Math.floor((width - 40 - 20) / 3);

  return (
    <View style={styles.fill}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 40 }}
      >
        <Appear style={styles.pad}>
          <T variant="hero">My Stuff</T>
        </Appear>

        <Appear index={1} style={styles.stats}>
          <Stat value={String(stats.shows)} label="Shows" />
          <View style={styles.statRule} />
          <Stat value={String(stats.done)} label="Episodes" />
          <View style={styles.statRule} />
          <Stat value={stats.hours} label="Hours" />
        </Appear>

        {inProgress.length ? (
          <>
            <Header title="Continue Watching" />
            <FlatList
              horizontal
              data={inProgress}
              keyExtractor={(e) => e.show.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rail}
              renderItem={({ item }) => <ContinueCard entry={item} width={280} />}
            />
          </>
        ) : null}

        <Header title="My List" count={myList.length} />
        {myList.length ? (
          <View style={[styles.pad, styles.grid]}>
            {(myList as Show[]).map((s, i) => (
              <Appear key={s.id} index={i < 9 ? i : 0}>
                <PosterCard show={s} width={itemW} bare />
              </Appear>
            ))}
          </View>
        ) : (
          <Empty icon="plus" text="Tap My List on any show to keep it here." />
        )}

        <Header title="History" count={entries.length} />
        {entries.length ? (
          <View style={styles.pad}>
            {entries.map((e, i) => (
              <Appear key={e.show.id} index={i < 8 ? i : 0} distance={i < 8 ? 10 : 0}>
                <HistoryRow entry={e} first={i === 0} />
              </Appear>
            ))}
            <T variant="caption" faint style={{ marginTop: 10 }}>
              Swipe left on a show to remove it.
            </T>
          </View>
        ) : (
          <Empty icon="history" text="Everything you watch shows up here, so you can jump right back in." />
        )}

        <About />
      </Animated.ScrollView>
      <TopBar scrollY={scrollY} from={10} to={50} title="My Stuff" />
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <T variant="display">{value}</T>
      <T variant="caption" faint style={{ marginTop: 2 }}>
        {label}
      </T>
    </View>
  );
}

function Header({ title, count }: { title: string; count?: number }) {
  return (
    <View style={[styles.pad, styles.header]}>
      <T variant="title">{title}</T>
      {count ? (
        <T variant="caption" faint>
          {count}
        </T>
      ) : null}
    </View>
  );
}

function HistoryRow({ entry, first }: { entry: HistoryEntry; first: boolean }) {
  const p = useStore((s) => s.progress[entry.episode.id]);
  const remove = useStore((s) => s.removeHistory);
  const poster = art(entry.show.poster, 'poster', '240x360');
  const f = fraction(p);
  const left = p && p.d ? Math.max(0, p.d - p.t) : 0;
  const status = f > 0.92 ? 'Watched' : left > 60 ? `${minutes(left)} left` : 'Started';

  return (
    <ReanimatedSwipeable
      friction={1.6}
      rightThreshold={70}
      overshootRight={false}
      onSwipeableOpen={() => remove(entry.show.id)}
      renderRightActions={() => (
        <View style={styles.remove}>
          <Icon name="trash-can-outline" size={20} tint={color.danger} />
          <T variant="caption" color={color.danger} style={{ fontWeight: '700' }}>
            Remove
          </T>
        </View>
      )}
    >
      <Pressable
        onPress={() => playEpisode(entry.show, entry.episode)}
        onLongPress={() => openShow(entry.show)}
        style={({ pressed }) => [styles.row, !first && styles.rule, pressed && { opacity: 0.6 }]}
      >
        <View style={styles.rowPoster}>
          <Image source={poster.source} placeholder={poster.placeholder} placeholderContentFit="cover" contentFit="cover" transition={200} style={StyleSheet.absoluteFill} />
        </View>
        <View style={{ flex: 1 }}>
          <T variant="heading" numberOfLines={1}>
            {entry.show.name}
          </T>
          <T variant="caption" faint numberOfLines={1} style={{ marginTop: 3 }}>
            Episode {entry.episode.number}  ·  {status}  ·  {timeAgo(entry.at)}
          </T>
          <ProgressBar value={Math.max(0.03, f)} style={{ marginTop: 10 }} />
        </View>
        <Icon name="play-circle-outline" size={32} tint={color.text} />
      </Pressable>
    </ReanimatedSwipeable>
  );
}

function Empty({ icon, text }: { icon: 'history' | 'plus'; text: string }) {
  const { switchTab } = useTabTrigger({ name: 'discover' });
  return (
    <View style={[styles.pad, styles.empty]}>
      <Icon name={icon} size={22} tint={color.textFaint} />
      <T dim style={{ flex: 1 }}>
        {text}
      </T>
      <Button label="Browse" variant="secondary" size="sm" onPress={() => switchTab('discover', {})} />
    </View>
  );
}

function About() {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  return (
    <View style={[styles.pad, { marginTop: 44 }]}>
      <Divider />
      <View style={styles.aboutHead}>
        <Fox size={40} />
        <View style={{ flex: 1 }}>
          <T variant="heading" style={{ fontWeight: '700' }}>
            Kitsune
          </T>
          <T variant="caption" faint>
            Version {version}  ·  Open source
          </T>
        </View>
      </View>
      <T dim style={{ marginTop: 14 }}>
        Made by Divit. Ideas, bugs, or just want to say hi? Reach out anytime.
      </T>
      <View style={styles.links}>
        <Button label="GitHub" icon="github" variant="secondary" size="sm" onPress={() => Linking.openURL(GITHUB)} style={{ flex: 1 }} />
        <Button label="Email" icon="email-outline" variant="secondary" size="sm" onPress={() => Linking.openURL(`mailto:${EMAIL}?subject=Kitsune`)} style={{ flex: 1 }} />
      </View>
      <Button label="Star Kitsune on GitHub" icon="star-outline" variant="text" size="sm" onPress={() => Linking.openURL(REPO)} style={{ alignSelf: 'flex-start', marginTop: 8 }} />
      <T variant="caption" faint style={{ marginTop: 8, lineHeight: 18 }}>
        Catalog and streams come from anime.nexus and play in its own player. Kitsune isn’t affiliated with anime.nexus and hosts no content.
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  pad: { paddingHorizontal: 20 },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: 20, marginHorizontal: 20, paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.line },
  stat: { flex: 1, alignItems: 'center' },
  statRule: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: color.line },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 32, marginBottom: 12 },
  rail: { paddingHorizontal: 20, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, backgroundColor: color.bg },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  rowPoster: { width: 48, height: 72, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: color.container2 },
  remove: { width: 96, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: color.dangerSoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 10 },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  aboutHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24 },
  links: { flexDirection: 'row', gap: 10, marginTop: 16 },
});
