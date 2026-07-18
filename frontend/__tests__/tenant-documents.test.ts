import { describe, expect, it } from 'vitest';
import {
  starterFromPreset,
  starterFromTemplate,
  countNodes,
  isBlankPreset,
  isDocType,
  type TemplateRow,
} from '@/lib/documents/starter';
import { resolveDocumentCapabilities } from '@/lib/canvas/capabilities';
import { getNodeText, type CanvasDocument } from '@/lib/types/canvas-document';

const OPTS = { documentId: 'doc-1', actorId: 'user-1' };

describe('starterFromPreset — blank quick-starts', () => {
  it('flier → single-page letter, custom type', () => {
    const { canvas, docType, title } = starterFromPreset('flier', OPTS);
    expect(canvas.canvas.format).toBe('letter');
    expect(canvas.canvas.max_pages).toBe(1);
    expect(docType).toBe('custom');
    expect(canvas.document_id).toBe('doc-1');
    expect(canvas.metadata.title).toBe(title);
    expect(canvas.nodes).toEqual([]);
  });

  it('deck → 16:9 slide format, slide_deck type', () => {
    const { canvas, docType } = starterFromPreset('deck', OPTS);
    expect(canvas.canvas.format).toBe('slide_16_9');
    expect(docType).toBe('slide_deck');
  });

  it('sheet → spreadsheet format, cost_volume type', () => {
    const { canvas, docType } = starterFromPreset('sheet', OPTS);
    expect(canvas.canvas.format).toBe('spreadsheet');
    expect(docType).toBe('cost_volume');
  });

  it('honors a caller-supplied title', () => {
    expect(starterFromPreset('letter', { ...OPTS, title: '  Capability Statement  ' }).title).toBe('Capability Statement');
  });
});

describe('starterFromTemplate — resolution order', () => {
  const preset = {
    format: 'letter', width: 612, height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    header: null, footer: null,
    font_default: { family: 'Times New Roman', size: 10 },
    line_spacing: 1.0, max_pages: 15, max_slides: null,
  };

  it('1) a real body (nodes) is flattened to an editable doc', () => {
    const body: Partial<CanvasDocument> = {
      version: 1,
      canvas: preset as CanvasDocument['canvas'],
      nodes: [
        { id: 'n1', type: 'heading', content: { level: 2, text: 'Technical Approach' }, style: {}, provenance: { source: 'template' }, history: [], library_eligible: true },
        { id: 'n2', type: 'text_block', content: { text: 'Body text.' }, style: {}, provenance: { source: 'template' }, history: [], library_eligible: true },
      ],
    };
    const tpl: TemplateRow = { id: 't1', name: 'AFWERX 15pp', templateType: 'technical_volume', canvasPreset: preset, canvasDocument: body, metadata: {} };
    const { canvas, docType } = starterFromTemplate(tpl, OPTS);
    expect(docType).toBe('technical_volume');
    expect(canvas.nodes.length).toBe(2);
    expect(canvas.document_id).toBe('doc-1');
    // metadata is rebased to the new document (not the template's title)
    expect(canvas.metadata.title).toBe('AFWERX 15pp');
    expect(canvas.canvas.max_pages).toBe(15);
  });

  it('1b) a v2 section body is flattened to editable nodes', () => {
    const body: Partial<CanvasDocument> = {
      version: 2,
      canvas: preset as CanvasDocument['canvas'],
      nodes: [],
      sections: [
        { id: 's1', title: 'Approach', layout: { mode: 'flow' }, groups: [ { id: 'g1', nodes: [
          { id: 'n1', type: 'heading', content: { level: 2, text: 'Approach' }, style: {}, provenance: { source: 'template' }, history: [], library_eligible: true },
        ] } ] },
      ],
    };
    const tpl: TemplateRow = { id: 't2', name: 'V2 skeleton', templateType: 'custom', canvasPreset: preset, canvasDocument: body, metadata: {} };
    const { canvas } = starterFromTemplate(tpl, OPTS);
    expect(canvas.nodes.length).toBeGreaterThan(0);
    expect(canvas.sections).toBeUndefined(); // flattened
  });

  it('2) an empty body + metadata.sections[] scaffolds one heading per section name', () => {
    const tpl: TemplateRow = {
      id: 't3', name: 'DoD SBIR Phase I', templateType: 'technical_volume',
      canvasPreset: preset, canvasDocument: {},
      metadata: { sections: ['Cover Page', 'Technical Approach', 'Key Personnel'] },
    };
    const { canvas } = starterFromTemplate(tpl, OPTS);
    expect(canvas.nodes.length).toBe(3);
    expect(canvas.nodes.every((n) => n.type === 'heading')).toBe(true);
    expect(canvas.nodes.map((n) => getNodeText(n))).toEqual(['Cover Page', 'Technical Approach', 'Key Personnel']);
  });

  it('3) nothing to seed → empty canvas carrying the template page rules', () => {
    const tpl: TemplateRow = { id: 't4', name: 'Bare', templateType: 'custom', canvasPreset: preset, canvasDocument: {}, metadata: {} };
    const { canvas } = starterFromTemplate(tpl, OPTS);
    expect(canvas.nodes).toEqual([]);
    expect(canvas.canvas.max_pages).toBe(15);
  });

  it('falls back to a per-type preset when canvas_preset is missing', () => {
    const tpl: TemplateRow = { id: 't5', name: 'Deck', templateType: 'slide_deck', canvasPreset: null, canvasDocument: {}, metadata: {} };
    expect(starterFromTemplate(tpl, OPTS).canvas.canvas.format).toBe('slide_16_9');
  });

  it('defensively coerces a stringified-jsonb body (silent char-iteration guard)', () => {
    const body = { version: 1, canvas: preset, nodes: [ { id: 'n1', type: 'text_block', content: { text: 'Hi' }, style: {}, provenance: { source: 'template' }, history: [], library_eligible: true } ] };
    const tpl: TemplateRow = { id: 't6', name: 'Str', templateType: 'custom', canvasPreset: JSON.stringify(preset), canvasDocument: JSON.stringify(body), metadata: '{}' };
    const { canvas } = starterFromTemplate(tpl, OPTS);
    expect(canvas.nodes.length).toBe(1);
    expect(canvas.canvas.format).toBe('letter');
  });
});

