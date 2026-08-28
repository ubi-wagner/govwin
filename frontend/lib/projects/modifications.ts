/**
 * Contract modifications — the only write path to a CLIN.
 *
 * ── WHY THIS EXISTS RATHER THAN `updateClin` ─────────────────────────────────────────────────
 * `clins.ts` has `createClin` and no update, which reads like an omission and is not. Every CLIN
 * field carries a citation on the ingest-provenance trust order; a plain UPDATE would move the value
 * and leave the badge reading "Read from source", pointing at a page that no longer says that.
 *
 * A contract does not change because somebody edited a field. It changes because a **modification
 * was signed** — so a mod carries its own number, its own signed date and its own document, and
 * executing it is what moves the CLIN. The provenance written at execution cites the MOD, which is
 * the document that is actually true about the new value.
 *
 * ── DRAFT IS NOT EXECUTED ────────────────────────────────────────────────────────────────────
 * The eighth time this capability draws that line. A mod is drafted while it is negotiated and
 * applies only when executed: one act, one transaction, stamping every change row it applied.
 *
 * ── AND EXECUTING DOES NOT REBASELINE ────────────────────────────────────────────────────────
 * A mod that extends the period of performance is exactly when somebody wants the schedule baseline
 * moved, and this module refuses to do it silently. `rebaseline` already exists, already demands a
 * reason, and already moves the current plan without touching what was frozen. Executing raises a
 * **ToDo** asking a person to do it. Two writers on the plan's dates is how a schedule stops being
 * explainable, and an automatic rebaseline would be the second.
 */
import { sql, auditLog } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { emitEventSingle, userActor } from '@/lib/events';
import { createTask } from '@/lib/tasks/tasks';
import type { Role } from '@/lib/rbac';
import { canAccessProject, canAssign, type ProjectActor } from './access';
import { recordProvenance } from './provenance';
import type { Fail, Ok } from './project';

export type ModificationKind = 'administrative' | 'funding' | 'scope' | 'schedule' | 'termination';
const KINDS: readonly ModificationKind[] = ['administrative', 'funding', 'scope', 'schedule', 'termination'];

/** The CLIN fields a mod may move. Mirrors the CHECK in migration 230 — the database is the one
 *  that fails, and this is here so the refusal can name the field instead of a constraint. */
export const AMENDABLE_FIELDS = ['title', 'contract_type', 'pop_start', 'pop_end', 'funded_amount'] as const;
export type AmendableField = (typeof AMENDABLE_FIELDS)[number];

/** Fields whose value is a date, so a malformed one is refused rather than stored as text. */
const DATE_FIELDS = new Set<AmendableField>(['pop_start', 'pop_end']);

export interface ModificationChange {
  id: string;
  action: 'amend' | 'add_clin';
  clinId: string | null;
  clinNumber?: string | null;
  field: AmendableField | null;
  oldValue: string | null;
  newValue: string | null;
  payload: Record<string, unknown>;
  appliedAt: string | null;
  sortIndex: number;
}

export interface Modification {
  id: string;
  projectId: string;
  modNumber: string;
  title: string;
  description: string | null;
  kind: ModificationKind;
  status: 'draft' | 'executed';
  executedOn: string | null;
  executedBy: string | null;
  sourceDocId: string | null;
  createdBy: string | null;
  createdAt: string;
  changes?: ModificationChange[];
}

/** Map migration 230's trigger and constraint codes onto answers a person can act on. */
function fromTrigger(err: unknown): Fail | null {
  const e = err as { code?: string; message?: string; constraint_name?: string };
  if (e?.code === '23001') {
    return {
      ok: false, status: 409, code: 'MODIFICATION_EXECUTED',
      error: e.message?.split('\n')[0]
        ?? 'That modification is executed and cannot be edited. Issue another one.',
    };
  }
  if (e?.code === '23505') {
    return {
      ok: false, status: 409, code: 'DUPLICATE_MOD_NUMBER',
      error: 'A modification with that number already exists on this project. Two documents claiming '
        + 'the same number is not a version — it is an ambiguity nothing downstream can resolve.',
    };
  }
  return null;
}

