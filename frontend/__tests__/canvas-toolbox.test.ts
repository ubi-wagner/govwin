import { describe, expect, it } from 'vitest';
import { resolveCanvasToolbox } from '@/lib/canvas/toolbox';

const ids = (r: ReturnType<typeof resolveCanvasToolbox>) => r.cards.map((c) => c.id);

/**
 * End-to-end across EVERY actor × context: the canvas is one sidebar-card list;
 * these assert who sees which cards, in what order (primary first). Reads like
 * a walk through each user's journey.
 */
describe('resolveCanvasToolbox — one sidebar, every actor × context', () => {
  it('COLLABORATOR (comment grant, review) → essentially one card: Review · Modify · Lock', () => {
    const t = resolveCanvasToolbox({ role: 'partner_user', stage: 'review', permission: 'comment' });
    expect(t.primary?.id).toBe('review');
    expect(ids(t)).toContain('review');
    // no authoring cards for a comment-only collaborator
    expect(ids(t)).not.toContain('insert');
    expect(ids(t)).not.toContain('format');
    // only the review card + ambient status/export
    expect(t.cards.filter((c) => !c.ambient).map((c) => c.id)).toEqual(['review']);
  });

  it('COLLABORATOR (edit grant, draft) → drafting tools + review, primary Insert', () => {
    const t = resolveCanvasToolbox({ role: 'partner_user', stage: 'draft', permission: 'edit' });
    expect(t.primary?.id).toBe('insert');
    expect(ids(t)).toEqual(expect.arrayContaining(['insert', 'format', 'ai', 'review']));
    // still not an admin — no floorplan/sections/template/annotate
    expect(ids(t)).not.toContain('floorplan');
    expect(ids(t)).not.toContain('template');
  });

  it('COLLABORATOR (view grant) → ambient only, no primary tool', () => {
    const t = resolveCanvasToolbox({ role: 'partner_user', permission: 'view' });
    expect(t.primary).toBeNull();
    expect(ids(t)).not.toContain('review');
    expect(t.cards.every((c) => c.ambient)).toBe(true); // compliance + export only
  });

  it('RFP ADMIN (ingest an RFP) → MANY cards, primary Annotate & Atomize', () => {
    const t = resolveCanvasToolbox({ role: 'rfp_admin', stage: 'ingest' });
    expect(t.primary?.id).toBe('annotate');
    expect(ids(t)).toEqual(expect.arrayContaining(['annotate', 'template', 'sections', 'floorplan', 'insert', 'format', 'library', 'ai']));
    expect(t.cards.length).toBeGreaterThanOrEqual(9);
  });

  it('RFP ADMIN / TENANT ADMIN (template building) → primary Template', () => {
    expect(resolveCanvasToolbox({ role: 'rfp_admin', stage: 'template' }).primary?.id).toBe('template');
    expect(resolveCanvasToolbox({ role: 'tenant_admin', stage: 'template' }).primary?.id).toBe('template');
  });

  it('TENANT ADMIN (proposal build, draft) → full authoring set, no ingest-only annotate', () => {
    const t = resolveCanvasToolbox({ role: 'tenant_admin', stage: 'draft' });
    expect(t.primary?.id).toBe('insert');
    expect(ids(t)).toEqual(expect.arrayContaining(['insert', 'format', 'library', 'ai', 'sections', 'floorplan', 'template']));
    expect(ids(t)).not.toContain('annotate'); // annotate is ingest/template-stage
  });

  it('TENANT ADMIN (building the library, ingest) → annotate lights up', () => {
    expect(resolveCanvasToolbox({ role: 'tenant_admin', stage: 'ingest' }).cards.map((c) => c.id)).toContain('annotate');
  });

  it('TENANT USER (draft) → author content, but no curation/structure cards', () => {
    const t = resolveCanvasToolbox({ role: 'tenant_user', stage: 'draft' });
    expect(t.primary?.id).toBe('insert');
    expect(ids(t)).toEqual(expect.arrayContaining(['insert', 'format', 'library', 'ai']));
    expect(ids(t)).not.toContain('sections');
    expect(ids(t)).not.toContain('floorplan');
    expect(ids(t)).not.toContain('template');
    expect(ids(t)).not.toContain('annotate');
  });

  it('ANYONE (locked / completed ToDo) → review + status + export, no editing', () => {
    const t = resolveCanvasToolbox({ role: 'tenant_admin', stage: 'draft', locked: true });
    expect(t.primary?.id).toBe('review');
    expect(ids(t)).not.toContain('insert');
    expect(ids(t)).not.toContain('format');
    expect(ids(t)).toEqual(expect.arrayContaining(['review', 'compliance', 'export']));
  });

  it('cards[0] is always the primary tool for the context (ambient sorts last)', () => {
    for (const input of [
      { role: 'rfp_admin' as const, stage: 'ingest' as const },
      { role: 'tenant_admin' as const, stage: 'draft' as const },
      { role: 'partner_user' as const, stage: 'review' as const, permission: 'comment' as const },
    ]) {
      const t = resolveCanvasToolbox(input);
      if (t.primary) expect(t.cards[0].id).toBe(t.primary.id);
    }
  });
});
