/**
 * Subtitle cues from WebVTT, SRT and ASS/SSA files, drawn by the player over the video for streams
 * whose subtitles come as separate files. Pure, so `scripts/check-miruro.mjs` can test it.
 *
 * The format is read from the content, never from the API's `format` field: icarus serves ASS
 * files labelled "vtt" (behind .jpeg URLs).
 */

/** `top`: the line belongs at the top of the picture (a sign, or dialogue moved up out of the way). */
export type Cue = { start: number; end: number; text: string; top?: boolean };

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function seconds(stamp: string) {
  const m = stamp.match(TIME);
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

function entities(text: string) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, '’')
    .replace(/&quot;/g, '"');
}

export function sniffFormat(source: string): 'vtt' | 'ass' | 'srt' {
  const head = source.replace(/^﻿/, '').trimStart();
  if (head.startsWith('WEBVTT')) return 'vtt';
  if (/^\[Script Info\]/im.test(head) || /^\[Events\]/im.test(head)) return 'ass';
  return 'srt';
}

export function parseCues(source: string): Cue[] {
  return sniffFormat(source) === 'ass' ? parseAss(source) : parseBlocks(source);
}

/** WebVTT and SRT: blocks separated by blank lines, each with a `start --> end` line. */
function parseBlocks(source: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at].split('-->');
    const start = seconds(a);
    const end = seconds(b);
    const top = /\bline:\s*(\d+)%/.test(b) ? Number(b.match(/\bline:\s*(\d+)%/)![1]) < 40 : /\{\\an[789]\}/.test(block);
    const text = entities(
      lines
        .slice(at + 1)
        .join('\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\{\\[^}]*\}/g, ''),
    ).trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) cues.push(top ? { start, end, text, top } : { start, end, text });
  }
  return cues.sort((x, y) => x.start - y.start);
}

const DEFAULT_EVENT_FORMAT = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];

/**
 * ASS/SSA: the `[Events]` section's `Dialogue:` lines, in the field order its `Format:` line gives
 * (Text is always last and may itself contain commas). Typeset signs placed with \pos or \move and
 * vector drawings (\p1) are dropped: without the styling engine they'd pile up as stray text.
 */
export function parseAss(source: string): Cue[] {
  const cues: Cue[] = [];
  const seen = new Set<string>();
  const topStyles = new Set<string>();
  let section = '';
  let styleFormat: string[] = [];
  let format = DEFAULT_EVENT_FORMAT;
  for (const raw of source.replace(/^﻿/, '').split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.toLowerCase();
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const kind = line.slice(0, colon).trim().toLowerCase();
    const rest = line.slice(colon + 1);
    if (section.includes('styles')) {
      if (kind === 'format') styleFormat = rest.split(',').map((f) => f.trim().toLowerCase());
      else if (kind === 'style') {
        const fields = rest.split(',').map((f) => f.trim());
        const align = Number(fields[styleFormat.indexOf('alignment')]);
        // Alignment 7-9 is the top row (numpad layout).
        if (align >= 7 && align <= 9) topStyles.add(fields[styleFormat.indexOf('name')]?.toLowerCase() ?? '');
      }
      continue;
    }
    if (section !== '[events]') continue;
    if (kind === 'format') {
      const f = rest.split(',').map((x) => x.trim().toLowerCase());
      if (f.includes('start') && f.includes('end') && f.includes('text')) format = f;
      continue;
    }
    if (kind !== 'dialogue') continue;
    // Split into exactly format.length fields: the last (Text) keeps any commas.
    const fields: string[] = [];
    let from = 0;
    for (let i = 0; i < format.length - 1; i++) {
      const comma = rest.indexOf(',', from);
      if (comma < 0) break;
      fields.push(rest.slice(from, comma).trim());
      from = comma + 1;
    }
    if (fields.length !== format.length - 1) continue;
    fields.push(rest.slice(from));
    const get = (name: string) => fields[format.indexOf(name)] ?? '';
    const start = seconds(get('start'));
    const end = seconds(get('end'));
    const body = get('text');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (/\{[^}]*\\p[1-9]/.test(body) || /\\(pos|move)\s*\(/.test(body)) continue;
    const text = entities(
      body
        .replace(/\\[Nn]/g, '\n')
        .replace(/\\h/g, ' ')
        .replace(/\{[^}]*\}/g, ''),
    )
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
    if (!text) continue;
    const top = /\{[^}]*\\an[789]/.test(body) || topStyles.has(get('style').toLowerCase());
    const key = `${start}|${end}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cues.push(top ? { start, end, text, top } : { start, end, text });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** The cues on screen at `t`, split by position (overlapping cues are stacked). */
export function cuesAt(cues: Cue[], t: number): { bottom: string; top: string } {
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  const bottom: string[] = [];
  const top: string[] = [];
  // Cues are short; looking back a few dozen covers any that are still running.
  for (let i = Math.max(0, lo - 40); i < lo; i++) if (cues[i].end > t) (cues[i].top ? top : bottom).push(cues[i].text);
  return { bottom: bottom.join('\n'), top: top.join('\n') };
}

/** The bottom text on screen at `t` (kept for callers that only draw one line block). */
export function cueAt(cues: Cue[], t: number): string {
  return cuesAt(cues, t).bottom;
}
