/**
 * compliance.save_variable_value (Phase 1 §E15) — THE marquee HITL
 * write site.
 *
 * Every call to this tool is a curator's verified-and-saved compliance
 * decision: "on solicitation X, variable Y has value Z, and I reviewed
 * the source text at excerpt W." The side effects are:
 *
 *   1. UPSERT into solicitation_compliance.custom_variables JSONB
 *      under the variable name. Full metadata stored: value, source
 *      excerpt, notes, verifier, timestamp.
 *   2. Sets verified_by = actor.id and verified_at = now() on the
 *      solicitation_compliance row (row-level proof of human review).
 *   3. writeCurationMemory() — the HITL flywheel. Writes an
 *      episodic_memories row tagged with the solicitation's
 *      namespace key, agent_role='curator', importance=1.0. §H's
 *      memory.search_namespace reads this to pre-fill future
 *      cycles of the same program.
 *
 * Architectural note on storage: named columns on
 * solicitation_compliance (page_limit_technical, font_family, etc.)
 * are written by the AI shredder (§D) as "Claude's best guess." The
 * custom_variables JSONB is the "curator's verified layer." Downstream
 * readers check custom_variables first and fall back to the named
 * columns. This keeps the write path simple (one JSONB update) and
 * preserves a clean provenance distinction (which values were
 * AI-suggested vs. human-verified).
 *
 * Action classification (stored in the memory row):
 *   - `verify`       — curator confirmed the prior value (AI or
 *                     earlier human) unchanged
 *   - `correct`      — curator changed the prior value
 *   - `manual_entry` — no prior value; curator entered fresh
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';
import { writeCurationMemory, type CurationAction } from './curation-memory';

// Known variable names with typed expectations. Used to coerce incoming
// values and reject obvious mismatches. Names not in this map are
// accepted verbatim (freeform text) — admins can register new variables
// via compliance.add_variable (E13).
const KNOWN_TYPES: Record<string, 'int' | 'text' | 'bool' | 'numeric'> = {
  page_limit_technical: 'int',
  page_limit_cost: 'int',
  character_limit_narrative: 'int',
  font_family: 'text',
  font_size: 'text',
  margins: 'text',
  line_spacing: 'text',
  header_required: 'bool',
  header_format: 'text',
  footer_required: 'bool',
  footer_format: 'text',
  submission_format: 'text',
  images_tables_allowed: 'bool',
  slides_allowed: 'bool',
  slide_limit: 'int',
  taba_allowed: 'bool',
  indirect_rate_cap: 'numeric',
  partner_max_pct: 'numeric',
  cost_sharing_required: 'bool',
  cost_volume_format: 'text',
  pi_must_be_employee: 'bool',
  pi_university_allowed: 'bool',
  clearance_required: 'text',
  itar_required: 'bool',
};

/**
 * Known variables that have a REAL typed column on solicitation_compliance. The value is mirrored
 * there so the build actually sees it (see the mirror block below); custom_variables keeps the
 * provenance either way. Fixed map — column names never come from caller input.
 */
const TYPED_COLUMNS: Record<string, string> = {
  page_limit_technical: 'page_limit_technical',
  page_limit_cost: 'page_limit_cost',
  character_limit_narrative: 'character_limit_narrative',
  font_family: 'font_family',
  font_size: 'font_size',
  margins: 'margins',
  line_spacing: 'line_spacing',
  header_required: 'header_required',
  header_format: 'header_format',
  footer_required: 'footer_required',
  footer_format: 'footer_format',
  submission_format: 'submission_format',
  images_tables_allowed: 'images_tables_allowed',
  slides_allowed: 'slides_allowed',
  slide_limit: 'slide_limit',
  taba_allowed: 'taba_allowed',
  indirect_rate_cap: 'indirect_rate_cap',
  partner_max_pct: 'partner_max_pct',
  cost_sharing_required: 'cost_sharing_required',
  cost_volume_format: 'cost_volume_format',
  pi_must_be_employee: 'pi_must_be_employee',
  pi_university_allowed: 'pi_university_allowed',
  clearance_required: 'clearance_required',
  itar_required: 'itar_required',
};

/**
 * Parse a number out of a value that may carry the solicitation's own wording ("10 pages",
 * "$250,000"). Returns undefined when there is NO digit to read — prose like "not stated" or
 * "see the Component instructions" must never coerce to 0, which would silently write a 0-page
 * limit or a $0 ceiling and read as a rule the solicitation states. Absence is a finding.
 */
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const digits = String(value).replace(/[^0-9.-]/g, '');
  if (!/[0-9]/.test(digits)) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

/** Coerce a saved value to the column's type. Returns undefined when it cannot be represented,
 *  so the mirror is skipped rather than writing something the column would misread. */
