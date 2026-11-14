import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
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
import { checkSoon, setupNotifications } from '@/lib/notify';
import { queryClient } from '@/lib/queries';
import { isTV } from '@/lib/tv';
import { color } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 200, fade: true });

const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'kitsune-cache', throttleTime: 2000 });

export default function RootLayout() {
  const [restored, setRestored] = useState(false);
  const [fonts] = useFonts(iconFont);

  // Notifications: channels and the background check; a tap opens the show (or Downloads).
  useEffect(() => {
    setupNotifications();
    checkSoon();
    const open = (data: Record<string, unknown> | undefined) => {
      if (typeof data?.showId === 'string') router.push({ pathname: '/show/[id]', params: { id: data.showId } });
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
          buster: 'v1',
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
          <Stack.Screen name="account" options={{ animation: 'slide_from_bottom' }} />
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
