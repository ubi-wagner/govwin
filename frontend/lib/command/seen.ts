/**
 * Command Center "last looked at" watermark (mig 179 command_seen_state).
 *
 * The tab count badge answers "how many need me"; this answers "which tabs have NEW items since I
 * last looked" — the email-inbox blue-dot. A lane item is new-to-me iff its timestamp > my
 * last_seen_at for that (scope, tab). Personal data keyed by user_id: the app always filters
 * WHERE user_id = <session user>, so this rides the app pool (`sql`) with no tenant context.
 *
 * scope is the CC instance ('admin' | 'tenant:<uuid>' | 'partner:<uuid>'); tab is the tab key.
 */
import { sql } from '@/lib/db';

/** last_seen_at per tab (camelCase off toCamel — declare the row field camelCase). */
export async function getCommandSeen(userId: string, scope: string): Promise<Map<string, Date>> {
  const m = new Map<string, Date>();
  if (!userId || !scope) return m;
  try {
    const rows = await sql<{ tab: string; lastSeenAt: Date }[]>`
      SELECT tab, last_seen_at FROM command_seen_state
      WHERE user_id = ${userId} AND scope = ${scope}`;
    for (const r of rows) m.set(r.tab, r.lastSeenAt);
  } catch (e) {
    console.error('[command/seen] read failed', e);
  }
  return m;
}

/** Stamp "I just looked at this tab" (upsert last_seen_at = now). Best-effort — never throws. */
export async function markCommandSeen(userId: string, scope: string, tab: string): Promise<void> {
  if (!userId || !scope || !tab) return;
  try {
    await sql`
      INSERT INTO command_seen_state (user_id, scope, tab, last_seen_at, updated_at)
      VALUES (${userId}, ${scope}, ${tab}, now(), now())
      ON CONFLICT (user_id, scope, tab)
      DO UPDATE SET last_seen_at = now(), updated_at = now()`;
  } catch (e) {
    console.error('[command/seen] mark failed', e);
  }
}

/** hasNew = a watermark exists for this tab AND the newest lane item is newer than it. First visit
 *  (no watermark) → false (nothing flagged until there's a baseline to compare against). */
export function isNew(seen: Map<string, Date>, tab: string, newestItemAt: Date | string | null | undefined): boolean {
  const ls = seen.get(tab);
  if (!ls || !newestItemAt) return false;
  const t = newestItemAt instanceof Date ? newestItemAt : new Date(newestItemAt);
  return Number.isFinite(t.getTime()) && t.getTime() > new Date(ls).getTime();
}

/** Validation for the mark-seen route — keeps junk rows out of the table. */
export function isValidScope(scope: string): boolean {
  return /^(admin|tenant:[0-9a-fA-F-]{36}|partner:[0-9a-fA-F-]{36})$/.test(scope);
}
export const KNOWN_TABS = new Set(['opp', 'todos', 'workflows', 'activity', 'admin', 'tenant', 'system']);
