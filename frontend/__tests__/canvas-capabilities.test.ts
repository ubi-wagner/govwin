import { describe, expect, it } from 'vitest';
import { resolveCanvasCapabilities } from '@/lib/canvas/capabilities';

describe('resolveCanvasCapabilities — one gate, role × stage × permission', () => {
  it('tenant_admin drafting → the full authoring set', () => {
    const c = resolveCanvasCapabilities({ role: 'tenant_admin', stage: 'draft' });
    expect(c).toMatchObject({
      canEditContent: true, canFormat: true, canInsertLibrary: true, canDraftAI: true,
      canManageFloorplan: true, canAtomize: true, canManageStructure: true,
      canComment: true, canExport: true,
    });
  });

  it('tenant_user drafting → author content, but NOT curation/floorplan/structure', () => {
    const c = resolveCanvasCapabilities({ role: 'tenant_user', stage: 'draft' });
    expect(c.canEditContent).toBe(true);
    expect(c.canFormat).toBe(true);
    expect(c.canInsertLibrary).toBe(true);
    expect(c.canDraftAI).toBe(true);
    // curation/authoring powers are admin-only
    expect(c.canManageFloorplan).toBe(false);
    expect(c.canAtomize).toBe(false);
    expect(c.canManageStructure).toBe(false);
    expect(c.canAnnotate).toBe(false);
  });

  it('partner_user with a COMMENT grant → comment + export only, no editing', () => {
    const c = resolveCanvasCapabilities({ role: 'partner_user', stage: 'review', permission: 'comment' });
    expect(c.canEditContent).toBe(false);
    expect(c.canFormat).toBe(false);
    expect(c.canComment).toBe(true);
    expect(c.canExport).toBe(true);
  });

  it('partner_user with a VIEW grant → export only, not even comment', () => {
    const c = resolveCanvasCapabilities({ role: 'partner_user', permission: 'view' });
    expect(c.canEditContent).toBe(false);
    expect(c.canComment).toBe(false);
    expect(c.canExport).toBe(true);
  });

  it('locked ⇒ read-only for everyone, but comment + export survive', () => {
    const c = resolveCanvasCapabilities({ role: 'tenant_admin', stage: 'draft', locked: true });
    expect(c.canEditContent).toBe(false);
    expect(c.canFormat).toBe(false);
    expect(c.canManageFloorplan).toBe(false);
    expect(c.canComment).toBe(true);
    expect(c.canExport).toBe(true);
  });

  it('the annotate/atomize ingest tools light up for an admin at ingest, not a drafter', () => {
    expect(resolveCanvasCapabilities({ role: 'tenant_admin', stage: 'ingest' }).canAnnotate).toBe(true);
    expect(resolveCanvasCapabilities({ role: 'rfp_admin', stage: 'template' }).canAnnotate).toBe(true);
    expect(resolveCanvasCapabilities({ role: 'tenant_admin', stage: 'draft' }).canAnnotate).toBe(false);
    expect(resolveCanvasCapabilities({ role: 'tenant_user', stage: 'ingest' }).canAnnotate).toBe(false);
  });

  it('rfp_admin gets tenant-admin+ authoring (shadow curation)', () => {
    const c = resolveCanvasCapabilities({ role: 'rfp_admin', stage: 'draft' });
    expect(c.canManageFloorplan).toBe(true);
    expect(c.canAtomize).toBe(true);
  });
});
