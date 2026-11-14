import { requireOptionalNativeModule } from 'expo';

type KitsuneDownloadsNative = {
  start(title: string, text: string): boolean;
  update(title: string, text: string, progress: number): boolean;
  stop(): boolean;
  isRunning(): boolean;
};

/** The Android foreground service for downloads (null where it doesn't exist, e.g. an old build). */
export const KitsuneDownloads = requireOptionalNativeModule<KitsuneDownloadsNative>('KitsuneDownloads');
