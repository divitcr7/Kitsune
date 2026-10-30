import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { iconFont } from '@/components/Icon';
import { Intro } from '@/components/Intro';
import { PlayerHost } from '@/components/Player';
import { UpdateSheet } from '@/components/UpdateSheet';
import { queryClient } from '@/lib/queries';
import { color } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 200, fade: true });

const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'kitsune-cache', throttleTime: 2000 });

export default function RootLayout() {
  const [restored, setRestored] = useState(false);
  const [fonts] = useFonts(iconFont);

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
            animation: 'fade_from_bottom',
            gestureEnabled: true,
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="show/[id]" />
          <Stack.Screen name="genre/[id]" />
          <Stack.Screen name="account" options={{ animation: 'slide_from_bottom' }} />
        </Stack>
        <UpdateSheet />
        <PlayerHost />
        <Intro ready={restored && fonts} />
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
});
