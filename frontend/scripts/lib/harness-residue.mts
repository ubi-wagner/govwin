/**
 * Put the box back as found — by measuring what a run CAUSED, not by remembering what it inserted.
 *
 * WHY THIS IS SHARED CODE AND NOT A LINE IN ONE DRIVE. Two harnesses needed the identical fix
 * within an hour of each other (B119), which is the point at which copying it a third time
 * guarantees the third copy drifts. Both had a teardown; both were wrong the same way.
 *
 * THE FAILURE. A drive deletes the rows it created and reports success, while the WRITES IT MADE
 * had side effects it never inserted and therefore never removed. Saving one document through the
 * product mints library atoms — fourteen for a two-deck run, forty-nine for the primitive-matrix
 * run — none of which appear anywhere in the harness's own bookkeeping. Those atoms land in the
 * tenant library, which is precisely the corpus `verify-db-crud` and the atom lenses read. A
 * harness that pollutes the data other instruments measure is worse than one that cleans up
 * nothing, because the mess looks like data.
 *
 * Measured across one full branch-suite run before this existed: +49 library_atoms, +294 atom_tags,
 * +5 tenant_documents, per run, forever.
 *
 * THE METHOD. Snapshot the ids present before, subtract after, delete the difference. That needs no
 * knowledge of what the product does downstream of a write — and the ignorance is the whole point,
 * since the atoms were a side effect nobody had written down. It cannot reach a row the run did not
 * cause, which a title match very much can: these drives use plausible titles, and the box holds a
 * legitimate `p7 · Introduction and Summary: Counter-UAS…` that a title sweep would have destroyed.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH. Append-only history — `system_events`, `agent_task_log`,
 * `process_instances`, `episodic_memories`, `page_views`. Those SHOULD grow when a drive runs; they
 * are the record that it ran, several lenses assert against them, and erasing them would be the
 * B103 mistake of a harness deleting the evidence another instrument depends on.
 *
 * A LIMIT, STATED. This measures ACCUMULATION, not blast radius. A drive that creates and deletes
 * the same row nets to zero here while still having perturbed data another instrument was reading
 * mid-run. Zero delta is necessary, not sufficient.
 */
import { sqlBypass } from '@/lib/db';

/**
 * Tables a canvas/document harness can cause rows in. `library_atoms` children (atom_tags,
 * atom_members, atom_embeddings, atom_lineage) are all ON DELETE CASCADE — verified against the
 * live catalog — so removing the atom removes them, and listing them here would be a second,
 * driftable statement of a fact the schema already enforces.
 */
export const DOCUMENT_HARNESS_TABLES = ['tenant_documents', 'library_atoms'] as const;

export type ResidueSnapshot = Map<string, Set<string>>;

/** The ids present in each table right now. Take this BEFORE the run writes anything. */
export async function snapshotResidue(
  tables: readonly string[] = DOCUMENT_HARNESS_TABLES,
): Promise<ResidueSnapshot> {
  const snap: ResidueSnapshot = new Map();
  for (const t of tables) {
    const rows = await sqlBypass<Array<{ id: string }>>`SELECT id FROM ${sqlBypass(t)}`;
    snap.set(t, new Set(rows.map((r) => r.id)));
  }
  return snap;
}

export interface ResidueReport {
  /** table → how many rows this run caused and this call removed */
  removed: Record<string, number>;
  /** table → rows this run caused that could NOT be removed */
  stuck: Record<string, number>;
  total: number;
  clean: boolean;
}

/**
 * Remove every row that appeared since the snapshot, and say what happened.
 *
 * Reports rather than throws: a teardown that dies takes the run's real result with it, and the
 * caller is better placed to decide whether leftover rows should fail the run.
 */
export async function reclaimResidue(before: ResidueSnapshot): Promise<ResidueReport> {
  const removed: Record<string, number> = {};
  const stuck: Record<string, number> = {};
  let total = 0;

  for (const [t, priorIds] of before) {
    const after = await sqlBypass<Array<{ id: string }>>`SELECT id FROM ${sqlBypass(t)}`;
    const caused = after.map((r) => r.id).filter((id) => !priorIds.has(id));
    if (caused.length === 0) continue;

    let n = 0;
    try {
      const [row] = await sqlBypass<Array<{ n: number }>>`
        WITH gone AS (DELETE FROM ${sqlBypass(t)} WHERE id = ANY(${caused}::uuid[]) RETURNING 1)
        SELECT count(*)::int AS n FROM gone`;
      n = row?.n ?? 0;
    } catch {
      // A row another table still references cannot go, and saying so beats a silent partial
      // cleanup that reports success.
      n = 0;
    }
    if (n) { removed[t] = n; total += n; }
    if (n !== caused.length) stuck[t] = caused.length - n;
  }

  return { removed, stuck, total, clean: Object.keys(stuck).length === 0 };
}

/** One line for a drive's log. */
export function describeResidue(r: ResidueReport): string {
  const parts = Object.entries(r.removed).map(([t, n]) => `${n} ${t}`);
  const body = parts.length ? parts.join(', ') : 'nothing to reclaim';
  const bad = Object.entries(r.stuck).map(([t, n]) => `${n} ${t} STUCK`).join(', ');
  return `cleanup: ${body}${bad ? ` · ⚠ ${bad}` : ''}`;
}
