/**
 * Registry of marketing-page seed defaults (V8). See ./types.ts.
 *
 * Every page that renders from content_pages has an entry here so the admin
 * editor can seed it (never blank) and the Site Content list can show it.
 */
import type { SeedPage } from './types';
import { about } from './about';
import { homepage } from './homepage';
import { value } from './value';
import { theExpert } from './theExpert';
import { apply } from './apply';
import { features } from './features';
import { howItWorks } from './howItWorks';
import { infosec } from './infosec';
import { pricing } from './pricing';
import { team } from './team';
import { customers } from './customers';
import { resources } from './resources';
import { federalRd101 } from './federal-rd-101';
import { siteChrome } from './site-chrome';

export const PAGE_SEEDS: Record<string, SeedPage> = {
  [homepage.pageKey]: homepage,
  [about.pageKey]: about,
  [value.pageKey]: value,
  [theExpert.pageKey]: theExpert,
  [apply.pageKey]: apply,
  [features.pageKey]: features,
  [howItWorks.pageKey]: howItWorks,
  [infosec.pageKey]: infosec,
  [pricing.pageKey]: pricing,
  [team.pageKey]: team,
  [customers.pageKey]: customers,
  [resources.pageKey]: resources,
  [federalRd101.pageKey]: federalRd101,
  [siteChrome.pageKey]: siteChrome,
};

export const SEED_PAGE_KEYS: string[] = Object.keys(PAGE_SEEDS);

export type { SeedPage } from './types';
