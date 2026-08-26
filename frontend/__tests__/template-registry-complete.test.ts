/**
 * Every template is reachable (#151 — Launch: integrate templates).
 *
 * A template lives in four places and only one of them is enforced by the compiler:
 *
 *   1. a file under `lib/templates/` that builds the CanvasDocument
 *   2. a `TemplateKey` union member                    ← tsc checks this one
 *   3. a `TEMPLATE_MAP` entry, so `getTemplate(key)` returns the document
 *   4. a `TEMPLATE_CATALOG` row, so a human can SEE it in the picker
 *
 * Miss (3) and the key type-checks and returns undefined at runtime. Miss (4) and the template is
 * fully built, fully working, and invisible — nobody can choose it. Neither failure produces an
 * error anywhere; the template just quietly does not exist for users. That is what this pins.
 *
 * Written after finding the catalog at 39 rows against 41 declared keys.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { TEMPLATE_CATALOG, getTemplate, type TemplateKey } from '@/lib/templates';

const INDEX = readFileSync(join(process.cwd(), 'lib/templates/index.ts'), 'utf8');

/** The declared union, read from source — the compiler knows it, the runtime does not. */
function declaredKeys(): string[] {
  const block = INDEX.split('export type TemplateKey =')[1]?.split(';')[0] ?? '';
  return Array.from(block.matchAll(/'([a-z0-9-]+)'/g)).map((m) => m[1]);
}

describe('the template registry has no unreachable entries', () => {
  const keys = declaredKeys();

  it('declares a plausible number of templates (the source parse worked)', () => {
    expect(keys.length).toBeGreaterThan(30);
  });

  it('every declared key resolves to a real document', () => {
    const broken = keys.filter((k) => !getTemplate(k as TemplateKey));
    expect(broken, `declared in TemplateKey but missing from TEMPLATE_MAP: ${broken.join(', ')}`).toEqual([]);
  });

  it('every declared key is offered in the picker', () => {
    const listed = new Set(TEMPLATE_CATALOG.map((t) => t.key));
    const invisible = keys.filter((k) => !listed.has(k as TemplateKey));
    expect(invisible, `built and working but absent from TEMPLATE_CATALOG, so nobody can choose them: ${invisible.join(', ')}`).toEqual([]);
  });

  it('the picker offers nothing that does not exist', () => {
    const declared = new Set(keys);
    const phantom = TEMPLATE_CATALOG.map((t) => t.key).filter((k) => !declared.has(k));
    expect(phantom, `offered in the picker but not a declared key: ${phantom.join(', ')}`).toEqual([]);
  });

  it('lists each key exactly once in the catalog', () => {
    const seen = new Map<string, number>();
    for (const t of TEMPLATE_CATALOG) seen.set(t.key, (seen.get(t.key) ?? 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
    expect(dupes, `duplicated in the picker: ${dupes.join(', ')}`).toEqual([]);
  });
});

describe('every template file is wired to a key', () => {
  /** Files that are machinery, not templates. */
  const NOT_A_TEMPLATE = new Set(['index.ts', 'extract-skeleton.ts', 'past-proposal-canvas.ts']);

  it('has no orphaned template module', () => {
    const files = readdirSync(join(process.cwd(), 'lib/templates'))
      .filter((f) => f.endsWith('.ts') && !NOT_A_TEMPLATE.has(f));
    // A template file earns its place by being imported by the registry. An unimported one is
    // finished work nothing can reach — the same defect as a missing catalog row, one step earlier.
    const orphans = files.filter((f) => !INDEX.includes(`./${f.replace(/\.ts$/, '')}'`));
    expect(orphans, `template modules the registry never imports: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('a template can actually be built', () => {
  it.each(TEMPLATE_CATALOG.map((t) => [t.key, t.format] as const))(
    '%s builds a canvas, and a deck is really a deck',
    (key, format) => {
      const doc = getTemplate(key)!;
      expect(doc, `${key} returned nothing`).toBeTruthy();
      const canvasFormat = doc.canvas?.format ?? 'letter';

      // Only the DECK claim is checked against the canvas, and it is checked hard: `canvas.format`
      // is what forks CanvasRenderer → SlideEditor, so a catalog row claiming 'deck' over a letter
      // canvas opens the slide editor on a flowing document.
      //
      // 'spreadsheet' is deliberately NOT checked the same way. The catalog's format describes the
      // DELIVERABLE (it is stored on master_templates.format and drives the native export), while
      // canvas.format describes the AUTHORING surface. Every cost form is authored on a letter
      // canvas — it is a government form laid out on a page — and exports as xlsx because
      // resolveArtifactFormat maps artifactType 'cost' straight to xlsx. Asserting they match
      // flagged all seven cost templates and was measuring the wrong thing.
      if (format === 'deck') {
        expect(canvasFormat, `${key}: catalog says deck, canvas is ${canvasFormat}`).toMatch(/^slide/);
      } else {
        expect(canvasFormat, `${key}: a non-deck must not be authored on a slide canvas`).not.toMatch(/^slide/);
      }
    },
  );
});
