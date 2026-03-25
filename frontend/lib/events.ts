/**
 * Standardized event emitters for all 3 event streams.
 *
 * Every event gets a consistent metadata payload:
 *   actor    — who/what triggered it (user, system, pipeline)
 *   trigger  — upstream event that caused this (for correlation chains)
 *   refs     — entity references (tenant, opp, page, job)
 *   payload  — event-specific data for downstream triggers
 *
 * All functions are non-blocking: they log on failure but never throw.
 * Import only in Server Components or API routes (uses sql from db.ts).
 */
import { sql } from '@/lib/db'
import type { OpportunityEventType, CustomerEventType, ContentEventType } from '@/types'

// ── Actor types ──────────────────────────────────────────────
export interface EventActor {
  type: 'user' | 'system' | 'pipeline'
  id: string
  email?: string
}

export interface EventTrigger {
  eventId: string
  eventType: string
}

// ── Standardized metadata shape ──────────────────────────────
function buildMetadata(opts: {
  actor: EventActor
  trigger?: EventTrigger
  refs?: Record<string, string | null>
  payload?: Record<string, unknown>
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    actor: opts.actor,
  }
  if (opts.trigger) meta.trigger = opts.trigger
  if (opts.refs) meta.refs = opts.refs
  if (opts.payload) meta.payload = opts.payload
  return meta
}

// ── Opportunity Events ───────────────────────────────────────

export async function emitOpportunityEvent(params: {
  opportunityId: string
  eventType: OpportunityEventType
  source: string
  fieldChanged?: string
  oldValue?: string
  newValue?: string
  snapshotHash?: string
  correlationId?: string
  actor: EventActor
  trigger?: EventTrigger
  refs?: Record<string, string | null>
  payload?: Record<string, unknown>
}): Promise<string | null> {
  try {
    const meta = buildMetadata({
      actor: params.actor,
      trigger: params.trigger,
      refs: params.refs,
      payload: params.payload,
    })

    const rows = await sql`
      INSERT INTO opportunity_events
        (opportunity_id, event_type, source, field_changed, old_value, new_value,
         snapshot_hash, correlation_id, metadata)
      VALUES (
        ${params.opportunityId},
        ${params.eventType},
        ${params.source},
        ${params.fieldChanged ?? null},
        ${params.oldValue ?? null},
        ${params.newValue ?? null},
        ${params.snapshotHash ?? null},
        ${params.correlationId ?? null},
        ${JSON.stringify(meta)}::jsonb
      )
      RETURNING id
    `
    return rows[0]?.id ?? null
  } catch (error) {
    console.error(`[emitOpportunityEvent] ${params.eventType} failed:`, error)
    return null
  }
}

// ── Customer Events ──────────────────────────────────────────

export async function emitCustomerEvent(params: {
  tenantId: string
  eventType: CustomerEventType
  userId?: string
  opportunityId?: string
  entityType?: string
  entityId?: string
  description: string
  correlationId?: string
  actor: EventActor
  trigger?: EventTrigger
  refs?: Record<string, string | null>
  payload?: Record<string, unknown>
}): Promise<string | null> {
  try {
    const meta = buildMetadata({
      actor: params.actor,
      trigger: params.trigger,
      refs: params.refs,
      payload: params.payload,
    })

    const rows = await sql`
      INSERT INTO customer_events
        (tenant_id, user_id, event_type, opportunity_id,
         entity_type, entity_id, description, correlation_id, metadata)
      VALUES (
        ${params.tenantId},
        ${params.userId ?? null},
        ${params.eventType},
        ${params.opportunityId ?? null},
        ${params.entityType ?? null},
        ${params.entityId ?? null},
        ${params.description},
        ${params.correlationId ?? null},
        ${JSON.stringify(meta)}::jsonb
      )
      RETURNING id
    `
    return rows[0]?.id ?? null
  } catch (error) {
    console.error(`[emitCustomerEvent] ${params.eventType} failed:`, error)
    return null
  }
}

// ── Content Events ───────────────────────────────────────────

export async function emitContentEvent(params: {
  pageKey: string
  eventType: ContentEventType
  userId?: string
  source: string
  contentSnapshot?: Record<string, unknown> | null
  metadataSnapshot?: Record<string, unknown> | null
  diffSummary: string
  correlationId?: string
  actor: EventActor
  payload?: Record<string, unknown>
}): Promise<string | null> {
  try {
    const meta = buildMetadata({
      actor: params.actor,
      payload: params.payload,
    })

    const rows = await sql`
      INSERT INTO content_events
        (page_key, event_type, user_id, source,
         content_snapshot, metadata_snapshot, diff_summary,
         correlation_id, metadata)
      VALUES (
        ${params.pageKey},
        ${params.eventType},
        ${params.userId ?? null},
        ${params.source},
        ${params.contentSnapshot ? JSON.stringify(params.contentSnapshot) : null}::jsonb,
        ${params.metadataSnapshot ? JSON.stringify(params.metadataSnapshot) : null}::jsonb,
        ${params.diffSummary},
        ${params.correlationId ?? null},
        ${JSON.stringify(meta)}::jsonb
      )
      RETURNING id
    `
    return rows[0]?.id ?? null
  } catch (error) {
    console.error(`[emitContentEvent] ${params.eventType} failed:`, error)
    return null
  }
}

// ── Helpers ──────────────────────────────────────────────────

/** Build an actor for a user action from session data */
export function userActor(userId: string, email?: string): EventActor {
  return { type: 'user', id: userId, email }
}

/** Build an actor for system/automated actions */
export function systemActor(id: string = 'system'): EventActor {
  return { type: 'system', id }
}

/** Build an actor for pipeline worker actions */
export function pipelineActor(workerId: string): EventActor {
  return { type: 'pipeline', id: workerId }
}

/** Compute changed sections between old and new content objects */
export function diffSections(
  oldContent: Record<string, unknown> | null,
  newContent: Record<string, unknown>
): string[] {
  if (!oldContent) return Object.keys(newContent)
  const changed: string[] = []
  for (const key of Object.keys(newContent)) {
    if (JSON.stringify(oldContent[key]) !== JSON.stringify(newContent[key])) {
      changed.push(key)
    }
  }
  return changed
}
