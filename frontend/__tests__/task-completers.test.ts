/**
 * R5.4 (W-M) — typed completer selection + spec parsing (pure).
 */
import { describe, expect, it } from 'vitest';
import { taskCompleterKind, formFields, uploadHref } from '@/lib/tasks/completers';

describe('taskCompleterKind', () => {
  it('selects upload/form when params.kind says so', () => {
    expect(taskCompleterKind({ kind: 'upload' })).toBe('upload');
    expect(taskCompleterKind({ kind: 'form' })).toBe('form');
  });
  it('defaults to review for unknown/missing/null', () => {
    expect(taskCompleterKind({ kind: 'whatever' })).toBe('review');
    expect(taskCompleterKind({})).toBe('review');
    expect(taskCompleterKind(null)).toBe('review');
    expect(taskCompleterKind(undefined)).toBe('review');
  });
});

describe('formFields', () => {
  it('parses well-formed fields with defaults', () => {
    const f = formFields({ spec: { fields: [{ name: 'poc', label: 'POC' }, { name: 'n', type: 'number', required: true }] } });
    expect(f).toHaveLength(2);
    expect(f[0]).toEqual({ name: 'poc', label: 'POC', type: 'text', required: false });
    expect(f[1]).toEqual({ name: 'n', label: 'n', type: 'number', required: true }); // label falls back to name
  });
  it('drops malformed entries and tolerates a missing spec', () => {
    expect(formFields({ spec: { fields: [{ label: 'no name' }, 42, null, { name: '' }] } })).toEqual([]);
    expect(formFields({})).toEqual([]);
    expect(formFields(null)).toEqual([]);
    expect(formFields({ spec: 'nope' })).toEqual([]);
  });
  it('coerces an unknown field type to text', () => {
    expect(formFields({ spec: { fields: [{ name: 'x', type: 'date' }] } })[0].type).toBe('text');
  });
});

describe('uploadHref', () => {
  it('points a proposal upload task at the proposal workspace', () => {
    expect(uploadHref('acme', 'proposal', 'p1')).toBe('/portal/acme/proposals/p1');
  });
  it('returns null when the entity is not a routable proposal', () => {
    expect(uploadHref('acme', 'opportunity', 'o1')).toBeNull();
    expect(uploadHref('acme', 'proposal', null)).toBeNull();
  });
});
