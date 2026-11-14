/**
 * Reading and writing HLS playlists, for locking a quality and for downloads. Pure (no URL class,
 * which React Native only half implements), so `scripts/check-miruro.mjs` can test it.
 */

export type Variant = { uri: string; bandwidth: number; width: number; height: number; codecs?: string; audioGroup?: string; line: string };
export type Media = { type: string; groupId: string; name: string; language?: string; isDefault: boolean; uri?: string; line: string };
export type Segment = { uri: string; duration: number };
export type MediaPlaylist = { segments: Segment[]; map?: string; encrypted: boolean; byteRange: boolean; ended: boolean };

/** `ref` against the playlist URL `base`, as a browser would resolve a link. */
export function resolveUri(base: string, ref: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return ref;
  const scheme = base.match(/^([a-z][a-z0-9+.-]*:)/i)?.[1] ?? 'https:';
  if (ref.startsWith('//')) return scheme + ref;
  const clean = base.replace(/[?#].*$/, '');
  const origin = clean.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i)?.[0] ?? '';
  if (ref.startsWith('/')) return origin + ref;
  const [refPath, refQuery = ''] = splitQuery(ref);
  const dir = clean.slice(origin.length).replace(/[^/]*$/, '') || '/';
  const parts: string[] = [];
  for (const p of (dir + refPath).split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  let path = parts.join('/');
  if (!path.startsWith('/')) path = `/${path}`;
  return origin + path + refQuery;
}

function splitQuery(ref: string): [string, string] {
  const i = ref.search(/[?#]/);
  return i < 0 ? [ref, ''] : [ref.slice(0, i), ref.slice(i)];
}

/** An attribute list: KEY=VALUE,KEY="quoted, value". */
export function attrs(line: string): Record<string, string> {
  const body = line.slice(line.indexOf(':') + 1);
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
  return out;
}

function setAttr(line: string, key: string, value: string, quoted: boolean): string {
  const v = quoted ? `"${value}"` : value;
  const re = new RegExp(`([:,])${key}=("[^"]*"|[^,]*)`);
  if (re.test(line)) return line.replace(re, (_m, sep: string) => `${sep}${key}=${v}`);
  return `${line},${key}=${v}`;
}

function dropAttr(line: string, key: string): string {
  return line.replace(new RegExp(`,${key}=("[^"]*"|[^,]*)`), '').replace(new RegExp(`:${key}=("[^"]*"|[^,]*),?`), ':');
}

function lines(text: string) {
  return text.replace(/^﻿/, '').split(/\r\n?|\n/).map((l) => l.trim());
}

/** The renditions of a master playlist, or null if `text` is a media playlist. */
export function parseMaster(text: string, base: string): { variants: Variant[]; media: Media[] } | null {
  const all = lines(text);
  if (!all.some((l) => l.startsWith('#EXT-X-STREAM-INF'))) return null;
  const variants: Variant[] = [];
  const media: Media[] = [];
  for (let i = 0; i < all.length; i++) {
    const l = all[i];
    if (l.startsWith('#EXT-X-MEDIA:')) {
      const a = attrs(l);
      media.push({ type: a.TYPE ?? '', groupId: a['GROUP-ID'] ?? '', name: a.NAME ?? '', language: a.LANGUAGE, isDefault: a.DEFAULT === 'YES', uri: a.URI ? resolveUri(base, a.URI) : undefined, line: l });
    } else if (l.startsWith('#EXT-X-STREAM-INF:')) {
      let j = i + 1;
      while (j < all.length && (!all[j] || all[j].startsWith('#'))) j++;
      if (j >= all.length) continue;
      const a = attrs(l);
      const [w, h] = (a.RESOLUTION ?? '').split('x').map(Number);
      variants.push({ uri: resolveUri(base, all[j]), bandwidth: Number(a.BANDWIDTH) || 0, width: w || 0, height: h || 0, codecs: a.CODECS, audioGroup: a.AUDIO, line: l });
      i = j;
    }
  }
  return { variants, media };
}

/** The best variant at or under `want` lines (the lowest one if none fits); 'best' is the top one. */
export function pickVariant(variants: Variant[], want: 'best' | number): Variant {
  const sorted = [...variants].sort((a, b) => a.height - b.height || a.bandwidth - b.bandwidth);
  if (want === 'best') return sorted[sorted.length - 1];
  const fit = sorted.filter((v) => v.height && v.height <= want);
  return fit.length ? fit[fit.length - 1] : sorted[0];
}

/** Distinct heights on offer, highest first (for a quality menu). */
export function heights(variants: Variant[]): number[] {
  return [...new Set(variants.map((v) => v.height).filter(Boolean))].sort((a, b) => b - a);
}

/** The master with every alternative rendition kept but only one video variant, all URIs absolute. */
export function pinnedMaster(text: string, base: string, v: Variant): string {
  const out = ['#EXTM3U'];
  for (const l of lines(text)) {
    if (l.startsWith('#EXT-X-VERSION') || l.startsWith('#EXT-X-INDEPENDENT-SEGMENTS')) out.push(l);
    else if (l.startsWith('#EXT-X-MEDIA:')) {
      const a = attrs(l);
      out.push(a.URI ? setAttr(l, 'URI', resolveUri(base, a.URI), true) : l);
    }
  }
  out.push(v.line, v.uri);
  return `${out.join('\n')}\n`;
}

export function parseMedia(text: string, base: string): MediaPlaylist {
  const segments: Segment[] = [];
  let map: string | undefined;
  let encrypted = false;
  let byteRange = false;
  let ended = false;
  let duration = 0;
  for (const l of lines(text)) {
    if (!l) continue;
    if (l.startsWith('#EXTINF:')) duration = parseFloat(l.slice(8)) || 0;
    else if (l.startsWith('#EXT-X-KEY:')) encrypted = encrypted || (attrs(l).METHOD ?? 'NONE') !== 'NONE';
    else if (l.startsWith('#EXT-X-MAP:')) map = attrs(l).URI ? resolveUri(base, attrs(l).URI) : undefined;
    else if (l.startsWith('#EXT-X-BYTERANGE')) byteRange = true;
    else if (l.startsWith('#EXT-X-ENDLIST')) ended = true;
    else if (!l.startsWith('#')) {
      segments.push({ uri: resolveUri(base, l), duration });
      duration = 0;
    }
  }
  return { segments, map, encrypted, byteRange, ended };
}

/** A VOD media playlist over local files named by `segName`. */
export function localMedia(p: MediaPlaylist, segName: (i: number) => string, mapName?: string): string {
  const target = Math.max(1, Math.ceil(Math.max(0, ...p.segments.map((s) => s.duration))));
  const out = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${target}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
  if (p.map && mapName) out.push(`#EXT-X-MAP:URI="${mapName}"`);
  p.segments.forEach((s, i) => out.push(`#EXTINF:${s.duration.toFixed(3)},`, segName(i)));
  out.push('#EXT-X-ENDLIST');
  return `${out.join('\n')}\n`;
}

/**
 * A local master: the kept audio renditions (each pointing at its local playlist, exactly one of
 * them default) and the one video variant pointing at `videoFile`.
 */
export function localMaster(v: Variant, audio: { media: Media; file: string }[], videoFile: string): string {
  const out = ['#EXTM3U', '#EXT-X-INDEPENDENT-SEGMENTS'];
  const defaultIndex = Math.max(0, audio.findIndex((a) => a.media.isDefault));
  audio.forEach((a, i) => {
    let l = setAttr(a.media.line, 'URI', a.file, true);
    l = setAttr(l, 'DEFAULT', i === defaultIndex ? 'YES' : 'NO', false);
    l = setAttr(l, 'AUTOSELECT', 'YES', false);
    out.push(l);
  });
  out.push(audio.length ? v.line : dropAttr(v.line, 'AUDIO'), videoFile);
  return `${out.join('\n')}\n`;
}
