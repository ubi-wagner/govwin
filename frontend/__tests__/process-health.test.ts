import { describe, expect, it } from 'vitest';
import {
  classifyProcessHealth,
  healthSortWeight,
  HEARTBEAT_STALE_MS,
} from '@/lib/process/health';

const NOW = Date.parse('2026-05-31T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();

describe('classifyProcessHealth', () => {
  it('failing: status failed or any last_error', () => {
    expect(classifyProcessHealth({ status: 'failed' }, NOW)).toBe('failing');
    expect(classifyProcessHealth({ status: 'running', lastError: 'boom' }, NOW)).toBe('failing');
  });

  it('done: completed or cancelled', () => {
    expect(classifyProcessHealth({ status: 'completed' }, NOW)).toBe('done');
    expect(classifyProcessHealth({ status: 'cancelled' }, NOW)).toBe('done');
  });

  it('paused within deadline = waiting (needs a human); past deadline = stalled', () => {
    expect(classifyProcessHealth({ status: 'paused', deadline: ahead(3600_000) }, NOW)).toBe('waiting');
    expect(classifyProcessHealth({ status: 'paused', deadline: ago(1000) }, NOW)).toBe('stalled');
    expect(classifyProcessHealth({ status: 'paused', deadline: null }, NOW)).toBe('waiting');
  });

  it('running with stale heartbeat (>5m) = stalled, else running', () => {
    expect(classifyProcessHealth({ status: 'running', lastHeartbeatAt: ago(HEARTBEAT_STALE_MS + 1000) }, NOW)).toBe('stalled');
    expect(classifyProcessHealth({ status: 'running', lastHeartbeatAt: ago(60_000) }, NOW)).toBe('running');
  });

  it('running past deadline = stalled', () => {
    expect(classifyProcessHealth({ status: 'running', deadline: ago(1000) }, NOW)).toBe('stalled');
  });

  it('pending/retrying default to running when healthy', () => {
    expect(classifyProcessHealth({ status: 'pending' }, NOW)).toBe('running');
    expect(classifyProcessHealth({ status: 'retrying', lastHeartbeatAt: ago(1000) }, NOW)).toBe('running');
  });
});

describe('healthSortWeight', () => {
  it('orders problems first', () => {
    expect(healthSortWeight('failing')).toBeLessThan(healthSortWeight('stalled'));
    expect(healthSortWeight('stalled')).toBeLessThan(healthSortWeight('waiting'));
    expect(healthSortWeight('waiting')).toBeLessThan(healthSortWeight('running'));
    expect(healthSortWeight('running')).toBeLessThan(healthSortWeight('done'));
  });
});
