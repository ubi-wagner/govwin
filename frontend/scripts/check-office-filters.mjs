#!/usr/bin/env node
/**
 * Can LibreOffice open a document AT ALL on this box?
 *
 * The deck probe converts an exported `.pptx` with LibreOffice so an engine that did not write the
 * file can say what it really contains. Without working document filters that conversion fails, the
 * probe reports UNMEASURED, and a run that measured nothing sits in the table looking like a run.
 *
 * ── WHY THE CONTROL IS A DECK NONE OF OUR CODE WROTE ──────────────────────────────────────────
 *
 * This exact failure was once diagnosed as "LibreOffice cannot open the .pptx this product writes"
 * and written into a script header as fact. It was not true. The container ships `libreoffice-core`
 * and `-common` with NO document filter packages, so `soffice` failed on everything. The wrong half
 * of that diagnosis blamed the product for a broken tool, and it stood long enough to rule out the
 * only instrument that could see B121: decks delivered with table rows and bullets missing.
 *
 * The control has to separate "the tool cannot open anything" from "the tool cannot open OURS", so
 * it converts a deck built by pptxgenjs with library defaults — none of our writer's code runs.
 * Convert that first; if it fails, nothing soffice says about our artifacts means anything.
 *
 * A PLAIN `.txt` IS THE WRONG CONTROL HERE, which cost a first version of this file. Text needs the
 * WRITER filter; the probe needs IMPRESS. A box with `libreoffice-impress` alone converts our decks
 * perfectly and fails on a one-line text file — so a .txt control marks a fully capable rig broken.
 * Match the control to the filter the thing under test actually needs.
 *
 *   node scripts/check-office-filters.mjs   → exit 0 usable, exit 1 with the fix, exit 2 absent
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'office-preflight-'));
const deck = join(dir, 'control.pptx');

try {
  execFileSync('soffice', ['--version'], { stdio: 'pipe', timeout: 60_000 });
} catch {
  console.error('soffice is not installed on this box.');
  console.error('  apt-get update -qq && apt-get install -y --no-install-recommends libreoffice-impress');
  rmSync(dir, { recursive: true, force: true });
  process.exit(2);
}

// A deck from the library's own defaults — no product code in the bytes.
try {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const p = new PptxGenJS();
  p.addSlide().addText('control', { x: 1, y: 1, w: 6, h: 1, fontSize: 24 });
  writeFileSync(deck, Buffer.from(await p.write({ outputType: 'nodebuffer' })));
} catch (e) {
  console.error('could not build the control deck:', e instanceof Error ? e.message : e);
  rmSync(dir, { recursive: true, force: true });
  process.exit(2);
}

try {
  execFileSync('soffice', ['--headless', '--norestore',
    `-env:UserInstallation=file://${join(dir, 'profile')}`,
    '--convert-to', 'pdf', '--outdir', dir, deck], { stdio: 'pipe', timeout: 180_000 });
} catch {
  // swallowed — the artifact check below is the real verdict, since soffice exits 0 on failure
}

// soffice EXITS 0 EVEN WHEN IT CONVERTS NOTHING. It prints "Error: source file could not be
// loaded" and returns success, so the exit status is not the signal — the presence of the output
// file is. A preflight that trusted the exit code would pass on a box with no filters at all.
if (!existsSync(join(dir, 'control.pdf'))) {
  console.error('soffice is installed but cannot convert a deck it has never seen — the Impress');
  console.error('filter is missing. Nothing it reports about our .pptx would be evidence.');
  console.error('  apt-get update -qq && apt-get install -y --no-install-recommends libreoffice-impress');
  console.error('  (add libreoffice-writer / -calc for .docx / .xlsx)');
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

console.error('LibreOffice: Impress filter present (converted a deck none of our code wrote)');
rmSync(dir, { recursive: true, force: true });
process.exit(0);
