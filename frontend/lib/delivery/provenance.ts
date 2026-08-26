/**
 * Where a delivery value came from — the ingest-provenance doctrine, one domain over.
 *
 * The rule the proposal spine is built on (docs/INGEST_PROVENANCE.md) is non-negotiable and
 * transfers unchanged:
 *
 *   **A value the product did not read from the source must never look like one it did.**
 *
 * A CLIN's period of performance either came off the executed contract — with a page, an excerpt
 * and a character offset you can go and check — or it was typed by a person, or it is a default
 * nobody has verified. Those are three different facts and the UI has to show three different
 * things.
 *
 * ── ABSENCE IS A FINDING ─────────────────────────────────────────────────────────────────────
 * The hardest case, and the one this exists for: the contract genuinely does not state a value.
 * "The delivery schedule is set out in the Task Order" is not a missing PoP end date — it is a
 * DEFERRAL, and it must render as "Set elsewhere" WITH the citation rather than as a fabricated
 * date or a silent blank. `method: 'verified'` with a citation and no value is how that is
 * recorded.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────────────────────
 * There is no extractor. A contract extractor (Sections B/C/F/G, the CLIN table) is a SIBLING of
 * `lib/ingest/pattern-extract.ts`, not a reuse — the same deterministic, DB-free, cites-everything
 * discipline over a completely different grammar — and it is phase 2. v1 is HITL entry *with*
 * citation, which is already better than most tools manage.
 */
import { sql } from '@/lib/db';

/**
 * The trust order, highest first. Identical to `solicitation_compliance.field_provenance` — the
 * same words mean the same things, so someone who has read one page understands the other.
 */
export const TRUST_ORDER = ['hitl', 'verified', 'override', 'pattern_match', 'ai', 'default'] as const;
export type ProvenanceMethod = (typeof TRUST_ORDER)[number];

/** Rank for comparison. Lower is more trusted. */
export function trustRank(method: string): number {
  const i = (TRUST_ORDER as readonly string[]).indexOf(method);
  return i < 0 ? TRUST_ORDER.length : i;
}

/** Does `next` outrank what is already recorded? Ties go to the incumbent — a re-assertion of the
 *  same method is not a promotion, and treating it as one would let a repeated `ai` guess creep
 *  upward simply by being written twice. */
export function outranks(next: string, current: string | null): boolean {
  if (current === null) return true;
  return trustRank(next) < trustRank(current);
}

export interface ProvenanceRecord {
  targetTable: string;
  targetId: string;
  field: string;
  method: ProvenanceMethod;
  sourceDocId?: string | null;
  page?: number | null;
  excerpt?: string | null;
  charOffset?: number | null;
}

/**
 * Record where a value came from.
 *
 * Upserts on `(target_table, target_id, field)` but **only when the new method outranks the
 * existing one**, so a later `default` cannot quietly overwrite a human's `hitl` entry. That is the
 * whole trust order doing its job at the write rather than at the read; a read-time comparison
 * would leave two rows to disagree about.
 */
