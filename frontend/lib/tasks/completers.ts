/**
 * Typed task completers (W-M/J3). A task's `params.kind` selects how it is
 * completed in the queue: a plain review (approve/dismiss), an upload (go do it,
 * then mark done), a form (fill the spec'd fields), or an acknowledge (read the
 * note and accept — the most atomic completion, used by the broadcast workflow).
 * Pure selection + spec parsing so the rendering component stays declarative and
 * this stays testable.
 */
/**
 * How a ToDo is completed in the queue.
 *  - review       : approve / dismiss
 *  - upload       : go upload, then mark done
 *  - form         : fill the spec'd fields
 *  - acknowledge  : read + acknowledge (the atomic broadcast)
 *  - read_receipt : a broadcast that captures a READ RECEIPT response (who read it, when) — a
 *                   flavored acknowledge whose completion is the receipt the sender can see.
 *  - text_memo    : a free-text ToDo — an optional text memo response + a close disposition
 *                   (Completed / Delegated / Not completed). Inline chat + tasking; the disposition
 *                   is recorded in the result (and the task.completed event) for future triggers.
 *  - thread       : a broadcast GROUP CHAT — the message chain (result.chain[]) is shown and anyone
 *                   in the tenant (incl. a descended shadow admin) can post a timestamped message.
 *                   Nobody is required to respond; it never closes and is not (yet) a trigger item.
 */
export type CompleterKind = 'review' | 'upload' | 'form' | 'acknowledge' | 'read_receipt' | 'text_memo' | 'thread';

/** One entry in a broadcast's message chain (result.chain[]). Typed + timestamped so future
 *  workflows can append their own entry `type`s (e.g. a proposed meeting time, an RSVP, a task). */
export interface ChainEntry {
  by: string;
  name: string | null;
  at: string | null;
  type: string;         // 'message' | 'ack' now; extensible
  text: string | null;
  disposition: string | null;
}

/** Parse result.chain[] defensively into ordered ChainEntry[] (bad entries dropped). */
export function taskChain(result: Record<string, unknown> | null | undefined): ChainEntry[] {
  const raw = result && typeof result === 'object' ? (result as { chain?: unknown }).chain : undefined;
  if (!Array.isArray(raw)) return [];
  const out: ChainEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    if (typeof r.by !== 'string') continue;
    out.push({
      by: r.by,
      name: typeof r.name === 'string' ? r.name : null,
      at: typeof r.at === 'string' ? r.at : null,
      type: typeof r.type === 'string' ? r.type : 'message',
      text: typeof r.text === 'string' ? r.text : null,
      disposition: typeof r.disposition === 'string' ? r.disposition : null,
    });
  }
  return out;
}

export interface FormField {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'number';
  required?: boolean;
}

/**
 * Which completer to render. An explicit `params.kind` always wins; otherwise
 * fall back to the task's workflow default (passed in by the caller from
 * `resolveTaskWorkflow(taskType).completer`) so a ToDo completes the way its
 * defined workflow prescribes — never an unmatched loose task. `fallback`
 * defaults to 'review' for callers that don't resolve a workflow.
 */
export function taskCompleterKind(
  params: Record<string, unknown> | null | undefined,
  fallback: CompleterKind = 'review',
): CompleterKind {
  const kind = params && typeof params === 'object' ? (params as { kind?: unknown }).kind : undefined;
  if (kind === 'upload' || kind === 'form' || kind === 'acknowledge' || kind === 'review'
      || kind === 'read_receipt' || kind === 'text_memo' || kind === 'thread') return kind;
  return fallback;
}

/** Form fields from `params.spec.fields`, defensively parsed (bad entries dropped). */
export function formFields(params: Record<string, unknown> | null | undefined): FormField[] {
  const spec = params && typeof params === 'object' ? (params as { spec?: unknown }).spec : undefined;
  const raw = spec && typeof spec === 'object' ? (spec as { fields?: unknown }).fields : undefined;
  if (!Array.isArray(raw)) return [];
  const out: FormField[] = [];
  for (const f of raw) {
    if (f && typeof f === 'object' && typeof (f as FormField).name === 'string' && (f as FormField).name.trim()) {
      const ff = f as FormField;
      out.push({
        name: ff.name,
        label: typeof ff.label === 'string' && ff.label.trim() ? ff.label : ff.name,
        type: ff.type === 'textarea' || ff.type === 'number' ? ff.type : 'text',
        required: ff.required === true,
      });
    }
  }
  return out;
}

/** The CTA target for an upload task — the entity's workspace (where upload lives). */
export function uploadHref(
  tenantSlug: string,
  entityType: string | null,
  entityId: string | null,
): string | null {
  if (entityType === 'proposal' && entityId) return `/portal/${tenantSlug}/proposals/${entityId}`;
  return null;
}

/**
 * The "open the thing this ToDo is about" deep-link (HITL P4). Generalizes uploadHref across the
 * entity types a ToDo can reference — tenant-plane (needs tenantSlug) and admin-plane. Returns null
 * when there's no sensible destination (the ToDo stays completable without a link).
 *   proposal        → the tenant proposal workspace
 *   content_pages   → the admin Content Studio (via a resolver that maps the row id → type/slug)
 *   source          → the admin Sources workspace
 *   opportunity/solicitation → admin curation
 *   contract        → the tenant contract workspace
 */
export function taskHref(opts: {
  tenantSlug?: string | null;
  entityType: string | null;
  entityId: string | null;
  params?: Record<string, unknown> | null;
}): string | null {
  const { tenantSlug, entityType, entityId, params } = opts;
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case 'proposal': return tenantSlug ? `/portal/${tenantSlug}/proposals/${entityId}` : null;
    // A section-scoped ToDo (SPINE-T1): deep-link straight to the section editor. entityId is the
    // section id; the owning proposalId rides in params (a section URL nests under its proposal).
    case 'section': {
      const proposalId = params && typeof params === 'object' ? (params as { proposalId?: unknown }).proposalId : null;
      return tenantSlug && typeof proposalId === 'string'
        ? `/portal/${tenantSlug}/proposals/${proposalId}/sections/${entityId}` : null;
    }
    case 'contract': return tenantSlug ? `/portal/${tenantSlug}/contracts/${entityId}` : null;
    case 'content_pages': return `/admin/site/content/${entityId}`; // resolver → Studio editor
    case 'source': return `/admin/sources/${entityId}`;
    case 'opportunity': return `/admin/rfp-curation`; // an opp id is not a solId — land on the queue
    case 'solicitation': return `/admin/rfp-curation/${entityId}`; // deep-link straight to the workspace
    // A purchased portal: the TENANT's required workflow-setup page when we have their slug (TW-3),
    // else the admin provisioning cockpit (the rfp_admin proposal_setup gate, PV-4).
    case 'portal': return tenantSlug ? `/portal/${tenantSlug}/portals/${entityId}` : `/admin/provisioning/${entityId}`;
    default: return null;
  }
}