export async function listModifications(
  tenantId: string,
  projectId: string,
): Promise<Modification[]> {
  try {
    const mods = await sql<Modification[]>`
      SELECT id, project_id, mod_number, title, description, kind, status,
             executed_on, executed_by, source_doc_id, created_by, created_at
        FROM project_modifications
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
       ORDER BY executed_on DESC NULLS FIRST, created_at DESC`;
    if (mods.length === 0) return [];

    // One query for every mod's changes, joined to the CLIN so the UI can render '0002AA' rather
    // than a uuid. N+1 here would be N+1 on a page that renders the whole amendment history.
    const changes = await sql<Array<ModificationChange & { modificationId: string }>>`
      SELECT c.id, c.modification_id, c.action, c.clin_id, k.clin_number, c.field,
             c.old_value, c.new_value, c.payload, c.applied_at, c.sort_index
        FROM project_modification_changes c
        LEFT JOIN project_clins k ON k.id = c.clin_id
       WHERE c.modification_id = ANY(${mods.map((m) => m.id)}::uuid[])
         AND c.tenant_id = ${tenantId}::uuid
       ORDER BY c.sort_index, c.created_at`;

    const by = new Map<string, ModificationChange[]>();
    for (const c of changes) {
      const list = by.get(c.modificationId) ?? [];
      list.push(c);
      by.set(c.modificationId, list);
    }
    return mods.map((m) => ({ ...m, changes: by.get(m.id) ?? [] }));
  } catch (err) {
    console.error('[projects/modifications] listModifications failed:', err);
    return [];
  }
}

export interface ChangeInput {
  action?: 'amend' | 'add_clin';
  clinId?: string | null;
  field?: string | null;
  newValue?: string | number | null;
  /** For `add_clin`: the CLIN to create. Same shape as `ClinInput`, minus the citations. */
  clin?: {
    clinNumber?: string; title?: string; contractType?: string | null;
    popStart?: string | null; popEnd?: string | null; fundedAmount?: number | null;
  };
}

export interface ModificationInput {
  modNumber: string;
  title: string;
  description?: string | null;
  kind?: string;
  sourceDocId?: string | null;
  changes?: ChangeInput[];
}

function asDate(v: unknown): string | null | false {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? false : v;
}

/**
 * Draft a modification, with its change rows.
 *
 * Nothing is applied here — the CLINs are untouched until `executeModification`. The change rows are
 * validated NOW rather than at execution, because a mod discovered to be malformed at the moment
 * somebody signs it is discovered at the worst possible time.
 */
