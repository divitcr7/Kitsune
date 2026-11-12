import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import { startActivityAsync } from 'expo-intent-launcher';
import { Platform } from 'react-native';
import { create } from 'zustand';

/**
 * Updates come from GitHub releases: a release tagged vX.Y.Z with a Kitsune-vX.Y.Z.apk attached
 * (and its .sha256). Android won't let a sideloaded app replace itself silently, so the best we can
 * do is notice, download in the app, check the file, and hand it to the system installer.
 */
const LATEST = 'https://api.github.com/repos/divitcr7/Kitsune/releases/latest';
// Only the app's own APK, matched by its exact name: any other file on a release is never installed.
const APK = /^Kitsune-v\d+\.\d+\.\d+\.apk$/;
const CHECK_EVERY = 6 * 60 * 60_000;
const SAVED = 'kitsune-update';

export const appVersion = Constants.expoConfig?.version ?? '0.0.0';
// The Test build workflow renames the package to app.kitsune.anime.test, so it installs beside Kitsune.
export const isTestBuild = (Constants.expoConfig?.android?.package ?? '').endsWith('.test');

export type Release = {
  version: string;
  notes: string;
  page: string;
  apk: { url: string; name: string; size: number };
  sha256?: string;
};

type Saved = { checkedAt?: number; dismissed?: string; release?: Release | null };
type Status = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'error';

type State = {
  /** A release newer than this build, if any. */
  release: Release | null;
  status: Status;
  progress: number;
  error: string | null;
  /** Whether the update sheet is showing. */
  prompt: boolean;
  check: (force?: boolean) => Promise<void>;
  update: () => Promise<void>;
  showPrompt: () => void;
  later: () => void;
};

/** true when version `a` is newer than `b` ("1.0.10" > "1.0.9"). */
export function isNewer(a: string, b: string) {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

/** Release notes as a few plain lines: no images, links, headings or emphasis marks. */
function plain(md?: string) {
  return (md ?? '')
    .split('\n')
    .map((l) =>
      l
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s*[-*]\s+/, '• ')
        .replace(/[#*_`>]/g, '')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 8)
    .join('\n');
}

async function readSaved(): Promise<Saved> {
  try {
    return JSON.parse((await AsyncStorage.getItem(SAVED)) ?? '{}');
  } catch {
    return {};
  }
}

const updatesDir = () => new Directory(Paths.cache, 'updates');

/** The release's APK is already on the phone (the installer was dismissed earlier). */
export function isDownloaded(r: Release) {
  try {
    const f = new File(updatesDir(), r.apk.name);
    return f.exists && f.size === r.apk.size;
  } catch {
    return false;
  }
}

export const useUpdates = create<State>((set, get) => ({
  release: null,
  status: 'idle',
  progress: 0,
  error: null,
  prompt: false,

  check: async (force = false) => {
    if (Platform.OS !== 'android') return;
    const { status } = get();
    if (status === 'checking' || status === 'downloading' || status === 'installing') return;
    const saved = await readSaved();
    const known = saved.release && isNewer(saved.release.version, appVersion) ? saved.release : null;

    // A finished update leaves its APK behind; clear it once nothing newer is pending.
    if (!known) {
      try {
        const dir = updatesDir();
        if (dir.exists) dir.delete();
      } catch {}
    }

    if (!force && saved.checkedAt && Date.now() - saved.checkedAt < CHECK_EVERY) {
      if (known) set({ release: known, status: 'available', prompt: saved.dismissed !== known.version });
      return;
    }

    set({ status: 'checking', error: null });
    try {
      const res = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      const assets: { name: string; browser_download_url: string; size: number }[] = j.assets ?? [];
      const apk = assets.find((a) => APK.test(a.name));
      const sum = apk && assets.find((a) => a.name === `${apk.name}.sha256`);
      const version = String(j.tag_name ?? '').replace(/^v/, '');
      const release: Release | null =
        apk && isNewer(version, appVersion)
          ? { version, notes: plain(j.body), page: j.html_url, apk: { url: apk.browser_download_url, name: apk.name, size: apk.size }, sha256: sum?.browser_download_url }
          : null;
      await AsyncStorage.setItem(SAVED, JSON.stringify({ ...saved, checkedAt: Date.now(), release }));
      set({
        release,
        status: release ? 'available' : 'current',
        prompt: !!release && (force || saved.dismissed !== release.version),
      });
    } catch {
      set({ status: force ? 'error' : known ? 'available' : 'idle', release: known, error: force ? 'Couldn’t reach GitHub. Try again in a bit.' : null });
    }
  },

  update: async () => {
    const r = get().release;
    if (!r || get().status === 'downloading') return;
    set({ status: 'downloading', progress: 0, error: null });
    try {
      const dir = updatesDir();
      let file = new File(dir, r.apk.name);
      // Already downloaded (the installer was dismissed, e.g. to allow installs): reuse it.
      if (!isDownloaded(r)) {
        if (dir.exists) dir.delete();
        dir.create({ idempotent: true });
        file = new File(dir, r.apk.name);
        let shown = 0;
        await File.downloadFileAsync(r.apk.url, file, {
          idempotent: true,
          onProgress: ({ bytesWritten, totalBytes }) => {
            const p = totalBytes ? bytesWritten / totalBytes : 0;
            if (p - shown >= 0.01) {
              shown = p;
              set({ progress: p });
            }
          },
        });
      }
      if (r.sha256) {
        const expected = (await (await fetch(r.sha256)).text()).trim().split(/\s+/)[0]?.toLowerCase();
        const actual = await file.digest('SHA-256');
        if (expected && actual !== expected) {
          file.delete();
          throw new Error('The download didn’t match its checksum. Try again.');
        }
      }
      set({ status: 'installing', progress: 1 });
      // Android shows its installer; the first time it asks to allow installs from Kitsune.
      await startActivityAsync('android.intent.action.VIEW', {
        data: await getContentUriAsync(file.uri),
        type: 'application/vnd.android.package-archive',
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      });
      // Back here means the installer was dismissed (or install permission wasn't granted yet).
      set({ status: 'available' });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error && e.message.includes('checksum') ? e.message : 'The update didn’t download. Check your connection and try again.' });
    }
  },

  showPrompt: () => set({ prompt: true }),

  later: () => {
    const r = get().release;
    set({ prompt: false, status: r ? 'available' : get().status, error: null });
    if (r) readSaved().then((saved) => AsyncStorage.setItem(SAVED, JSON.stringify({ ...saved, dismissed: r.version })));
  },
}));
