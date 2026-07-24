import { describe, it, expect } from 'vitest';
import { buildLibraryQuery } from '@/lib/library/library-query';

describe('buildLibraryQuery', () => {
  it('omits empty/blank filters and page 1', () => {
    expect(buildLibraryQuery({})).toBe('');
    expect(buildLibraryQuery({ kind: '', form: '   ', page: 1 })).toBe('');
  });
  it('includes the set filters', () => {
    const qs = new URLSearchParams(buildLibraryQuery({ grain: 'foundation', kind: 'template', context: 'proposal' }));
    expect(qs.get('grain')).toBe('foundation');
    expect(qs.get('kind')).toBe('template');
    expect(qs.get('context')).toBe('proposal');
  });
  it('carries q + page>1 and trims values', () => {
    const qs = new URLSearchParams(buildLibraryQuery({ q: '  bio  ', form: 'ppt', page: 3 }));
    expect(qs.get('q')).toBe('bio');
    expect(qs.get('form')).toBe('ppt');
    expect(qs.get('page')).toBe('3');
  });
});
