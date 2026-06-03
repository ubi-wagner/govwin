/**
 * Registry of marketing-page seed defaults (V8). See ./types.ts.
 *
 * Every page that renders from content_pages should have an entry here so the
 * admin editor can seed it (never blank) and the Site Content list can show it.
 */
import type { SeedPage } from './types';
import { about } from './about';

export const PAGE_SEEDS: Record<string, SeedPage> = {
  about,
};

export const SEED_PAGE_KEYS: string[] = Object.keys(PAGE_SEEDS);

export type { SeedPage } from './types';