export async function draftModification(
  actor: ProjectActor,
  projectId: string,
  input: ModificationInput,
): Promise<Ok<Modification> | Fail> {
  if (!canAssign(actor.role)) {
    return {
      ok: false, status: 403, code: 'FORBIDDEN',
      error: 'Only a tenant admin can record a contract modification.',
    };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }

  const modNumber = (input.modNumber ?? '').trim();
  const title = (input.title ?? '').trim();
  if (!modNumber || modNumber.length > 60) {
    return { ok: false, status: 400, error: 'A modification number of 1–60 characters is required', code: 'VALIDATION_ERROR' };
  }
  if (!title || title.length > 500) {
    return { ok: false, status: 400, error: 'A title of 1–500 characters is required', code: 'VALIDATION_ERROR' };
  }
  const kind = (input.kind ?? 'funding') as ModificationKind;
  if (!KINDS.includes(kind)) {
    return { ok: false, status: 400, error: `kind must be one of ${KINDS.join(', ')}`, code: 'VALIDATION_ERROR' };
  }

  const rawChanges = Array.isArray(input.changes) ? input.changes : [];
  // An ADMINISTRATIVE mod legitimately changes nothing on the contract — a new contracting officer,
  // a corrected address. Every other kind claims to move something, and one that moves nothing is a
  // document filed under a promise it does not keep.
  if (rawChanges.length === 0 && kind !== 'administrative') {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: `A ${kind} modification has to change something. Record it as 'administrative' if it `
        + 'genuinely does not.',
    };
  }

  try {
    // FK-before-write, scoped to THIS project. A CLIN id from another contract satisfies the FK —
    // it is a real row — and would let one customer's amendment move another customer's money.
    // RLS does not catch it either: both can belong to the same tenant.
    const clinIds = rawChanges.map((c) => c.clinId).filter((v): v is string => Boolean(v));
    const owned = new Set(
      clinIds.length === 0 ? [] : (await sql<{ id: string }[]>`
        SELECT id FROM project_clins
         WHERE id = ANY(${clinIds}::uuid[]) AND project_id = ${projectId}::uuid
           AND tenant_id = ${actor.tenantId}::uuid`).map((r) => r.id),
    );

    const changes: Array<{
      action: 'amend' | 'add_clin'; clinId: string | null; field: string | null;
      newValue: string | null; payload: Record<string, unknown>;
    }> = [];

    for (const [i, c] of rawChanges.entries()) {
      const action = c.action ?? (c.clin ? 'add_clin' : 'amend');
      if (action === 'add_clin') {
        const number = (c.clin?.clinNumber ?? '').trim();
        const clinTitle = (c.clin?.title ?? '').trim();
        if (!number || !clinTitle) {
          return {
            ok: false, status: 400, code: 'VALIDATION_ERROR',
            error: `Change ${i + 1}: a new CLIN needs a number and a title.`,
          };
        }
        for (const [f, v] of [['popStart', c.clin?.popStart], ['popEnd', c.clin?.popEnd]] as const) {
          if (asDate(v) === false) {
            return { ok: false, status: 400, code: 'VALIDATION_ERROR', error: `Change ${i + 1}: ${f} must be YYYY-MM-DD.` };
          }
        }
        const amount = c.clin?.fundedAmount;
        if (amount !== null && amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
          return { ok: false, status: 400, code: 'VALIDATION_ERROR', error: `Change ${i + 1}: fundedAmount must be a non-negative number.` };
        }
        changes.push({ action, clinId: null, field: null, newValue: null, payload: { ...c.clin, clinNumber: number, title: clinTitle } });
        continue;
      }

      if (!c.clinId || !owned.has(c.clinId)) {
        return {
          ok: false, status: 400, code: 'VALIDATION_ERROR',
          error: `Change ${i + 1}: that CLIN does not belong to this project.`,
        };
      }
      const field = String(c.field ?? '');
      if (!(AMENDABLE_FIELDS as readonly string[]).includes(field)) {
        return {
          ok: false, status: 400, code: 'VALIDATION_ERROR',
          error: `Change ${i + 1}: '${field}' is not a field a modification can move. `
            + `One of: ${AMENDABLE_FIELDS.join(', ')}.`,
        };
      }
      if (DATE_FIELDS.has(field as AmendableField) && asDate(c.newValue) === false) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', error: `Change ${i + 1}: ${field} must be YYYY-MM-DD.` };
      }
      if (field === 'funded_amount') {
        const n = Number(c.newValue);
        if (c.newValue === null || c.newValue === '' || !Number.isFinite(n) || n < 0) {
          return { ok: false, status: 400, code: 'VALIDATION_ERROR', error: `Change ${i + 1}: funded_amount must be a non-negative number.` };
        }
      }
      changes.push({
        action: 'amend', clinId: c.clinId, field,
        newValue: c.newValue === null || c.newValue === undefined ? null : String(c.newValue),
        payload: {},
      });
    }

    // ── `withTenant`, NOT `sql.begin` ────────────────────────────────────────────────────────
    // `lib/db.ts`'s `sql` is a Proxy and only the tagged-template CALL is routed through the tenant
    // context; `sql.begin` forwards to the raw pool with `app.tenant_id` unset, where RLS matches
    // nothing and every statement updates zero rows. That is the bug that made the baseline
    // unsettable, and it looks like a lost race rather than an escape.
    const mod = await withTenant(actor.tenantId, async (tx: any) => {
      const [row] = await tx`
        INSERT INTO project_modifications
          (tenant_id, project_id, mod_number, title, description, kind, source_doc_id, created_by)
        VALUES
          (${actor.tenantId}::uuid, ${projectId}::uuid, ${modNumber}, ${title},
           ${(input.description ?? '').trim() || null}, ${kind},
           ${input.sourceDocId ?? null}, ${actor.userId}::uuid)
        RETURNING id, project_id, mod_number, title, description, kind, status,
                  executed_on, executed_by, source_doc_id, created_by, created_at`;

      for (const [i, c] of changes.entries()) {
        await tx`
          INSERT INTO project_modification_changes
            (tenant_id, modification_id, action, clin_id, field, new_value, payload, sort_index)
          VALUES
            (${actor.tenantId}::uuid, ${row.id}::uuid, ${c.action}, ${c.clinId},
             ${c.field}, ${c.newValue}, ${tx.json(c.payload)}, ${i})`;
      }
      return row as Modification;
    });

    await emitEventSingle({
      namespace: 'project',
      type: 'modification.drafted',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, modificationId: mod.id, modNumber, kind, changes: changes.length },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.modification_drafted',
      entityType: 'project_modification', entityId: mod.id,
      metadata: { projectId, modNumber, kind, changes: changes.length },
    });

    return { ok: true, data: { ...mod, changes: [] } };
  } catch (err) {
    const mapped = fromTrigger(err);
    if (mapped) return mapped;
    console.error('[projects/modifications] draftModification failed:', err);
    return { ok: false, status: 500, error: 'Failed to record the modification', code: 'DB_ERROR' };
  }
}

