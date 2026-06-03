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
// 'prose' = the serif-italic brand accent; 'plain' = color only (no italic/serif).
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

const PLAIN_ACCENT_CLASS: Record<string, string> = {
  'brand-400': 'text-brand-400',
  'brand-500': 'text-brand-500',
  'brand-600': 'text-brand-600',
  'brand-700': 'text-brand-700',
  award: 'text-award',
  citrus: 'text-citrus',
};

export type Accent = keyof typeof ACCENT_CLASS;
export type RichTextVariant = 'prose' | 'plain';

function accentClass(accent: string, variant: RichTextVariant): string {
  const map = variant === 'plain' ? PLAIN_ACCENT_CLASS : ACCENT_CLASS;
  return map[accent] ?? (variant === 'plain' ? PLAIN_ACCENT_CLASS['brand-500'] : ACCENT_CLASS['brand-500']);
}

/** Split a single line on `*...*` accent spans. */
function renderLine(line: string, accent: string, variant: RichTextVariant, keyBase: string): ReactNode[] {
  const parts = line.split(/(\*[^*]+\*)/g);
  return parts
    .filter((p) => p !== '')
    .map((p, i) =>
      p.length >= 2 && p.startsWith('*') && p.endsWith('*') ? (
        <span key={`${keyBase}-${i}`} className={accentClass(accent, variant)}>
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
 * `variant='plain'` styles the accent with color only (no italic/serif) — match
 * it to whatever the original hand-styled span used.
 */
export function RichText({
  text,
  accent = 'brand-500',
  variant = 'prose',
}: {
  text?: string | null;
  accent?: Accent | string;
  variant?: RichTextVariant;
}) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, li) => (
        <Fragment key={li}>
          {li > 0 && <br />}
          {renderLine(line, accent, variant, String(li))}
        </Fragment>
      ))}
    </>
  );
}
