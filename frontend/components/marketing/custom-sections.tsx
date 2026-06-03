/**
 * CustomSections — renders any blocks an editor adds whose `section` isn't one
 * of the page's known (registry-default) sections, in a clean default layout.
 *
 * This makes "add a new section in the editor and see it on the page" work for
 * every marketing page: known sections render in their bespoke slots as before;
 * anything new falls through to here (alternating bands, heading + body + optional
 * image + optional CTA) so it's never invisible. Editors can style via metadata:
 *   { accent?: 'brand-500'|'award'|..., bg?: 'cream'|'white'|'navy', cta?: {label,href} }
 */
import Link from 'next/link';
import type { ContentRow } from '@/lib/cms';
import { PAGE_SEEDS } from '@/lib/page-content';
import { RichText } from '@/components/marketing/rich-text';

function knownSections(pageKey: string): Set<string> {
  return new Set((PAGE_SEEDS[pageKey]?.blocks ?? []).map((b) => b.section));
}

export function CustomSections({ pageKey, blocks }: { pageKey: string; blocks: ContentRow[] }) {
  const known = knownSections(pageKey);
  const custom = blocks.filter((b) => b.section && !known.has(b.section));
  if (custom.length === 0) return null;

  return (
    <>
      {custom.map((b, i) => {
        const meta = (b.metadata ?? {}) as { accent?: string; bg?: string; cta?: { label?: string; href?: string } };
        const dark = meta.bg === 'navy';
        const band =
          meta.bg === 'navy'
            ? 'bg-navy-900'
            : meta.bg === 'white'
              ? 'bg-white border-t border-cream-200'
              : meta.bg === 'cream' || i % 2 === 0
                ? 'bg-cream-50 border-t border-cream-200'
                : 'bg-white border-t border-cream-200';
        const accent = meta.accent ?? (dark ? 'citrus' : 'brand-500');
        const cta = meta.cta;
        return (
          <section key={`${b.section}-${i}`} className={band}>
            <div className="max-w-5xl mx-auto px-6 py-16 md:py-20">
              {b.excerpt && (
                <p className={`text-xs font-semibold uppercase tracking-[0.3em] mb-4 ${dark ? 'text-citrus' : 'text-brand-600'}`}>
                  {b.excerpt}
                </p>
              )}
              {b.title && (
                <h2 className={`font-display text-3xl md:text-4xl font-black leading-tight ${dark ? 'text-white' : 'text-navy-900'}`}>
                  <RichText text={b.title} accent={accent} />
                </h2>
              )}
              {b.featuredImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.featuredImage} alt={b.title ?? ''} className="mt-8 w-full rounded-xl object-cover max-h-[28rem]" />
              )}
              {b.body && (
                <div className={`mt-6 text-lg leading-relaxed space-y-4 max-w-3xl ${dark ? 'text-navy-300' : 'text-navy-600'}`}>
                  {b.body.split('\n\n').map((p, j) => (
                    <p key={j}>{p}</p>
                  ))}
                </div>
              )}
              {cta?.href && cta?.label && (
                <Link
                  href={cta.href}
                  className={`inline-flex mt-8 px-6 py-3 rounded-lg text-sm font-bold transition-colors ${
                    dark ? 'bg-citrus hover:bg-citrus-400 text-navy-900' : 'bg-brand-500 hover:bg-brand-600 text-white'
                  }`}
                >
                  {cta.label}
                </Link>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
