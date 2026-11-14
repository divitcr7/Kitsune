import { Paths } from 'expo-file-system';
import { type ReactNode, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TVFocusGuideView, View } from 'react-native';
import type { Show } from '@/lib/api';
import { useDownloads } from '@/lib/downloads/store';
import { formatBytes } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { queryClient, q } from '@/lib/queries';
import { type EpisodeLite, useStore } from '@/lib/store';
import { isTV, tv } from '@/lib/tv';
import { color, radius } from '@/theme/tokens';
import { Button } from './Button';
import { downloadEpisodes } from './DownloadButton';
import { Icon } from './Icon';
import { T } from './T';

type Which = 'all' | 'unwatched' | 'remaining';
const QUALITIES: { id: 'best' | number; label: string; note: string; bytes: number }[] = [
  { id: 'best', label: 'Best', note: 'Up to 1080p', bytes: 450e6 },
  { id: 1080, label: '1080p', note: 'About 300–450 MB an episode', bytes: 400e6 },
  { id: 720, label: '720p', note: 'About 200–250 MB an episode', bytes: 230e6 },
  { id: 480, label: '480p', note: 'About 100–150 MB an episode', bytes: 130e6 },
];

/** Every episode of a show, in order (the catalog pages them 100 at a time). */
async function allEpisodes(showId: string): Promise<EpisodeLite[]> {
  const first = await queryClient.fetchQuery(q.episodes(showId, 1, 'asc'));
  const out: EpisodeLite[] = [...first.data];
  for (let p = 2; p <= first.meta.last_page; p++) out.push(...(await queryClient.fetchQuery(q.episodes(showId, p, 'asc'))).data);
  return out;
}

/**
 * Download a whole show (or what's left of it): sub or dub, a quality, and which episodes. The
 * choices are kept as the defaults for single-episode downloads too.
 */
export function DownloadSheet({ show, total, onClose }: { show: Show; total: number; onClose: () => void }) {
  const saved = useStore((s) => s.prefs.download);
  const [audio, setAudio] = useState<'sub' | 'dub'>(saved.audio);
  const [height, setHeight] = useState<'best' | number>(saved.height);
  const [which, setWhich] = useState<Which>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const free = (() => {
    try {
      return Paths.availableDiskSpace;
    } catch {
      return 0;
    }
  })();
  const per = QUALITIES.find((x) => x.id === height)?.bytes ?? 400e6;

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const eps = await allEpisodes(show.id);
      const { progress, history } = useStore.getState();
      const lastNumber = history[show.id]?.episode.number ?? 0;
      const picked = eps.filter((e) => {
        if (which === 'unwatched') {
          const p = progress[e.id];
          return !(p && p.d && p.t / p.d > 0.92);
        }
        if (which === 'remaining') return e.number >= lastNumber;
        return true;
      });
      useStore.getState().setPrefs({ download: { audio, height } });
      const added = downloadEpisodes(show, picked, { audio, height });
      haptics.selection();
      if (!added && picked.length) setError('Those episodes are already downloaded or in the queue.');
      else onClose();
    } catch {
      setError('Couldn’t load the episode list from miruro.cx. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const queued = Object.values(useDownloads.getState().items).filter((d) => d.show.id === show.id).length;
  const body = (
    <View style={styles.sheet}>
      <T variant="title">Download {show.name}</T>
      <T dim style={{ marginTop: 4 }}>
        {total} episode{total === 1 ? '' : 's'}
        {queued ? `  ·  ${queued} already saved or queued` : ''}
      </T>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingTop: 8 }}>
        <Group label="Version">
          <Choice on={audio === 'sub'} label="Sub" note="Japanese audio, subtitles saved too" onPress={() => setAudio('sub')} first />
          <Choice on={audio === 'dub'} label="Dub" note="English audio" onPress={() => setAudio('dub')} />
        </Group>
        <Group label="Quality">
          {QUALITIES.map((x, i) => (
            <Choice key={String(x.id)} on={height === x.id} label={x.label} note={x.note} onPress={() => setHeight(x.id)} first={i === 0} />
          ))}
        </Group>
        <Group label="Episodes">
          <Choice on={which === 'all'} label="All episodes" onPress={() => setWhich('all')} first />
          <Choice on={which === 'unwatched'} label="Ones I haven’t finished" onPress={() => setWhich('unwatched')} />
          <Choice on={which === 'remaining'} label="From where I am onwards" onPress={() => setWhich('remaining')} />
        </Group>
      </ScrollView>
      <T variant="caption" faint style={{ marginTop: 12 }}>
        About {formatBytes(per)} an episode{free ? `  ·  ${formatBytes(free)} free on this device` : ''}
      </T>
      <T variant="caption" faint style={{ marginTop: 4 }}>
        Downloads run while Kitsune is open and carry on from where they stopped next time.
      </T>
      {error ? (
        <T variant="caption" color={color.danger} style={{ marginTop: 8 }}>
          {error}
        </T>
      ) : null}
      <View style={styles.buttons}>
        <Button label={busy ? 'Adding…' : 'Download'} icon="download" size="sm" onPress={busy ? undefined : confirm} hasTVPreferredFocus />
        <Button label="Cancel" variant="secondary" size="sm" onPress={onClose} />
      </View>
    </View>
  );

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
        {isTV ? (
          <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
            {body}
          </TVFocusGuideView>
        ) : (
          body
        )}
      </View>
    </Modal>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <T variant="micro" color={color.accent}>
        {label}
      </T>
      <View style={{ marginTop: 6 }}>{children}</View>
    </View>
  );
}

function Choice({ on, label, note, onPress, first }: { on: boolean; label: string; note?: string; onPress: () => void; first?: boolean }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress} style={({ pressed, focused }) => [styles.choice, !first && styles.rule, pressed && { opacity: 0.6 }, focused && styles.focused]}>
      <Icon name={on ? 'radiobox-marked' : 'radiobox-blank'} size={isTV ? tv(22) : 20} tint={on ? color.accent : color.textDim} />
      <T style={{ flex: 1 }}>{label}</T>
      {note ? (
        <T variant="caption" faint numberOfLines={1} style={{ maxWidth: '55%', textAlign: 'right' }}>
          {note}
        </T>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: { width: isTV ? tv(620) : 420, maxWidth: '100%', maxHeight: isTV ? '90%' : 640, borderRadius: radius.xl, backgroundColor: color.container2, padding: isTV ? tv(28) : 22 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: isTV ? tv(48) : 46, paddingHorizontal: 8, borderRadius: radius.sm },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  focused: { backgroundColor: 'rgba(255,255,255,0.12)' },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 18 },
});
