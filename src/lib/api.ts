import { createCatalog } from './catalog';
import { miruroGet } from './miruro/bridge';

/**
 * The app's catalog: miruro.cx (lib/catalog.ts), asked through the hidden browser tab on the site
 * (lib/miruro/bridge.ts), since miruro's API only answers browsers. Browsing requests go in the
 * bridge's interactive lane.
 */
export type { Episode, Genre, ImageSet, LatestItem, Page, Resized, Show, Stats, VideoMeta } from './catalog';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const api = createCatalog((path, signal) => miruroGet(path, signal));
