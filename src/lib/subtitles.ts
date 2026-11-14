/**
 * WebVTT and SRT cues, drawn by the player over the video for streams whose subtitles come as
 * separate files. Pure, so `scripts/check-miruro.mjs` can test it.
 */

export type Cue = { start: number; end: number; text: string };

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function seconds(stamp: string) {
  const m = stamp.match(TIME);
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

function clean(text: string) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, '’')
    .replace(/&quot;/g, '"')
    .trim();
}

/** Both formats are blocks separated by blank lines with a `start --> end` line; that's all we need. */
export function parseCues(source: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at].split('-->');
    const start = seconds(a);
    const end = seconds(b);
    const text = clean(lines.slice(at + 1).join('\n'));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) cues.push({ start, end, text });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** The text on screen at `t` (overlapping cues are stacked). */
export function cueAt(cues: Cue[], t: number): string {
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  const out: string[] = [];
  // Cues are short; looking back a few covers any that are still running.
  for (let i = Math.max(0, lo - 8); i < lo; i++) if (cues[i].end > t) out.push(cues[i].text);
  return out.join('\n');
}
