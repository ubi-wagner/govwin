/**
 * THE ON-PAGE GUIDE IS READ AS A PROMISE, SO IT MAY NOT QUIETLY BECOME A FEATURE LIST.
 *
 * There are two documents about the companion and they have different jobs: the repo manual is the
 * long one, for whoever maintains it; `app/admin/observe/companion-guide.tsx` is the short one, on
 * the page, for whoever is about to spend a call. They will drift — that is what two documents do.
 *
 * What must NOT drift is the posture. Four things a person could be harmed by not knowing:
 *
 *   · it is ADVISORY — it proposes, you make the change
 *   · it NEVER CERTIFIES — an empty window is not health
 *   · it answers with a MECHANISM, not a filename it was not shown
 *   · it names WHAT IT CANNOT SEE
 *
 * A guide that lists what a tool can do and omits what it cannot is a sales page, and this one is
 * shown to the person deciding whether to trust a clean report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const GUIDE = join(process.cwd(), 'app/admin/observe/companion-guide.tsx');
const PAGE = join(process.cwd(), 'app/admin/observe/page.tsx');
const guide = () => readFileSync(GUIDE, 'utf8');

describe('the companion guide is on the page, and states the posture', () => {
  it('exists and is actually mounted — an unrendered guide documents nothing', () => {
    expect(existsSync(GUIDE)).toBe(true);
    const page = readFileSync(PAGE, 'utf8');
    expect(page).toContain('companion-guide');
    expect(page).toMatch(/<CompanionGuide\s*\/>/);
  });

  it('says it is advisory and writes nothing', () => {
    const g = guide();
    expect(g).toMatch(/writes nothing/i);
    expect(g).toMatch(/proposes the change/i);
  });

  it('says it never certifies — in the words that actually land', () => {
    expect(guide()).toMatch(/empty window means nothing happened/i);
    expect(guide()).toMatch(/will not tell you things are fine/i);
  });

  it('says the answer is a mechanism, never a filename', () => {
    const g = guide();
    expect(g).toMatch(/mechanism/i);
    expect(g).toMatch(/never a filename/i);
  });

  it('names what it CANNOT see — the half a sales page leaves out', () => {
    const g = guide();
    expect(g).toMatch(/What it cannot see/i);
    // The three that matter most, because each is a way a clean report could mislead.
    expect(g).toMatch(/outside the window/i);
    expect(g).toMatch(/source tree/i);
    expect(g).toMatch(/refuses to click anything that mutates/i);
  });

  it('tells the reader the "what you were doing" box is a claim to check, not a description', () => {
    expect(guide()).toMatch(/claim to check/i);
  });

  it('is a server component — no clock read during render, no client directive (B78/B79)', () => {
    const g = guide();
    expect(g).not.toContain("'use client'");
    expect(g).not.toMatch(/Date\.now\(\)|new Date\(\)/);
  });
});
