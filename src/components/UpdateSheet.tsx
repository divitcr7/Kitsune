import { useEffect } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '@/lib/player';
import { appVersion, isDownloaded, useUpdates } from '@/lib/updates';
import { color, radius } from '@/theme/tokens';
import { Button } from './Button';
import { ProgressBar } from './EpisodeCard';
import { Fox } from './Logo';
import { T } from './T';

/** Checks GitHub for a newer release now and then, and offers it in a sheet when there is one. */
export function UpdateSheet() {
  const insets = useSafeAreaInsets();
  const { release, status, progress, error, prompt, check, update, later } = useUpdates();
  const playing = usePlayer((s) => s.visible);

  useEffect(() => {
    // Give the app a moment to settle before going to the network.
    const first = setTimeout(() => check(), 5000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, [check]);

  if (!prompt || !release || playing) return null;
  const busy = status === 'downloading' || status === 'installing';
  const mb = Math.round(release.apk.size / 1_000_000);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={[StyleSheet.absoluteFill, styles.scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : later} accessibilityLabel="Later" />
      </Animated.View>
      <Animated.View
        entering={SlideInDown.duration(280).easing(Easing.out(Easing.cubic))}
        exiting={SlideOutDown.duration(200)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}
      >
        <View style={styles.head}>
          <Fox size={44} />
          <View style={{ flex: 1 }}>
            <T variant="title">Kitsune {release.version} is here</T>
            <T variant="caption" faint style={{ marginTop: 2 }}>
              You have {appVersion}  ·  {mb} MB download
            </T>
          </View>
        </View>

        {release.notes ? (
          <T dim numberOfLines={8} style={styles.notes}>
            {release.notes}
          </T>
        ) : null}

        {busy ? (
          <View style={styles.progress}>
            <ProgressBar value={Math.max(0.02, progress)} style={{ height: 4 }} />
            <T variant="caption" dim style={{ marginTop: 8 }}>
              {status === 'installing' ? 'Opening the installer…' : `Downloading… ${Math.round(progress * 100)}%`}
            </T>
          </View>
        ) : (
          <>
            {error ? (
              <T variant="caption" color={color.danger} style={{ marginTop: 14 }}>
                {error}
              </T>
            ) : null}
            <Button
              label={error ? 'Try again' : isDownloaded(release) ? 'Install update' : 'Update now'}
              icon="download"
              size="lg"
              onPress={update}
              style={{ marginTop: 18 }}
            />
            <Button label="Later" variant="text" size="sm" onPress={later} style={{ alignSelf: 'center', marginTop: 6 }} />
          </>
        )}

        <T variant="caption" faint style={styles.foot}>
          Downloaded from Kitsune’s GitHub releases and checked before installing. Android asks once to allow installs from Kitsune. Your list and history stay.
        </T>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingTop: 24,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: color.container1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  notes: { marginTop: 16, lineHeight: 21 },
  progress: { marginTop: 22 },
  foot: { marginTop: 14, lineHeight: 17, textAlign: 'center' },
});
