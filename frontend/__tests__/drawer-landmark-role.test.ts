/**
 * THE NAV RAIL IS NOT A DIALOG.
 *
 * `Drawer` set `role="dialog"` unconditionally. The nav rail is a `Drawer` with `inlineAt="lg"`,
 * which at and above that breakpoint is not an overlay at all — it is a static 256px column, the
 * primary navigation of every admin and portal page. So a screen-reader user met a **dialog** where
 * the site's main navigation should be, on every page, and the nav was absent from landmark
 * navigation — the standard way they would jump to it.
 *
 * Found by a harness rather than by reading: an overlay probe kept reporting one persistent
 * `role="dialog"` present at rest on every page, which is exactly what this defect looks like from
 * the outside.
 *
 * The three cases below are the whole contract, and the middle one is why this file exists — an
 * earlier version of the fix dropped `aria-modal` for `inlineAt` drawers, which would have demoted
 * the MOBILE nav from a modal to a plain region while it covers the page. `open` is only ever true
 * below the breakpoint (the hamburger that sets it is `lg:hidden`), so an open drawer is a real
 * overlay in both modes.
 *
 * Written with `createElement` rather than JSX because the suite's include pattern is
 * `__tests__/**\/*.test.ts` and every other test here follows it; widening the shared config for one
 * file would change what every future run picks up.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Drawer } from '@/components/ui/drawer';
import { NavShell } from '@/components/ui/nav-shell';

const asideAttrs = (html: string) => (/<aside([^>]*)>/.exec(html)?.[1] ?? '');

describe('Drawer — the role follows the behaviour', () => {
  it('INLINE and closed → a landmark, never a dialog', () => {
    const a = asideAttrs(renderToStaticMarkup(
      h(Drawer, { open: false, onClose: () => {}, inlineAt: 'lg', inlineRole: 'navigation', ariaLabel: 'Navigation' }, 'rail'),
    ));
    expect(a, 'the inline nav rail must not be announced as a dialog').not.toMatch(/role="dialog"/);
    expect(a).toMatch(/role="navigation"/);
    expect(a, 'a non-overlay must not claim aria-modal').not.toMatch(/aria-modal/);
    expect(a, 'the landmark still needs its accessible name').toMatch(/aria-label="Navigation"/);
  });

  it('INLINE and open → below the breakpoint it IS an overlay: dialog + aria-modal', () => {
    const a = asideAttrs(renderToStaticMarkup(
      h(Drawer, { open: true, onClose: () => {}, inlineAt: 'lg', inlineRole: 'navigation', ariaLabel: 'Navigation' }, 'rail'),
    ));
    expect(a).toMatch(/role="dialog"/);
    expect(a, 'the mobile nav covers the page — it must stay a modal').toMatch(/aria-modal="true"/);
  });

  it('OVERLAY mode (no inlineAt) → always a dialog', () => {
    const a = asideAttrs(renderToStaticMarkup(
      h(Drawer, { open: true, onClose: () => {}, ariaLabel: 'Tools' }, 'panel'),
    ));
    expect(a).toMatch(/role="dialog"/);
    expect(a).toMatch(/aria-modal="true"/);
  });

  it('NavShell — the real caller — renders its rail as a navigation landmark', () => {
    // The units above prove the primitive; this proves the wiring, because the defect only reached
    // users through NavShell passing inlineAt with no landmark role to fall back to.
    const html = renderToStaticMarkup(h(NavShell, { rail: 'rail' }, 'page'));
    expect(html).toMatch(/role="navigation"/);
    expect(asideAttrs(html), 'every page would otherwise open with a dialog in the nav').not.toMatch(/role="dialog"/);
  });
});
