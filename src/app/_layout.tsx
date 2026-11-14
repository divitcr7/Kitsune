import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { router, Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { iconFont } from '@/components/Icon';
import { DownloadsHost } from '@/components/DownloadsHost';
import { Intro } from '@/components/Intro';
import { MiruroBridge } from '@/components/MiruroBridge';
import { PlayerHost } from '@/components/Player';
import { UpdateSheet } from '@/components/UpdateSheet';
import { useDownloads } from '@/lib/downloads/store';
import { runMigration } from '@/lib/migrateRun';
import { checkSoon, setupNotifications } from '@/lib/notify';
import { useStore } from '@/lib/store';
import { queryClient } from '@/lib/queries';
import { isTV } from '@/lib/tv';
import { color } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 200, fade: true });

// Coming back to Kitsune counts as focus: stale lists refresh (and the bridge reopens if needed).
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
  return () => sub.remove();
});

const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'kitsune-cache', throttleTime: 2000 });

export default function RootLayout() {
  const [restored, setRestored] = useState(false);
  const [fonts] = useFonts(iconFont);

  // Data saved before 1.3 (anime.nexus ids): once both stores have loaded, finish moving it onto
  // miruro.cx in the background, after home has had its turn with the network.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = () => {
      if (!useStore.persist.hasHydrated() || !useDownloads.persist.hasHydrated()) return;
      clearTimeout(timer);
      timer = setTimeout(() => runMigration(), 4000);
    };
    go();
    const a = useStore.persist.onFinishHydration(go);
    const b = useDownloads.persist.onFinishHydration(go);
    return () => {
      clearTimeout(timer);
      a();
      b();
    };
  }, []);

  // Notifications: channels and the background check; a tap opens the show (or Downloads).
  useEffect(() => {
    setupNotifications();
    checkSoon();
    const open = (data: Record<string, unknown> | undefined) => {
      if (typeof data?.showId === 'string') {
        // Alerts from before 1.3 carry anime.nexus ids.
        const id = useStore.getState().moved[data.showId] ?? data.showId;
        router.push({ pathname: '/show/[id]', params: { id } });
      }
      else if (data?.screen === 'downloads') router.push('/downloads');
    };
    const first = Notifications.getLastNotificationResponse();
    if (first) setTimeout(() => open(first.notification.request.content.data), 600);
    const tap = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    const app = AppState.addEventListener('change', (st) => {
      if (st === 'active') checkSoon();
    });
    return () => {
      tap.remove();
      app.remove();
    };
  }, []);

  // Phones are portrait apart from the player. The manifest no longer says so (a portrait-only
  // app shows up sideways on some TV boxes), so lock it here; a TV keeps its own orientation.
  useEffect(() => {
    if (!isTV) ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 7 * 24 * 60 * 60_000,
          // Bumped when the cached data's shape changes (m1: the catalog moved to miruro.cx).
          buster: 'm1',
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => query.meta?.persist === true && query.state.status === 'success',
          },
        }}
        onSuccess={() => setRestored(true)}
        onError={() => setRestored(true)}
      >
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.bg },
            animation: isTV ? 'fade' : 'fade_from_bottom',
            gestureEnabled: !isTV,
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="show/[id]" />
          <Stack.Screen name="genre/[id]" />
          <Stack.Screen name="downloads" />
        </Stack>
        <UpdateSheet />
        <PlayerHost />
        <MiruroBridge />
        <DownloadsHost />
        <Intro ready={restored && fonts} />
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
});
