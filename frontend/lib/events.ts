import { sql } from './db';

type ActorType = 'user' | 'system' | 'pipeline' | 'agent';

interface EventMetadata {
  actor: { type: ActorType; id: string; email?: string };
  trigger?: { eventId: string; eventType: string };
  refs?: Record<string, string>;
  payload?: Record<string, unknown>;
}

export function userActor(userId: string, email?: string) {
  return { type: 'user' as const, id: userId, email };
}

export function systemActor(id: string) {
  return { type: 'system' as const, id };
}

export function pipelineActor(workerId: string) {
  return { type: 'pipeline' as const, id: workerId };
}

export function agentActor(role: string, tenantId: string) {
  return { type: 'agent' as const, id: `${role}:${tenantId}` };
}

export async function emitOpportunityEvent(params: { eventType: string; opportunityId?: string; source?: string; metadata: EventMetadata }) {
  try {
    await sql`INSERT INTO opportunity_events (event_type, opportunity_id, source, metadata) VALUES (${params.eventType}, ${params.opportunityId ?? null}, ${params.source ?? null}, ${JSON.stringify(params.metadata)})`;
  } catch (e) {
    console.error('[emitOpportunityEvent] Error:', e);
  }
}

export async function emitCustomerEvent(params: { eventType: string; tenantId?: string; userId?: string; metadata: EventMetadata }) {
  try {
    await sql`INSERT INTO customer_events (event_type, tenant_id, user_id, metadata) VALUES (${params.eventType}, ${params.tenantId ?? null}, ${params.userId ?? null}, ${JSON.stringify(params.metadata)})`;
  } catch (e) {
    console.error('[emitCustomerEvent] Error:', e);
  }
}
