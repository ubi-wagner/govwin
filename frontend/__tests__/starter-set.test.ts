import { describe, it, expect } from 'vitest';
import { GENERIC_STARTERS, PROPOSAL_STARTERS, STARTER_SET } from '@/lib/library/starter-set';
import { ARTIFACT_FORMAT, flattenNodes } from '@/lib/library/artifact-canvas';
import { renderCanvas } from '@/lib/export/artifact-export';

// The dogfooded starter set (P4). Pure proof: each builds a valid v2 canvas,
// renders to its native format via the REAL exporters, and the taxonomy is sound.
describe('starter set (P4.1 generics)', () => {
  it('each starter builds a valid v2 CanvasDocument with the right form/preset', () => {
    for (const s of GENERIC_STARTERS) {
      const d = s.build();
      expect(d.version).toBe(2);
      expect((d.sections ?? []).length, s.slug).toBeGreaterThanOrEqual(1);
      const fmt = d.canvas.format;
      if (s.form === 'sheet') expect(fmt, s.slug).toBe('spreadsheet');
      else if (s.form === 'ppt') expect(fmt.startsWith('slide'), s.slug).toBe(true);
      else expect(['letter', 'custom'], s.slug).toContain(fmt);
    }
  });

  it('each starter renders to its native format (real exporter, valid zip)', async () => {
    for (const s of GENERIC_STARTERS) {
      const buf = await renderCanvas(ARTIFACT_FORMAT[s.form], s.build(), {});
      expect(Buffer.isBuffer(buf), s.slug).toBe(true);
      expect(buf.length, s.slug).toBeGreaterThan(500);
      expect(buf.slice(0, 2).toString('latin1'), s.slug).toBe('PK'); // docx/pptx/xlsx are OpenXML zips
    }
  });

  it('every starter decomposes to canvas-ready primitive atoms (eligible content, structural headings)', () => {
    const CONTENT = ['text_block', 'bulleted_list', 'numbered_list', 'table', 'image', 'caption'];
    for (const s of STARTER_SET) {
      const nodes = flattenNodes(s.build());
      // ≥1 library_eligible node → decomposeAndIngest mints ≥1 primitive ATOM per foundation
      const eligible = nodes.filter((n) => n.library_eligible === true);
      expect(eligible.length, s.slug).toBeGreaterThanOrEqual(1);
      // every eligible node is substantive content carrying a canvas node (the atom's payload)
      for (const n of eligible) {
        expect(CONTENT, `${s.slug}:${n.type}`).toContain(n.type);
        expect(n.content, `${s.slug}:${n.type}`).toBeTruthy();
      }
      // headings stay structural — a bare heading is a label, never its own atom
      for (const h of nodes.filter((n) => n.type === 'heading')) expect(h.library_eligible, s.slug).toBe(false);
    }
  });

  it('taxonomy is well-formed: unique slugs, valid form/kind, a context', () => {
    const slugs = STARTER_SET.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of GENERIC_STARTERS) {
      expect(['doc', 'ppt', 'pdf', 'sheet'], s.slug).toContain(s.form);
      expect(['template', 'document'], s.slug).toContain(s.kind);
      expect(s.context, s.slug).toBeTruthy();
    }
    // the generics cover the three exportable office forms
    expect(new Set(GENERIC_STARTERS.map((s) => s.form))).toEqual(new Set(['doc', 'ppt', 'sheet']));
  });
});

describe('starter set (P4.2 proposal vehicles)', () => {
  const VEHICLES = ['dow-cso', 'sbir-phase-1', 'sbir-phase-2', 'sttr-phase-1', 'sttr-phase-2', 'direct-to-phase-2'];
  const titles = (d: ReturnType<typeof PROPOSAL_STARTERS[number]['build']>) => (d.sections ?? []).map((s) => s.title);

  it('every DoD/DoW vehicle has a Technical-Volume doc + a Cost-Volume sheet, plus a shared comm deck', () => {
    for (const v of VEHICLES) {
      const forVeh = PROPOSAL_STARTERS.filter((s) => s.vehicle === v);
      expect(forVeh.some((s) => s.form === 'doc'), `${v} TV doc`).toBe(true);
      expect(forVeh.some((s) => s.form === 'sheet'), `${v} cost sheet`).toBe(true);
    }
    expect(PROPOSAL_STARTERS.some((s) => s.form === 'ppt' && s.context === 'commercialization')).toBe(true);
  });

  it('STTR TVs include the research-institution partnership scaffold (a superset of SBIR)', () => {
    const sbirP1 = PROPOSAL_STARTERS.find((s) => s.slug === 'sbir-p1-technical-volume')!.build();
    const sttrP1 = PROPOSAL_STARTERS.find((s) => s.slug === 'sttr-p1-technical-volume')!.build();
    expect(sttrP1.sections!.length).toBeGreaterThan(sbirP1.sections!.length);
    expect(titles(sttrP1)).toContain('Research Institution & Partnership');
    expect(titles(sttrP1)).toContain('Allocation of Work');
    // DP2's distinctive feasibility-first section
    const dp2 = PROPOSAL_STARTERS.find((s) => s.slug === 'dp2-technical-volume')!.build();
    expect(titles(dp2)[0]).toBe('Phase I Feasibility Documentation');
  });

  it('each proposal starter renders to its native format (valid zip)', async () => {
    for (const s of PROPOSAL_STARTERS) {
      const buf = await renderCanvas(ARTIFACT_FORMAT[s.form], s.build(), {});
      expect(buf.slice(0, 2).toString('latin1'), s.slug).toBe('PK');
    }
  });
});
