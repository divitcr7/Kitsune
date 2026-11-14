import type { ImageSource } from 'expo-image';
import type { ImageSet } from './api';

/** Size keys per artwork type, largest first (the size asked for picks a smaller copy where a host has one). */
export const SIZES = {
  poster: ['1560x2340', '640x960', '480x720', '240x360'],
  background: ['3840x2160', '1920x1080', '1360x768', '960x540'],
  backdrop: ['3840x1524', '1920x762', '1360x540', '960x380'],
  episode: ['1920x1080', '1280x720', '1024x576', '640x360'],
  logo: ['large', 'medium', 'small'],
} as const;

type Kind = keyof typeof SIZES;

/**
 * miruro's artwork is full-size: AniList covers and banners, and TMDB backdrops, logos and episode
 * stills at their original size. TMDB serves smaller copies by path, which keeps rails light on
 * phones and TV boxes; AniList's covers are already a sensible size.
 */
function sized(url: string, kind: Kind, size: string): string {
  const m = url.match(/^(https:\/\/image\.tmdb\.org\/t\/p\/)original(\/.+)$/);
  if (!m) return url;
  const width = Number(size.split('x')[0]) || 0;
  let w: string;
  if (kind === 'logo') w = size === 'small' ? 'w300' : 'w500';
  else if (width >= 1900) w = 'original';
  else if (width >= 1200) w = 'w1280';
  else if (width >= 700) w = 'w780';
  else w = 'w500';
  return `${m[1]}${w}${m[2]}`;
}

export function imgUrl(set: ImageSet | undefined, kind: Kind, size: string): string | undefined {
  return set?.original ? sized(set.original, kind, size) : undefined;
}

/** Image source for expo-image's `source` (miruro has no blurred placeholders). */
export function art(set: ImageSet | undefined, kind: Kind, size: string) {
  const uri = imgUrl(set, kind, size);
  return { source: uri ? ({ uri } satisfies ImageSource) : undefined, placeholder: undefined };
}

/** A show's page on miruro.cx, for sharing. */
export const showUrl = (id: string) => `https://www.miruro.cx/info/${id}`;
