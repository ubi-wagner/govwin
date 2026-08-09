import { describe, expect, it } from 'vitest';
import { withCanvasDefaults, type CanvasDocument } from '@/lib/types/canvas-document';
import { isSectionWritable, sectionLockReason } from '@/lib/proposal/section-writable';

// Regression tests for the Canvas zero-trust close-out fixes.

describe('withCanvasDefaults — editor never white-screens on a format-less canvas (BUG B)', () => {
  const baseMeta = {
    title: 't', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
    created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'in_progress' as const,
  };

  it('fills a missing canvas.format so doc.canvas.format.startsWith(...) is always safe', () => {
    // The exact shape a minimal agent/import/legacy doc produces: width/height/margins but NO format.
    const doc = { version: 1, metadata: baseMeta, canvas: { width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 } }, nodes: [] } as unknown as CanvasDocument;
    const out = withCanvasDefaults(doc);
    expect(typeof out.canvas.format).toBe('string');
    expect(out.canvas.format).toBe('letter');
    // The crashing callsite pattern must not throw:
    expect(() => out.canvas.format.startsWith('slide')).not.toThrow();
    expect(out.canvas.format.startsWith('slide')).toBe(false);
  });

  it('treats an empty-string format as missing (also crash-prone downstream)', () => {
    const doc = { version: 1, metadata: baseMeta, canvas: { format: '', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 } }, nodes: [] } as unknown as CanvasDocument;
    expect(withCanvasDefaults(doc).canvas.format).toBe('letter');
  });

  it('fills OTHER missing canvas fields even when format IS present (the restore-crash case)', () => {
    // format present but font_default/line_spacing absent — crashed the editor on draft-restore.
    const doc = { version: 1, metadata: baseMeta, canvas: { format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 } }, nodes: [] } as unknown as CanvasDocument;
    const out = withCanvasDefaults(doc);
    expect(out.canvas.font_default).toBeTruthy();
    expect(typeof out.canvas.line_spacing).toBe('number');
  });

  it('returns a valid doc unchanged (stable identity — no needless re-render)', () => {
    const doc = { version: 1, metadata: baseMeta, canvas: { format: 'slide_16_9', width: 960, height: 540, margins: { top: 40, right: 40, bottom: 40, left: 40 }, header: null, footer: null, font_default: { family: 'Arial', size: 18 }, line_spacing: 1.2, max_pages: null, max_slides: 25 }, nodes: [] } as unknown as CanvasDocument;
    expect(withCanvasDefaults(doc)).toBe(doc);
  });
});

describe('isSectionWritable / sectionLockReason — immutability contract (BUGS E/F/G)', () => {
  it('writable when unlocked and stage matches', () => {
    expect(isSectionWritable({ isLocked: false, completedStage: 'draft' }, 'draft')).toBe(true);
    expect(sectionLockReason({ isLocked: false, completedStage: 'draft' }, 'draft')).toBeNull();
  });
  it('locked section is never writable (SECTION_LOCKED)', () => {
    expect(isSectionWritable({ isLocked: true, completedStage: null }, 'final')).toBe(false);
    expect(sectionLockReason({ isLocked: true }, 'final')?.code).toBe('SECTION_LOCKED');
  });
  it('prior-stage-completed section is frozen even when unlocked (STAGE_LOCKED)', () => {
    expect(isSectionWritable({ isLocked: false, completedStage: 'draft' }, 'final')).toBe(false);
    expect(sectionLockReason({ isLocked: false, completedStage: 'draft' }, 'final')?.code).toBe('STAGE_LOCKED');
  });
  it('null completed_stage (never advanced) is writable', () => {
    expect(isSectionWritable({ isLocked: false, completedStage: null }, 'final')).toBe(true);
  });
});