describe('countNodes', () => {
  it('counts flat nodes', () => {
    const doc = { version: 1, nodes: [{}, {}, {}] } as unknown as CanvasDocument;
    expect(countNodes(doc)).toBe(3);
  });
  it('counts across v2 sections/groups', () => {
    const doc = { version: 2, nodes: [], sections: [
      { id: 's1', groups: [{ id: 'g1', nodes: [{}, {}] }, { id: 'g2', nodes: [{}] }] },
      { id: 's2', groups: [{ id: 'g3', nodes: [{}] }] },
    ] } as unknown as CanvasDocument;
    expect(countNodes(doc)).toBe(4);
  });
  it('empty → 0', () => {
    expect(countNodes({ version: 1, nodes: [] } as unknown as CanvasDocument)).toBe(0);
  });
  it('malformed sections (missing groups/nodes) → 0, no throw', () => {
    expect(countNodes({ version: 2, nodes: [], sections: [{}, { groups: [{}] }] } as unknown as CanvasDocument)).toBe(0);
  });
});

describe('type guards', () => {
  it('isBlankPreset', () => {
    expect(isBlankPreset('flier')).toBe(true);
    expect(isBlankPreset('nope')).toBe(false);
    expect(isBlankPreset(undefined)).toBe(false);
  });
  it('isDocType', () => {
    expect(isDocType('technical_volume')).toBe(true);
    expect(isDocType('custom')).toBe(true);
    expect(isDocType('bogus')).toBe(false);
  });
});

describe('resolveDocumentCapabilities — standalone-document tool mask', () => {
  it('tenant_admin editing a document → authoring set, but proposal-scoped powers masked off', () => {
    const c = resolveDocumentCapabilities({ role: 'tenant_admin' });
    // kept
    expect(c.canEditContent).toBe(true);
    expect(c.canFormat).toBe(true);
    expect(c.canInsertLibrary).toBe(true); // "from template AND library"
    expect(c.canManageFloorplan).toBe(true);
    expect(c.canManageStructure).toBe(true); // → save-as-template card
    expect(c.canExport).toBe(true);
    // masked (no route behind a standalone document)
    expect(c.canLock).toBe(false);
    expect(c.canComment).toBe(false);
    expect(c.canAtomize).toBe(false);
    expect(c.canDraftAI).toBe(false);
    expect(c.canAnnotate).toBe(false);
  });

  it('tenant_user editing → content + format + library, no admin/curation powers', () => {
    const c = resolveDocumentCapabilities({ role: 'tenant_user' });
    expect(c.canEditContent).toBe(true);
    expect(c.canInsertLibrary).toBe(true);
    expect(c.canManageFloorplan).toBe(false);
    expect(c.canManageStructure).toBe(false);
    expect(c.canLock).toBe(false);
  });

  it('a final document is read-only (edits off, export stays)', () => {
    const c = resolveDocumentCapabilities({ role: 'tenant_admin', final: true });
    expect(c.canEditContent).toBe(false);
    expect(c.canFormat).toBe(false);
    expect(c.canExport).toBe(true);
    expect(c.canLock).toBe(false);
  });
});