function coerceForColumn(value: unknown, type: 'int' | 'text' | 'bool' | 'numeric' | undefined): unknown {
  if (value === null) return null;
  switch (type) {
    case 'int': {
      const n = toNumber(value);
      return n === undefined ? undefined : Math.round(n);
    }
    case 'numeric':
      return toNumber(value);
    case 'bool': {
      if (typeof value === 'boolean') return value;
      const s = String(value).trim().toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(s)) return true;
      if (['false', 'no', 'n', '0'].includes(s)) return false;
      return undefined;
    }
    case 'text':
      return typeof value === 'string' ? value : String(value);
    default:
      return undefined; // freeform variable — custom_variables only
  }
}

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
  variableName: z.string().min(1).max(128),
  value: z.unknown(),
  sourceExcerpt: z.string().max(5000).optional(),
  notes: z.string().max(2000).optional(),
  action: z.enum(['verify', 'correct', 'manual_entry']).optional(),
  /** Full source anchor with page, rects, document reference.
   *  Stored alongside the value in custom_variables for provenance. */
  anchor: z.record(z.string(), z.unknown()).optional(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  solicitationId: string;
  variableName: string;
  storedAs: 'custom_variables';
  action: CurationAction;
  verifiedAt: string;
  memoryWritten: boolean;
}

function coerceToType(value: unknown, kind: 'int' | 'text' | 'bool' | 'numeric'): unknown {
  if (value === null || value === undefined) return null;

  if (kind === 'bool') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (['true', 'yes', 'y', '1', 'required', 'mandatory'].includes(v)) return true;
      if (['false', 'no', 'n', '0', 'not required', 'prohibited'].includes(v)) return false;
    }
    throw new ValidationError(`cannot coerce value to boolean: ${JSON.stringify(value)}`);
  }

  if (kind === 'int') {
    if (typeof value === 'boolean') {
      throw new ValidationError('refusing to coerce boolean to int');
    }
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return parseInt(value.trim(), 10);
    throw new ValidationError(`cannot coerce value to int: ${JSON.stringify(value)}`);
  }

  if (kind === 'numeric') {
    if (typeof value === 'boolean') {
      throw new ValidationError('refusing to coerce boolean to numeric');
    }
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const n = parseFloat(value.trim().replace(/%$/, ''));
      if (!Number.isNaN(n)) return n;
    }
    throw new ValidationError(`cannot coerce value to numeric: ${JSON.stringify(value)}`);
  }

  // text
  if (typeof value === 'string') return value.trim();
  return String(value);
}

