/**
 * note — write to the shared board from a Claude Code session.
 *
 * A session's notes otherwise die with it. This is the durable half: what I learned that the human
 * or the in-product companion would want during a drive, anchored to the thing it is about and
 * stamped with the commit it was true at.
 *
 *   cd frontend && npx tsx scripts/note.mts "<note text>" [anchor]
 *
 * The anchor is optional but nearly always worth giving: an anchored note can be surfaced where it
 * is relevant AND checked for staleness. A free-floating note is a chat log entry.
 */
import { execSync } from 'node:child_process';
import { addNote, type AnchorKind } from '../lib/working-notes';

const [, , text, anchor] = process.argv;
if (!text?.trim()) {
  console.error('usage: npx tsx scripts/note.mts "<note>" [anchor]');
  process.exit(2);
}

function inferKind(a?: string): AnchorKind {
  if (!a) return 'general';
  if (a.startsWith('/')) return 'route';
  if (/\.[a-z]{2,4}$/i.test(a) && a.includes('/')) return 'file';
  return 'entity';
}

// The commit this was true at. Without it a note that has silently expired looks exactly like one
// that has not — which is the whole staleness mechanism.
let sha: string | null = null;
try { sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a repo */ }

const id = await addNote({
  note: text, anchor: anchor ?? null, anchorKind: inferKind(anchor),
  author: 'claude_code', commitSha: sha,
});
console.log(id ? `✓ note ${id}${anchor ? ` on ${anchor}` : ''}${sha ? ` @ ${sha.slice(0, 8)}` : ''}` : '✗ the note was not saved');
process.exit(id ? 0 : 1);
