/**
 * Partner company registration (docs/PARTNER_MANAGER_DESIGN.md §4 Branch A).
 *
 * A partner-submitted registration is an `applications` row tagged source='partner' +
 * metadata.partnerId — the SAME intake table + RFP-admin approval a public /apply uses, so the
 * accept route provisions it identically (and, seeing the partner attribution, sets ownership so
 * the company lands in the partner's stable). This module validates + inserts + raises the
 * rfp_admin triage ToDo and the audit event.
 */
import { sqlBypass } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { createTask } from '@/lib/tasks/tasks';
import { runPrecheck } from '@/lib/partner/precheck';
import { randomUUID } from 'crypto';

export interface PartnerRegistrationInput {
  partner: { id: string; email: string | null };
  companyName: string;
  adminName: string;
  adminEmail: string;
  adminPhone?: string | null;
  companyWebsite?: string | null;
  companyState?: string | null;
  description: string; // company info → applications.tech_summary
  partnerNotes?: string | null;
  dedupDecision?: 'clear' | 'confirmed_new';
}

export type RegistrationResult =
  | { ok: true; applicationId: string }
  | { ok: false; status: number; error: string; code: string };

/** Pure validation of the required fields (unit-testable without the DB). */
export function validateRegistration(input: PartnerRegistrationInput):
  | { ok: true }
  | { ok: false; status: number; error: string; code: string } {
  const companyName = input.companyName?.trim();
  const adminName = input.adminName?.trim();
  const adminEmail = input.adminEmail?.trim();
  const description = input.description?.trim();
  if (!companyName || !adminName || !adminEmail || !description) {
    return { ok: false, status: 400, error: 'Company name, admin name, admin email and a description are required', code: 'VALIDATION_ERROR' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    return { ok: false, status: 422, error: 'Admin email is invalid', code: 'VALIDATION_ERROR' };
  }
  if (description.length < 10) {
    return { ok: false, status: 422, error: 'Please give a slightly longer company description', code: 'VALIDATION_ERROR' };
  }
  return { ok: true };
}

export async function submitPartnerRegistration(input: PartnerRegistrationInput): Promise<RegistrationResult> {
  const v = validateRegistration(input);
  if (!v.ok) return v;

  const companyName = input.companyName.trim();
  const adminName = input.adminName.trim();
  const adminEmail = input.adminEmail.trim().toLowerCase();
  const description = input.description.trim();

  // Server-side re-guard (defense in depth beyond the client precheck): D5 email + exact tenant.
  const pre = await runPrecheck(companyName, adminEmail);
  if (pre.emailInUseAsAdmin) {
    return { ok: false, status: 409, code: 'EMAIL_TAKEN', error: 'That admin email already administers a company. Use a different admin, or add this person as a collaborator inside that company.' };
  }
  if (pre.exactExistingTenant) {
    return { ok: false, status: 409, code: 'TENANT_EXISTS', error: 'A company with this name already exists — request manager access instead of registering a new tenant.' };
  }

  const correlationId = randomUUID();
  let applicationId: string;
  try {
    const [row] = await sqlBypass<{ id: string }[]>`
      INSERT INTO applications (
        contact_email, contact_name, contact_phone,
        company_name, company_website, company_state,
        tech_summary, motivation,
        status, source, terms_accepted_at, terms_version, metadata
      ) VALUES (
        ${adminEmail}, ${adminName}, ${input.adminPhone ?? null},
        ${companyName}, ${input.companyWebsite ?? null}, ${input.companyState ?? null},
        ${description}, ${input.partnerNotes ?? null},
        'pending', 'partner', now(), 'v1',
        ${sqlBypass.json({
          partnerId: input.partner.id,
          partnerNotes: input.partnerNotes ?? null,
          dedupDecision: input.dedupDecision ?? 'clear',
          similarCount: pre.similar.length,
          submittedByPartner: true,
          correlationId,
        })}
      )
      RETURNING id`;
    applicationId = row.id;
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') {
      return { ok: false, status: 409, code: 'DUPLICATE_EMAIL', error: 'An application with this admin email already exists.' };
    }
    console.error('[partner/registration] insert failed:', e);
    return { ok: false, status: 500, code: 'DB_ERROR', error: 'Registration failed' };
  }

  // Audit + rfp_admin triage ToDo (best-effort — the row already landed).
  try {
    await emitEventSingle({
      namespace: 'capture', type: 'application.submitted',
      actor: userActor(input.partner.id, input.partner.email ?? undefined),
      tenantId: null,
      payload: { correlationId, applicationId, companyName, source: 'partner', partnerId: input.partner.id, dedupDecision: input.dedupDecision ?? 'clear' },
    });
  } catch (e) { console.error('[partner/registration] event emit failed:', e); }
  try {
    await createTask({
      actor: { id: input.partner.id, email: input.partner.email ?? null, role: 'partner_admin', tenantId: null },
      tenantId: null, assigneeRole: 'rfp_admin', taskType: 'partner_registration_triage',
      title: `Partner registration: ${companyName}`,
      description: `${adminName} (${adminEmail}) — submitted by partner. ${description.slice(0, 200)}`,
      entityType: 'application', entityId: applicationId, nudgeDays: [1, 3],
      params: { source: 'partner', partnerId: input.partner.id },
    });
  } catch (e) { console.error('[partner/registration] triage task failed:', e); }

  return { ok: true, applicationId };
}