export const complianceSaveVariableValueTool = defineTool<Input, Output>({
  name: 'compliance.save_variable_value',
  namespace: 'compliance',
  description:
    'Save a curator-verified compliance value. UPSERTs into solicitation_compliance.custom_variables, sets verified_by/verified_at, and writes a namespace-tagged episodic memory for §H cross-cycle pre-fill.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { solicitationId, variableName, value, sourceExcerpt, notes } = input;
    const actorId = ctx.actor.id;

    // Coerce value if it's a known variable type. Unknown names pass
    // through as-is (freeform).
    const knownType = KNOWN_TYPES[variableName];
    const coerced = knownType ? coerceToType(value, knownType) : value;

    // Preflight: fetch namespace + existing compliance row + prior
    // custom_variables value (for action inference).
    let preflight: { namespace: string | null; compId: string | null; priorJson: unknown }[];
    try {
      preflight = await sql<
      { namespace: string | null; compId: string | null; priorJson: unknown }[]
    >`
      SELECT cs.namespace,
             sc.id AS comp_id,
             CASE
               WHEN sc.id IS NULL THEN NULL
               -- ::text disambiguates the parameter for the -> operator (jsonb->text vs
               -- jsonb->int) — an untyped $n here is a 42P18 parse error on EVERY call.
               ELSE sc.custom_variables->${variableName}::text
             END AS prior_json
      FROM curated_solicitations cs
      LEFT JOIN solicitation_compliance sc ON sc.solicitation_id = cs.id
      WHERE cs.id = ${solicitationId}::uuid
    `;
    } catch (err) {
      console.error('[compliance.save_variable_value] preflight query failed:', err);
      throw err;
    }
    if (preflight.length === 0) {
      throw new NotFoundError(`solicitation not found: ${solicitationId}`);
    }
    const { namespace, compId, priorJson } = preflight[0];

    // Infer action. prior_json is the JSONB payload we wrote last time
    // (wrapped with metadata), so extract its `value` field for
    // comparison. If no prior entry, manual_entry.
    const priorValue = (priorJson && typeof priorJson === 'object' && 'value' in priorJson)
      ? (priorJson as { value: unknown }).value
      : null;

    const inferredAction: CurationAction = (() => {
      if (priorValue === null || priorValue === undefined) return 'manual_entry';
      if (JSON.stringify(priorValue) === JSON.stringify(coerced)) return 'verify';
      return 'correct';
    })();
    const action = input.action ?? inferredAction;

    // UPSERT. custom_variables is JSONB; merge our key on top of any
    // prior custom_variables object.
    const payload = {
      value: coerced,
      source_excerpt: sourceExcerpt ?? null,
      notes: notes ?? null,
      verified_by: actorId,
      verified_at: new Date().toISOString(),
      // Full source anchor — carries page, rects, document reference,
      // section context. Used by the compliance matrix for provenance
      // display and click-to-navigate. Also stored in HITL memory.
      anchor: input.anchor ?? null,
    };

    let verifiedAt: Date;

    try {
      if (compId === null) {
        const rows = await sql<{ verifiedAt: Date }[]>`
          INSERT INTO solicitation_compliance
            (solicitation_id, custom_variables, verified_by, verified_at)
          VALUES
            (${solicitationId}::uuid,
             jsonb_build_object(${variableName}::text, ${sql.json((payload) as Parameters<typeof sql.json>[0])}),
             ${actorId}::uuid, now())
          RETURNING verified_at
        `;
        verifiedAt = rows[0].verifiedAt;
      } else {
        const rows = await sql<{ verifiedAt: Date }[]>`
          UPDATE solicitation_compliance
          SET custom_variables = COALESCE(custom_variables, '{}'::jsonb)
                                 || jsonb_build_object(${variableName}::text, ${sql.json((payload) as Parameters<typeof sql.json>[0])}),
              verified_by = ${actorId}::uuid,
              verified_at = now(),
              updated_at = now()
          WHERE id = ${compId}::uuid
          RETURNING verified_at
        `;
        verifiedAt = rows[0].verifiedAt;
      }
    } catch (err) {
      console.error('[compliance.save_variable_value] upsert failed:', err);
      throw err;
    }

    // Mirror into the TYPED column when this variable has one. custom_variables carries the
    // provenance (excerpt, anchor, who verified, when) but NOTHING downstream reads it: the artifact
    // spec builder, the readiness roll-up, the cost forms and the opportunity card all read the typed
    // `solicitation_compliance` columns. Without this mirror an admin could verify "TABA allowed" or
    // "CMMC Level 1" against the source, see it saved, and still have every consumer see NULL — the
    // verified value would be invisible to the build it exists to govern.
    const column = TYPED_COLUMNS[variableName];
    if (column) {
      try {
        const typed = coerceForColumn(value, KNOWN_TYPES[variableName]);
        if (typed !== undefined) {
          // Column identifiers come from the fixed TYPED_COLUMNS map above — never from input.
          await sql.unsafe(
            `UPDATE solicitation_compliance SET ${column} = $1, updated_at = now() WHERE solicitation_id = $2::uuid`,
            [typed as never, solicitationId],
          );
        }
      } catch (e) {
        // Non-fatal: the value + its provenance are already stored in custom_variables. A type the
        // column rejects is a curation problem to surface, not a reason to lose the verified entry.
        console.error('[compliance.save_variable_value] typed-column mirror failed (non-fatal)', variableName, e);
      }
    }

    // ── Curation revision tracking ──────────────────────────────────
    try {
      await sql`
        INSERT INTO curation_revisions
          (solicitation_id, actor_id, actor_email, revision_type, field_name, old_value, new_value, metadata)
        VALUES (
          ${solicitationId}::uuid,
          ${actorId}::uuid,
          ${ctx.actor.email ?? null},
          'compliance_updated',
          ${variableName},
          ${priorValue !== null && priorValue !== undefined ? JSON.stringify(priorValue) : null},
          ${JSON.stringify(coerced)},
          ${sql.json({ action, sourceExcerpt: sourceExcerpt ?? null })}
        )
      `;
    } catch (revErr) {
      console.error('[compliance.save_variable_value] curation_revisions insert failed:', revErr);
      // Non-fatal — continue
    }

    const isNew = compId === null;
    await emitEventSingle({
      namespace: 'finder',
      type: 'compliance_value.saved',
      actor: { type: ctx.actor.type, id: ctx.actor.id, email: ctx.actor.email ?? undefined },
      tenantId: ctx.tenantId ?? null,
      payload: { correlationId: randomUUID(), solicitationId: input.solicitationId, variableName: input.variableName, action: isNew ? 'created' : 'updated' },
    });

    // THE HITL write — namespace-tagged episodic memory row.
    let memoryWritten = false;
    if (namespace) {
      await writeCurationMemory(ctx, {
        solicitationId,
        namespace,
        action,
        variableName,
        value: coerced,
        sourceExcerpt,
        notes,
      });
      memoryWritten = true;
    }

    ctx.log?.info?.({
      msg: 'compliance.save_variable_value succeeded',
      solicitationId,
      variableName,
      action,
      memoryWritten,
      namespace,
    });

    return {
      solicitationId,
      variableName,
      storedAs: 'custom_variables' as const,
      action,
      verifiedAt: verifiedAt.toISOString(),
      memoryWritten,
    };
  },
});
