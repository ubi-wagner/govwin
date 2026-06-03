/**
 * RichText — inline marketing copy renderer for CMS-editable headings/copy.
 *
 * Lets editors keep the brand's accent styling in plain-text block fields:
 *   - `*phrase*`  → an italic accent span (the "prose" serif in an accent color)
 *   - `\n`        → a line break
 *
 * So a seeded/edited headline like  "A proposal\nengine, *not* a\nproposal\ngamble."
 * renders identically to the original hand-styled JSX. Plain strings (no markers)
 * render unchanged, so existing CMS content is unaffected.
 *
 * Accent colors are mapped to FULL static class strings (never interpolated) so
 * Tailwind's JIT always emits them. Add new accents here, not via `text-${x}`.
 */
import { Fragment } from 'react';
import type { ReactNode } from 'react';

// Full class strings only — interpolated Tailwind classes get purged.
const ACCENT_CLASS: Record<string, string> = {
  'brand-500': 'font-prose italic text-brand-500',
  'brand-400': 'font-prose italic text-brand-400',
  'brand-600': 'font-prose italic text-brand-600',
  award: 'font-prose italic text-award',
  citrus: 'font-prose italic text-citrus',
  'citrus-400': 'font-prose italic text-citrus-400',
  white: 'font-prose italic text-white',
  cream: 'font-prose italic text-cream',
};

export type Accent = keyof typeof ACCENT_CLASS;

function accentClass(accent: string): string {
  return ACCENT_CLASS[accent] ?? ACCENT_CLASS['brand-500'];
}

/** Split a single line on `*...*` accent spans. */
function renderLine(line: string, accent: string, keyBase: string): ReactNode[] {
  const parts = line.split(/(\*[^*]+\*)/g);
  return parts
    .filter((p) => p !== '')
    .map((p, i) =>
      p.length >= 2 && p.startsWith('*') && p.endsWith('*') ? (
        <span key={`${keyBase}-${i}`} className={accentClass(accent)}>
          {p.slice(1, -1)}
        </span>
      ) : (
        <Fragment key={`${keyBase}-${i}`}>{p}</Fragment>
      ),
    );
}

/**
 * Render CMS text with accent + line-break markup. Use inside an existing
 * heading/paragraph element (it emits inline content + <br/>, no block wrapper).
 */
export function RichText({ text, accent = 'brand-500' }: { text?: string | null; accent?: Accent | string }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, li) => (
        <Fragment key={li}>
          {li > 0 && <br />}
          {renderLine(line, accent, String(li))}
        </Fragment>
      ))}
    </>
  );
}
