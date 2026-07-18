import { describe, expect, it } from 'vitest';
import { DEFAULT_SBIR_CSO_SKELETON } from '@/lib/ingest/skeleton';
import { parseSolicitation } from '@/lib/ingest/parse-solicitation';

describe('DEFAULT_SBIR_CSO_SKELETON — the ingest SOP backbone', () => {
  it('is the real DoW SBIR CSO 6-volume structure', () => {
    const names = DEFAULT_SBIR_CSO_SKELETON.volumes.map((v) => v.name);
    expect(names).toEqual([
      'Proposal Cover Sheet', 'Technical Volume', 'Cost Volume',
      'Company Commercialization Report', 'Supporting Documents', 'Fraud, Waste, and Abuse Training',
    ]);
  });

  it('has 22 section molds — the 12-section white paper + cover + cost base/option + CCR + 5 supporting + FWA', () => {
    const total = DEFAULT_SBIR_CSO_SKELETON.volumes.reduce((s, v) => s + v.items.length, 0);
    expect(total).toBe(22);
    const tech = DEFAULT_SBIR_CSO_SKELETON.volumes.find((v) => v.name === 'Technical Volume')!;
    expect(tech.items.length).toBe(12);
    expect(tech.items[0].name).toMatch(/Identification and Significance/);
    // white-paper page budget sums to the 10-page cap
    expect(tech.items.reduce((s, i) => s + (i.pageLimit ?? 0), 0)).toBe(10);
  });

  it('Cost Volume carries a separately-costed Base + Option', () => {
    const cost = DEFAULT_SBIR_CSO_SKELETON.volumes.find((v) => v.name === 'Cost Volume')!;
    expect(cost.items.map((i) => i.name)).toEqual(['Phase I Base Cost Proposal', 'Phase I Option Cost Proposal']);
  });
});

describe('parseSolicitation — always yields a usable structure', () => {
  it('falls back to the default skeleton when no API key / empty text', async () => {
    const r = await parseSolicitation('', { agency: 'Navy' });
    expect(r.source).toBe('default');
    expect(r.volumes.length).toBe(6);
    expect(r.topics).toEqual([]);
    expect(r.compliance.pageLimitTechnical).toBe(10);
  });
});
