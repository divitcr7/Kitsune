import { type Cue, parseCues } from '../subtitles';
import type { PlaySubtitle } from './api';
import type { ProxyEnv } from './codec';
import { type Candidate, subtitleSources } from './streams';

const TIMEOUT = 8000;

/**
 * A subtitle file's cues, from the first source that answers with something readable (see
 * `subtitleSources`). Throws when none does, so callers can say so.
 */
export async function fetchCues(sub: PlaySubtitle, c: Pick<Candidate, 'proxied' | 'headers' | 'referer'>, env: ProxyEnv | null, signal?: AbortSignal): Promise<Cue[]> {
  for (const source of subtitleSources(sub, c, env)) {
    if (signal?.aborted) break;
    const ctrl = new AbortController();
    const stop = () => ctrl.abort();
    signal?.addEventListener('abort', stop, { once: true });
    const id = setTimeout(stop, TIMEOUT);
    try {
      const res = await fetch(source.uri, { headers: source.headers, signal: ctrl.signal });
      if (!res.ok) continue;
      const cues = parseCues(await res.text());
      if (cues.length) return cues;
    } catch {
      // Try the next source.
    } finally {
      clearTimeout(id);
      signal?.removeEventListener('abort', stop);
    }
  }
  throw new Error(`Couldn’t load the ${sub.label} subtitles`);
}
