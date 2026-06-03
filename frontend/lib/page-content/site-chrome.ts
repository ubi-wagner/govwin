import type { SeedPage } from './types';
import { DEFAULT_CHROME } from '@/lib/site-chrome';

/** site-chrome — the marketing header + footer. One 'chrome' block whose metadata
 *  holds the banner / nav / footer structure (edited as JSON in the block editor;
 *  the layout merges it over DEFAULT_CHROME). */
export const siteChrome: SeedPage = {
  pageKey: 'site-chrome',
  title: 'Site Chrome (header & footer)',
  blocks: [
    {
      section: 'chrome',
      displayOrder: 0,
      title: 'Header & footer',
      body: 'Launch banner, navigation, and footer. Edit the links and labels in the metadata JSON below.',
      metadata: {
        banner: DEFAULT_CHROME.banner,
        nav: DEFAULT_CHROME.nav,
        footer: DEFAULT_CHROME.footer,
      },
    },
  ],
};
