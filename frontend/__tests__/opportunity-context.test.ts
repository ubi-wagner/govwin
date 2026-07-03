import { describe, it, expect } from 'vitest';
import { opportunityContextSlugs } from '@/lib/opportunity-context';

describe('opportunityContextSlugs', () => {
  it('maps common agency strings to taxonomy slugs', () => {
    expect(opportunityContextSlugs({ agency: 'Department of the Army' })).toEqual(['army']);
    expect(opportunityContextSlugs({ agency: 'U.S. Air Force' })).toEqual(['air_force']);
    expect(opportunityContextSlugs({ agency: 'USAF' })).toEqual(['air_force']);
    expect(opportunityContextSlugs({ agency: 'Office of Naval Research (ONR)' })).toEqual(['navy']);
    expect(opportunityContextSlugs({ agency: 'DARPA' })).toEqual(['darpa']);
    expect(opportunityContextSlugs({ agency: 'National Science Foundation' })).toEqual(['nsf']);
  });

  it('maps program strings to taxonomy slugs', () => {
    expect(opportunityContextSlugs({ program: 'SBIR' })).toEqual(['sbir']);
    expect(opportunityContextSlugs({ program: 'STTR' })).toEqual(['sttr']);
    expect(opportunityContextSlugs({ program: 'Other Transaction Authority' })).toEqual(['ota']);
    expect(opportunityContextSlugs({ program: 'Commercial Solutions Opening' })).toEqual(['cso']);
  });

  it('combines agency + program and dedups', () => {
    const slugs = opportunityContextSlugs({ agency: 'Department of the Air Force', program: 'SBIR/STTR' });
    expect(slugs).toContain('air_force');
    expect(slugs).toContain('sbir');
    expect(slugs).toContain('sttr');
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('contributes nothing for unknown / generic / empty inputs', () => {
    expect(opportunityContextSlugs({ agency: 'Department of Defense' })).toEqual([]);
    expect(opportunityContextSlugs({ agency: null, program: null })).toEqual([]);
    expect(opportunityContextSlugs({})).toEqual([]);
    expect(opportunityContextSlugs({ agency: '', program: 'grant' })).toEqual([]);
  });

  it('does not false-match substrings (army must be a word)', () => {
    // "armory" contains "army" letters but not as a word boundary
    expect(opportunityContextSlugs({ agency: 'Armory Systems Inc' })).toEqual([]);
  });
});
