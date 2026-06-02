import { describe, expect, it } from 'vitest';
import { filterAndSortProcesses } from '@/lib/process/health';

const NOW = Date.parse('2026-05-31T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();

const rows = [
  { id: 'a', tenantId: 't1', status: 'failed', lastError: 'boom' },
  { id: 'b', tenantId: 't1', status: 'paused', deadline: ahead(3600_000) },          // waiting
  { id: 'c', tenantId: 't2', status: 'paused', deadline: ago(1000) },                // stalled
  { id: 'd', tenantId: 't2', status: 'running', lastHeartbeatAt: ago(60_000) },      // running
  { id: 'e', tenantId: null, status: 'running', lastHeartbeatAt: ago(60_000) },      // admin/system
];

describe('filterAndSortProcesses', () => {
  it('classifies and sorts problems first', () => {
    const out = filterAndSortProcesses(rows, {}, NOW);
    expect(out[0].health).toBe('failing');
    expect(out.map((r) => r.id)).toEqual(['a', 'c', 'b', 'd', 'e']); // failing, stalled, waiting, running, running
  });

  it('filters by tenant', () => {
    const out = filterAndSortProcesses(rows, { tenantId: 't1' }, NOW);
    expect(out.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('filters by health bucket', () => {
    const out = filterAndSortProcesses(rows, { health: 'stalled' }, NOW);
    expect(out.map((r) => r.id)).toEqual(['c']);
  });

  it('combines tenant + health filters', () => {
    const out = filterAndSortProcesses(rows, { tenantId: 't2', health: 'running' }, NOW);
    expect(out.map((r) => r.id)).toEqual(['d']);
  });

  it('null tenantId means all tenants (not just admin rows)', () => {
    const out = filterAndSortProcesses(rows, { tenantId: null }, NOW);
    expect(out.length).toBe(5);
  });
});
