import type { ImageSource } from 'expo-image';
import type { ImageSet } from './api';

const CDN = 'https://anime.delivery';

/** Size keys per artwork type, largest first. */
export const SIZES = {
  poster: ['1560x2340', '640x960', '480x720', '240x360'],
  background: ['3840x2160', '1920x1080', '1360x768', '960x540'],
  backdrop: ['3840x1524', '1920x762', '1360x540', '960x380'],
  episode: ['1920x1080', '1280x720', '1024x576', '640x360'],
  logo: ['large', 'medium', 'small'],
} as const;

type Kind = keyof typeof SIZES;

function pick(map: Record<string, string> | undefined, kind: Kind, size: string) {
  if (!map) return undefined;
  if (map[size]) return map[size];
  const order = SIZES[kind] as readonly string[];
  // Fall back to the nearest smaller size, then anything at all.
  const i = order.indexOf(size);
  for (const k of order.slice(Math.max(i, 0))) if (map[k]) return map[k];
  return Object.values(map)[0];
}

export function imgUrl(set: ImageSet | undefined, kind: Kind, size: string): string | undefined {
  const path = pick(set?.resized, kind, size);
  return path ? CDN + path : undefined;
}

/** Image + blurred low-res placeholder, ready for expo-image's `source` / `placeholder`. */
export function art(set: ImageSet | undefined, kind: Kind, size: string) {
  const uri = imgUrl(set, kind, size);
  const smallest = SIZES[kind][SIZES[kind].length - 1];
  const blur = pick(set?.resized_blur, kind, smallest);
  return {
    source: uri ? ({ uri } satisfies ImageSource) : undefined,
    placeholder: blur ? ({ uri: CDN + blur } satisfies ImageSource) : undefined,
  };
}

export const webUrl = (path: string) => `https://anime.nexus${path}`;
