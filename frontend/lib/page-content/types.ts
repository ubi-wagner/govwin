/**
 * Seed defaults for marketing pages (V8).
 *
 * Single source of truth for each page's default blocks. Used to (a) seed
 * content_pages so the admin editor is never blank, and (b) act as the in-code
 * fallback the public page renders when a block is missing. Editing a seeded
 * page in /admin/site overrides these; publishing makes the override live.
 *
 * Keep block `section` values in sync with the `lookup[...]` keys the page reads.
 * In title/heading fields, `*phrase*` renders as an accent span and `\n` as a
 * line break (see components/marketing/rich-text.tsx).
 */
import type { PageBlock } from '@/lib/content-admin';

export interface SeedPage {
  pageKey: string;
  title: string;
  blocks: PageBlock[];
}