export async function recordProvenance(
  params: ProvenanceRecord & { tenantId: string; projectId: string; userId?: string | null },
): Promise<boolean> {
  if (!(TRUST_ORDER as readonly string[]).includes(params.method)) {
    console.error(`[delivery/provenance] unknown method '${params.method}'`);
    return false;
  }
  // A citing method with nothing to cite is the failure this whole module exists to prevent: it
  // renders as "Read from source" against a source nobody can open.
  const cites = params.method === 'verified' || params.method === 'pattern_match';
  if (cites && !params.sourceDocId) {
    console.error(`[delivery/provenance] method '${params.method}' requires a source document — `
      + 'a citation nobody can follow is worse than an honest default');
    return false;
  }

  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO delivery_provenance
        (tenant_id, project_id, target_table, target_id, field, method, source_doc_id, page,
         excerpt, char_offset, created_by)
      VALUES
        (${params.tenantId}::uuid, ${params.projectId}::uuid, ${params.targetTable},
         ${params.targetId}::uuid, ${params.field}, ${params.method},
         ${params.sourceDocId ?? null}, ${params.page ?? null}, ${params.excerpt ?? null},
         ${params.charOffset ?? null}, ${params.userId ?? null})
      ON CONFLICT (target_table, target_id, field) DO UPDATE
        SET method        = EXCLUDED.method,
            source_doc_id = EXCLUDED.source_doc_id,
            page          = EXCLUDED.page,
            excerpt       = EXCLUDED.excerpt,
            char_offset   = EXCLUDED.char_offset,
            created_by    = EXCLUDED.created_by,
            created_at    = now()
        WHERE array_position(
                ARRAY['hitl','verified','override','pattern_match','ai','default'],
                EXCLUDED.method)
              < array_position(
                ARRAY['hitl','verified','override','pattern_match','ai','default'],
                delivery_provenance.method)
      RETURNING id`;
    return rows.length > 0;
  } catch (err) {
    console.error('[delivery/provenance] recordProvenance failed:', err);
    return false;
  }
}

export interface FieldProvenance {
  field: string;
  method: ProvenanceMethod;
  sourceDocId: string | null;
  page: number | null;
  excerpt: string | null;
  charOffset: number | null;
  filename: string | null;
}

/**
 * Provenance for every field of one row, keyed by field name.
 *
 * ⚠️ Row fields are declared camelCase because `lib/db.ts` applies `toCamel`. A snake_case
 * declaration compiles and reads `undefined` at run time; that has shipped twice in this repo.
 */
export async function provenanceFor(
  tenantId: string, targetTable: string, targetId: string,
): Promise<Record<string, FieldProvenance>> {
  try {
    const rows = await sql<FieldProvenance[]>`
      SELECT p.field, p.method, p.source_doc_id, p.page, p.excerpt, p.char_offset,
             d.filename
        FROM delivery_provenance p
        LEFT JOIN delivery_source_documents d ON d.id = p.source_doc_id
       WHERE p.tenant_id = ${tenantId}::uuid
         AND p.target_table = ${targetTable}
         AND p.target_id = ${targetId}::uuid`;
    return Object.fromEntries(rows.map((r) => [r.field, r]));
  } catch (err) {
    console.error('[delivery/provenance] provenanceFor failed:', err);
    return {};
  }
}

export type ProvenanceBadge =
  | { tone: 'sourced'; label: string; detail: string | null }
  | { tone: 'entered'; label: string; detail: string | null }
  | { tone: 'unverified'; label: string; detail: string | null }
  | { tone: 'elsewhere'; label: string; detail: string | null };

/**
 * How a field should read to a person.
 *
 * The four tones are the point. A value with no provenance row at all reads **unverified**, not
 * neutral — silence about where a number came from is the same claim as "we made it up", and
 * showing it as ordinary is how a default becomes indistinguishable from a fact.
 */
export function badgeFor(p: FieldProvenance | undefined, hasValue: boolean): ProvenanceBadge {
  if (!p) {
    return { tone: 'unverified', label: 'Unverified', detail: 'No source recorded for this value.' };
  }
  const where = p.filename
    ? `${p.filename}${p.page ? `, p.${p.page}` : ''}`
    : null;

  // A citation with no value is a DEFERRAL: the contract says where the answer lives and does not
  // give it. That is a finding, not a blank.
  if (!hasValue && (p.method === 'verified' || p.method === 'pattern_match')) {
    return { tone: 'elsewhere', label: 'Set elsewhere', detail: p.excerpt ?? where };
  }

  switch (p.method) {
    case 'verified':
    case 'pattern_match':
      return { tone: 'sourced', label: 'Read from source', detail: where };
    case 'hitl':
    case 'override':
      return { tone: 'entered', label: 'Entered by a person', detail: where };
    case 'ai':
      return { tone: 'unverified', label: 'AI-suggested — unverified', detail: where };
    case 'default':
    default:
      return { tone: 'unverified', label: 'Default — unverified', detail: null };
  }
}
