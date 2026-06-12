/**
 * Site chrome (marketing header + footer) as editable content (V8).
 *
 * The marketing layout renders header/footer from this object. DEFAULT_CHROME is
 * the current hand-built chrome; getSiteChrome() merges any overrides stored in
 * the content_pages 'site-chrome' page (one 'chrome' block whose metadata holds
 * { banner, nav, footer }). Every field falls back to the default, so a missing
 * or partial override always renders today's chrome — never a broken header.
 */
import { getPageBlocks } from '@/lib/cms';

export interface NavLink {
  label: string;
  href: string;
}
export interface NavGroup {
  label: string;
  items: NavLink[];
}
export interface FooterColumn {
  title: string;
  links: NavLink[];
}

export interface SiteChrome {
  banner: { tag: string; text: string; ctaLabel: string; ctaHref: string };
  nav: {
    groups: NavGroup[];
    links: NavLink[];
    applyLabel: string;
    applyHref: string;
    loginLabel: string;
    loginHref: string;
  };
  footer: {
    columns: FooterColumn[];
    ctaPrimary: NavLink;
    ctaSecondary: NavLink;
    copyright: string;
  };
}

export const DEFAULT_CHROME: SiteChrome = {
  banner: {
    tag: 'Now Accepting Applications',
    text: 'Founding Cohort · Platform launches July 2026',
    ctaLabel: 'Apply',
    ctaHref: '/apply',
  },
  nav: {
    groups: [
      {
        label: 'Platform',
        items: [
          { label: 'Why RFP Pipeline', href: '/value' },
          { label: 'Features', href: '/features' },
          { label: 'How It Works', href: '/how-it-works' },
          { label: 'The Expert', href: '/the-expert' },
          { label: 'Pricing', href: '/pricing' },
        ],
      },
    ],
    links: [
      { label: 'About', href: '/about' },
      { label: 'Resources', href: '/resources' },
      { label: 'Security', href: '/infosec' },
    ],
    applyLabel: 'Apply Now',
    applyHref: '/apply',
    loginLabel: 'Login',
    loginHref: '/login',
  },
  footer: {
    columns: [
      {
        title: 'Platform',
        links: [
          { label: 'Why RFP Pipeline', href: '/value' },
          { label: 'Features', href: '/features' },
          { label: 'How It Works', href: '/how-it-works' },
          { label: 'The Expert', href: '/the-expert' },
          { label: 'Pricing', href: '/pricing' },
        ],
      },
      {
        title: 'Company',
        links: [
          { label: 'About', href: '/about' },
          { label: 'Team', href: '/team' },
          { label: 'Track Record', href: '/customers' },
          { label: 'Why RFP Pipeline', href: '/value' },
        ],
      },
      {
        title: 'Resources',
        links: [
          { label: 'Resources', href: '/resources' },
          { label: 'Security & Data', href: '/infosec' },
        ],
      },
      {
        title: 'Legal',
        links: [
          { label: 'Terms of Service', href: '/legal/terms' },
          { label: 'Privacy Policy', href: '/legal/privacy' },
          { label: 'Acceptable Use', href: '/legal/acceptable-use' },
          { label: 'AI Disclosure', href: '/legal/ai-disclosure' },
        ],
      },
    ],
    ctaPrimary: { label: 'Apply for Founding Cohort', href: '/apply' },
    ctaSecondary: { label: 'Subscriber Login', href: '/login' },
    copyright: '© 2026 RFP Pipeline. All rights reserved.',
  },
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Merge a stored override section over a default, field-by-field (arrays replace). */
function mergeSection<T extends Record<string, unknown>>(def: T, over: unknown): T {
  if (!isObj(over)) return def;
  const out = { ...def } as Record<string, unknown>;
  for (const k of Object.keys(def)) {
    if (over[k] !== undefined && over[k] !== null) out[k] = over[k];
  }
  return out as T;
}

/** The live site chrome: stored overrides merged over the defaults. */
export async function getSiteChrome(): Promise<SiteChrome> {
  try {
    const blocks = await getPageBlocks('site-chrome');
    const meta = (blocks.find((b) => b.section === 'chrome')?.metadata ?? {}) as Record<string, unknown>;
    return {
      banner: mergeSection(DEFAULT_CHROME.banner, meta.banner),
      nav: mergeSection(DEFAULT_CHROME.nav, meta.nav),
      footer: mergeSection(DEFAULT_CHROME.footer, meta.footer),
    };
  } catch (e) {
    console.error('[site-chrome/getSiteChrome] error:', e);
    return DEFAULT_CHROME;
  }
}

/** Mobile menu shape ({label,href,children}) derived from the nav groups + links. */
export function mobileNavFromChrome(nav: SiteChrome['nav']): { href: string; label: string; children?: { href: string; label: string }[] }[] {
  const groups = nav.groups.map((g) => ({ href: '#', label: g.label, children: g.items.map((i) => ({ href: i.href, label: i.label })) }));
  const links = nav.links.map((l) => ({ href: l.href, label: l.label }));
  return [...groups, ...links];
}
