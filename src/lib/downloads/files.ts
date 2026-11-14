import { Directory, File, Paths } from 'expo-file-system';
import type { Cue } from '../subtitles';
import type { DownloadItem } from './store';

/**
 * Where downloads live on the device:
 *
 *   <documents>/downloads/<safe id>/
 *     plan.json      the stream chosen and every segment's URL (lets an interrupted download resume)
 *     v/00000.ts …   video segments (.part while in flight)
 *     a0/ a1/        audio renditions, when the stream keeps audio separately
 *     video.m3u8, a0.m3u8 …   local playlists
 *     subs/0.json    subtitle cues
 *     master.m3u8    written last: its presence means the download is complete
 */

export function downloadsRoot() {
  return new Directory(Paths.document, 'downloads');
}

export function safeId(id: string) {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function dirFor(id: string) {
  return new Directory(downloadsRoot(), safeId(id));
}

export function ensureDir(dir: Directory) {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
}

export function localMasterFile(id: string) {
  return new File(dirFor(id), 'master.m3u8');
}

/** Done in the store and its files are really there (they can be cleared by the system or a reinstall). */
export function isPlayable(item?: DownloadItem): boolean {
  if (!item || item.status !== 'done') return false;
  try {
    return localMasterFile(item.id).exists;
  } catch {
    return false;
  }
}

export function readCues(id: string, index: number): Cue[] {
  try {
    const f = new File(dirFor(id), 'subs', `${index}.json`);
    if (!f.exists) return [];
    const parsed = JSON.parse(f.textSync()) as { cues?: Cue[] };
    return Array.isArray(parsed.cues) ? parsed.cues : [];
  } catch {
    return [];
  }
}

export function removeFiles(id: string) {
  try {
    const dir = dirFor(id);
    if (dir.exists) dir.delete();
  } catch {
    // Already gone.
  }
}

/** Bytes a download takes on disk. */
export function sizeOf(id: string): number {
  try {
    const dir = dirFor(id);
    return dir.exists ? (dir.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** Half-written segments from a transfer that was cut off; they're fetched again. */
export function sweepParts(dir: Directory) {
  try {
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      if (entry instanceof Directory) sweepParts(entry);
      else if (entry.name.endsWith('.part')) entry.delete();
    }
  } catch {
    // Nothing to sweep.
  }
}

/** Download folders the store doesn't know about (e.g. a remove cut short), and their bytes. */
export function orphans(known: Set<string>): Directory[] {
  try {
    const root = downloadsRoot();
    if (!root.exists) return [];
    const safeKnown = new Set([...known].map(safeId));
    return root.list().filter((e): e is Directory => e instanceof Directory && !safeKnown.has(e.name));
  } catch {
    return [];
  }
}
