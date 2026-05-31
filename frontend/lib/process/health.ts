/**
 * Process health classification — the stall / fail indicators for the process
 * ledger (tenant `portal/<slug>/processes` and the admin monitor).
 *
 * Pure + deterministic (inject `now` for tests). Mirrors the engine's own sweep
 * thresholds: a paused instance past its wait_deadline is STALLED; a running
 * instance with a stale heartbeat (>5m, the WorkflowManager stuck-detection
 * window) or past deadline is STALLED; anything failed / carrying last_error is
 * FAILING; a paused instance still within its deadline is WAITING (needs a human).
 */
export type ProcessHealth = 'failing' | 'stalled' | 'waiting' | 'running' | 'done';

export interface ProcessHealthInput {
  status: string; // running|paused|pending|retrying|completed|failed|cancelled
  deadline?: string | null;
  lastHeartbeatAt?: string | null;
  lastError?: string | null;
}

/** WorkflowManager stale-heartbeat window (manager.py stuck-detection = 5 min). */
export const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

function pastDeadline(deadline: string | null | undefined, now: number): boolean {
  if (!deadline) return false;
  const t = new Date(deadline).getTime();
  return Number.isFinite(t) && t < now;
}

export function classifyProcessHealth(
  p: ProcessHealthInput,
  now: number = Date.now(),
): ProcessHealth {
  if (p.status === 'failed' || (p.lastError && p.lastError.length > 0)) {
    return 'failing';
  }
  if (p.status === 'completed' || p.status === 'cancelled') {
    return 'done';
  }
  if (p.status === 'paused') {
    return pastDeadline(p.deadline, now) ? 'stalled' : 'waiting';
  }
  // running / pending / retrying
  if (p.lastHeartbeatAt) {
    const hb = new Date(p.lastHeartbeatAt).getTime();
    if (Number.isFinite(hb) && now - hb > HEARTBEAT_STALE_MS) return 'stalled';
  }
  if (pastDeadline(p.deadline, now)) return 'stalled';
  return 'running';
}

/** Sort weight so the ledger surfaces problems first (failing → stalled → waiting → …). */
export function healthSortWeight(h: ProcessHealth): number {
  switch (h) {
    case 'failing': return 0;
    case 'stalled': return 1;
    case 'waiting': return 2;
    case 'running': return 3;
    case 'done': return 4;
  }
}