export interface ExecuteResult {
  modificationId: string;
  modNumber: string;
  applied: number;
  clinsCreated: number;
  /** Set when the mod moved a period of performance — the ToDo asking a person to rebaseline. */
  rebaselineTodoId: string | null;
}

/**
 * Execute a modification: apply every change row, in one transaction, and freeze it.
 *
 * The refusals, in order, each protecting something the next step would otherwise destroy:
 *  · not a draft            — an executed mod is a record; re-applying it would double the money
 *  · no signed document     — the CLIN's new provenance has to cite something a person can open
 *  · no execution date      — "when did the contract change" is unanswerable afterwards
 */
export async function executeModification(
  actor: ProjectActor,
  projectId: string,
  modificationId: string,
  input: { executedOn?: string; sourceDocId?: string | null },
): Promise<Ok<ExecuteResult> | Fail> {
  if (!canAssign(actor.role)) {
    return {
      ok: false, status: 403, code: 'FORBIDDEN',
      error: 'Only a tenant admin can execute a contract modification — it moves the contract.',
    };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }

  const executedOn = asDate(input.executedOn);
  if (executedOn === false || executedOn === null) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'An execution date (YYYY-MM-DD) is required — "when did the contract change" has no '
        + 'other answer afterwards.',
    };
  }

  try {
    const [mod] = await sql<Modification[]>`
      SELECT id, project_id, mod_number, title, kind, status, source_doc_id
        FROM project_modifications
       WHERE id = ${modificationId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!mod) return { ok: false, status: 404, error: 'Modification not found', code: 'NOT_FOUND' };
    if (mod.status === 'executed') {
      return {
        ok: false, status: 409, code: 'ALREADY_EXECUTED',
        error: `Modification ${mod.modNumber} is already executed. Issue another one to change it `
          + 'further — that is how a signed amendment is corrected.',
      };
    }

    const docId = input.sourceDocId ?? mod.sourceDocId ?? null;
    if (!docId) {
      return {
        ok: false, status: 409, code: 'NO_SIGNED_DOCUMENT',
        error: 'Attach the signed modification before executing it. The CLIN values it writes will '
          + 'cite this document, and a citation nobody can open is worse than an honest default.',
      };
    }
    const [doc] = await sql<{ id: string }[]>`
      SELECT id FROM project_source_documents
       WHERE id = ${docId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!doc) {
      return { ok: false, status: 400, error: 'That document does not belong to this project', code: 'VALIDATION_ERROR' };
    }

    const changes = await sql<ModificationChange[]>`
      SELECT id, action, clin_id, field, new_value, payload, applied_at, sort_index
        FROM project_modification_changes
       WHERE modification_id = ${modificationId}::uuid AND tenant_id = ${actor.tenantId}::uuid
       ORDER BY sort_index, created_at`;

    // Which fields moved, collected for the events and for the rebaseline decision below.
    const movedPop = changes.some((c) => c.field === 'pop_start' || c.field === 'pop_end');
    const provenanceWrites: Array<{ clinId: string; field: string }> = [];

    const out = await withTenant(actor.tenantId, async (tx: any) => {
      let applied = 0;
      let clinsCreated = 0;

      for (const c of changes) {
        if (c.action === 'add_clin') {
          const p = (c.payload ?? {}) as Record<string, unknown>;
          const [created] = await tx`
            INSERT INTO project_clins
              (tenant_id, project_id, clin_number, title, contract_type, pop_start, pop_end,
               funded_amount, sort_index)
            VALUES
              (${actor.tenantId}::uuid, ${projectId}::uuid, ${String(p.clinNumber)},
               ${String(p.title)}, ${(p.contractType as string) ?? null},
               ${(p.popStart as string) ?? null}::date, ${(p.popEnd as string) ?? null}::date,
               ${p.fundedAmount === null || p.fundedAmount === undefined ? null : Number(p.fundedAmount)},
               ${Number(p.sortIndex ?? 0)})
            RETURNING id`;
          // The change row points at its own RESULT, so the trail closes: a reader of the mod can
          // reach the CLIN it created without matching on a number that may later be amended.
          await tx`
            UPDATE project_modification_changes
               SET clin_id = ${created.id}::uuid, applied_at = now()
             WHERE id = ${c.id}::uuid`;
          provenanceWrites.push({ clinId: created.id, field: 'clin_number' });
          clinsCreated++;
          applied++;
          continue;
        }

        // ── AMEND ────────────────────────────────────────────────────────────────────────────
        // `old_value` is captured HERE, at execution, inside the transaction — not at draft time.
        // A value read when the mod was drafted may have been moved by another mod executed in
        // between, and recording the stale one would make the history read as a change that never
        // happened.
        //
        // READ, then WRITE — two statements, not a subquery inside RETURNING. A `RETURNING (SELECT
        // …)` would in fact see the pre-update snapshot and give the right answer, and that is
        // exactly the objection: the correctness of the audit trail would rest on a reader knowing
        // which snapshot a RETURNING subquery observes. Inside a transaction these two statements
        // say what they mean.
        //
        // The column name cannot be parameterised, so it is switched over a CLOSED set — the same
        // set the database's CHECK enforces and `draftModification` validated against. There is no
        // path here from client text to SQL.
        const field = c.field as AmendableField;
        const [before] = await tx`
          SELECT title, contract_type AS "contractType", pop_start::text AS "popStart",
                 pop_end::text AS "popEnd", funded_amount::text AS "fundedAmount"
            FROM project_clins
           WHERE id = ${c.clinId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
        if (!before) continue;   // RLS, or a CLIN removed since drafting — nothing to amend
        const oldValue: string | null =
            field === 'funded_amount' ? before.fundedAmount
          : field === 'pop_start'     ? before.popStart
          : field === 'pop_end'       ? before.popEnd
          : field === 'contract_type' ? before.contractType
          :                             before.title;

        if (field === 'funded_amount') {
          await tx`
            UPDATE project_clins SET funded_amount = ${c.newValue === null ? null : Number(c.newValue)}
             WHERE id = ${c.clinId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
        } else if (field === 'pop_start') {
          await tx`
            UPDATE project_clins SET pop_start = ${c.newValue}::date
             WHERE id = ${c.clinId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
        } else if (field === 'pop_end') {
          await tx`
            UPDATE project_clins SET pop_end = ${c.newValue}::date
             WHERE id = ${c.clinId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
        } else if (field === 'contract_type') {
          await tx`
            UPDATE project_clins SET contract_type = ${c.newValue}
             WHERE id = ${c.clinId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
        } else {
          await tx`
            UPDATE project_clins SET title = ${c.newValue}
             WHERE id = ${c.clinId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
        }

        await tx`
          UPDATE project_modification_changes
             SET old_value = ${oldValue}, applied_at = now()
           WHERE id = ${c.id}::uuid`;
        provenanceWrites.push({ clinId: c.clinId!, field });
        applied++;
      }

      // Compare-and-swap on `status='draft'`: two concurrent executions cannot both apply. The
      // loser matches zero rows and the whole transaction rolls back, rather than doubling the
      // money and stamping a second date over the first.
      const [flipped] = await tx`
        UPDATE project_modifications
           SET status = 'executed', executed_on = ${executedOn}::date,
               executed_by = ${actor.userId}::uuid, source_doc_id = ${docId}::uuid, updated_at = now()
         WHERE id = ${modificationId}::uuid AND tenant_id = ${actor.tenantId}::uuid
           AND status = 'draft'
        RETURNING id`;
      if (!flipped) throw new Error('EXECUTE_RACE');

      return { applied, clinsCreated };
    });

    // ── PROVENANCE, AFTER THE FACT AND DELIBERATELY OUTSIDE THE TRANSACTION ──────────────────
    // Every value this mod wrote now cites the mod's own signed document, replacing whatever the
    // original contract said about that field. Outside the transaction because a provenance write
    // that fails must not roll back a contract change that a person has signed — the CLIN is
    // correct either way, and the worst case is a field reading "Unverified", which is honest.
    for (const w of provenanceWrites) {
      await recordProvenance({
        tenantId: actor.tenantId, projectId, userId: actor.userId,
        targetTable: 'project_clins', targetId: w.clinId, field: w.field,
        method: 'verified', sourceDocId: docId,
        excerpt: `Set by modification ${mod.modNumber}, executed ${executedOn}.`,
        supersedes: true,
        // `verified` replacing `verified` — equal on the trust order, which compares METHOD and not
        // RECENCY, so the guard would refuse it and leave the badge citing the ORIGINAL contract
        // page while the value had moved. The mod IS the document that is true about this field now.
      });
    }

    // ── THE REBASELINE PROMPT — A TODO, NOT AN ACTION ────────────────────────────────────────
    let rebaselineTodoId: string | null = null;
    if (movedPop) {
      const [project] = await sql<{ name: string; baselinedAt: string | null }[]>`
        SELECT name, baselined_at FROM projects WHERE id = ${projectId}::uuid`;
      // Only worth asking if there IS a baseline to be out of step with. On an unbaselined project
      // the plan is still editable and the question has no meaning.
      if (project?.baselinedAt) {
        const res = await createTask({
          actor: { id: actor.userId, email: null, role: actor.role as Role, tenantId: actor.tenantId },
          tenantId: actor.tenantId,
          assigneeUserId: actor.userId,
          assigneeRole: null,
          taskType: 'project_task',
          title: `Rebaseline ${project.name} after modification ${mod.modNumber}`,
          description: `${mod.modNumber} moved the period of performance. The baseline is unchanged `
            + 'on purpose — it is the original promise. Rebaseline the current plan, with a reason, '
            + 'so variance reads against what was agreed and the schedule stays explainable.',
          entityType: 'project_modification',
          entityId: modificationId,
          dueAt: null,
          params: { projectId, modificationId },
        });
        if (res.ok) rebaselineTodoId = res.data?.taskId ?? null;
        else console.error('[projects/modifications] rebaseline ToDo refused:', res.error);
      }
    }

    await emitEventSingle({
      namespace: 'project',
      type: 'modification.executed',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, modificationId, modNumber: mod.modNumber, kind: mod.kind,
        executedOn, applied: out.applied, clinsCreated: out.clinsCreated,
        movedPeriodOfPerformance: movedPop,
      },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.modification_executed',
      entityType: 'project_modification', entityId: modificationId,
      metadata: { projectId, modNumber: mod.modNumber, executedOn, ...out },
    });

    return {
      ok: true,
      data: {
        modificationId, modNumber: mod.modNumber, applied: out.applied,
        clinsCreated: out.clinsCreated, rebaselineTodoId,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message === 'EXECUTE_RACE') {
      return {
        ok: false, status: 409, code: 'ALREADY_EXECUTED',
        error: 'That modification was executed by someone else a moment ago.',
      };
    }
    const mapped = fromTrigger(err);
    if (mapped) return mapped;
    console.error('[projects/modifications] executeModification failed:', err);
    return { ok: false, status: 500, error: 'Failed to execute the modification', code: 'DB_ERROR' };
  }
}

/** Discard a DRAFT. An executed mod is refused by the trigger, and by this, legibly. */
export async function deleteModification(
  actor: ProjectActor,
  projectId: string,
  modificationId: string,
): Promise<Ok<{ modificationId: string }> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can discard a modification', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  try {
    const [row] = await sql<{ id: string; status: string; modNumber: string }[]>`
      SELECT id, status, mod_number FROM project_modifications
       WHERE id = ${modificationId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!row) return { ok: false, status: 404, error: 'Modification not found', code: 'NOT_FOUND' };
    if (row.status === 'executed') {
      return {
        ok: false, status: 409, code: 'MODIFICATION_EXECUTED',
        error: `Modification ${row.modNumber} is executed. It is the record of what was agreed, and `
          + 'it stays. Issue another modification to change the contract further.',
      };
    }
    await sql`
      DELETE FROM project_modifications
       WHERE id = ${modificationId}::uuid AND tenant_id = ${actor.tenantId}::uuid AND status = 'draft'`;
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.modification_discarded',
      entityType: 'project_modification', entityId: modificationId,
      metadata: { projectId, modNumber: row.modNumber },
    });
    return { ok: true, data: { modificationId } };
  } catch (err) {
    const mapped = fromTrigger(err);
    if (mapped) return mapped;
    console.error('[projects/modifications] deleteModification failed:', err);
    return { ok: false, status: 500, error: 'Failed to discard the modification', code: 'DB_ERROR' };
  }
}
