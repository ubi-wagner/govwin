/**
 * POST /api/applications
 *
 * Public endpoint for the /apply form. Writes a row into the
 * `applications` table with status='pending' for Eric to review.
 *
 * Rate-limited by IP hash in the future (Phase 5); for now relies on
 * the UNIQUE index on LOWER(contact_email) to dedupe by email.
 *
 * Response shape:
 *   201: { data: { id } }
 *   4xx: { error, code, details? }
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { createTask } from '@/lib/tasks/tasks';
import { send } from '@/lib/email';
import { adminNewApplicationAlert } from '@/lib/email-templates';
import { recordContact } from '@/lib/contacts';

const ApplicationSchema = z.object({
  contactEmail: z.string().email().max(200),
  contactName: z.string().min(1).max(200),
  contactTitle: z.string().max(200).nullable().optional(),
  contactPhone: z.string().max(50).nullable().optional(),

  companyName: z.string().min(1).max(300),
  companyWebsite: z.string().max(300).nullable().optional(),
  companySize: z.string().max(100).nullable().optional(),
  companyState: z.string().max(50).nullable().optional(),

  samRegistered: z.boolean().nullable().optional(),
  samCageCode: z.string().max(50).nullable().optional(),
  dunsUei: z.string().max(50).nullable().optional(),
  previousSubmissions: z.number().int().min(0).max(10_000).default(0),
  previousAwards: z.number().int().min(0).max(10_000).default(0),
  previousAwardPrograms: z.string().max(500).nullable().optional(),

  techSummary: z.string().min(20).max(5000),
  techAreas: z.array(z.string().max(100)).default([]),
  targetPrograms: z.array(z.string().max(100)).default([]),
  targetAgencies: z.array(z.string().max(100)).default([]),
  desiredOutcomes: z.array(z.string().max(200)).default([]),

  motivation: z.string().min(10, 'Please tell us what\'s driving your interest').max(2000),
  referralSource: z.string().min(1, 'Please tell us how you heard about us').max(200),

  termsAccepted: z.literal(true),
  termsSignature: z.string().email().max(200).optional(),
  // REQUIRED, with no default. `.default('v1')` meant a request that omitted the version recorded
  // "v1" — silently attributing to the signer an agreement to text they never saw. This column is
  // the evidence of WHAT SOMEBODY AGREED TO; a wrong value here is worse than a refused submission,
  // and the real form always sends it (application-form.tsx shows it to the signer as it signs).
  termsVersion: z.string().min(1).max(50),

  // ── ATTRIBUTION ────────────────────────────────────────────────────────────────────────────
  // The analytics session in the browser when this form was submitted. Optional, deliberately:
  // somebody who phones, is met at a conference, or arrives with the referrer stripped has no
  // session, and a required field here would push the client into inventing one. An invented
  // attribution is worse than an absent one — it is indistinguishable from a real one, and it
  // quietly poisons every campaign number computed from this chain. Joins to `visitor_sessions`,
  // which already carries referrer and the three UTM fields.
  sessionId: z.string().max(120).nullable().optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_JSON' },
      { status: 400 },
    );
  }

  const parsed = ApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Please check the form and fix the highlighted issues.',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // Normalize website URL
  if (input.companyWebsite && !input.companyWebsite.startsWith('http')) {
    input.companyWebsite = 'https://' + input.companyWebsite.replace(/^\/\//, '');
  }

  try {
    // Check if this email already belongs to an existing user
    const existingUser = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE LOWER(email) = ${input.contactEmail.toLowerCase()} LIMIT 1
    `;
    if (existingUser.length > 0) {
      return NextResponse.json({
        error: 'An account with this email already exists. Log in at /login or email eric@rfppipeline.com for help.',
        code: 'EMAIL_EXISTS_USER',
      }, { status: 409 });
    }

    // Domain-match check: prevent duplicate company applications
    const emailDomain = input.contactEmail.split('@')[1]?.toLowerCase();
    const commonDomains = new Set([
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
      'icloud.com', 'protonmail.com', 'mail.com', 'live.com', 'me.com',
      'msn.com', 'ymail.com', 'comcast.net', 'att.net', 'verizon.net',
    ]);

    if (emailDomain && !commonDomains.has(emailDomain)) {
      const safeDomain = emailDomain.replace(/[%_\\]/g, '\\$&');
      // Check applications table
      const existingApp = await sql<{ id: string }[]>`
        SELECT id FROM applications
        WHERE LOWER(contact_email) LIKE ${'%@' + safeDomain}
          AND LOWER(contact_email) != ${input.contactEmail.toLowerCase()}
        LIMIT 1
      `;

      if (existingApp.length > 0) {
        return NextResponse.json({
          error: 'An application from this organization already exists. RFP Pipeline allows one administrator per company. Please contact your organization\'s existing administrator to be added as a team member, or email eric@rfppipeline.com if this is a different company.',
          code: 'DOMAIN_MATCH',
        }, { status: 409 });
      }

      // Check users table too (already onboarded)
      const existingDomainUser = await sql<{ id: string }[]>`
        SELECT id FROM users
        WHERE LOWER(email) LIKE ${'%@' + safeDomain}
        LIMIT 1
      `;

      if (existingDomainUser.length > 0) {
        return NextResponse.json({
          error: 'Your organization already has an account on RFP Pipeline. Please contact your organization\'s administrator to be added as a team member, or email eric@rfppipeline.com if this is a different company.',
          code: 'DOMAIN_MATCH_USER',
        }, { status: 409 });
      }
    }

    // Pull loose metadata we don't promote to named columns
    const userAgent = request.headers.get('user-agent')?.slice(0, 500) ?? null;

    // The person behind the application (migration 243), recorded BEFORE the insert so the link
    // goes in with the row rather than in a follow-up UPDATE that could be interrupted between
    // them. `recordContact` never throws: an application must land whatever our bookkeeping does,
    // and a null id simply leaves the row un-attributed, which is the honest reading.
    const contactId = await recordContact({
      email: input.contactEmail,
      name: input.contactName,
      companyName: input.companyName,
      sessionId: input.sessionId ?? null,
      source: 'application',
    });

    const rows = await sql<{ id: string }[]>`
      INSERT INTO applications (
        contact_email, contact_name, contact_title, contact_phone,
        company_name, company_website, company_size, company_state,
        sam_registered, sam_cage_code, duns_uei,
        previous_submissions, previous_awards, previous_award_programs,
        tech_summary, tech_areas, target_programs, target_agencies, desired_outcomes,
        motivation, referral_source, session_id, contact_id,
        status, terms_accepted_at, terms_version,
        user_agent, metadata
      ) VALUES (
        ${input.contactEmail.toLowerCase()}, ${input.contactName},
        ${input.contactTitle ?? null}, ${input.contactPhone ?? null},
        ${input.companyName}, ${input.companyWebsite ?? null},
        ${input.companySize ?? null}, ${input.companyState ?? null},
        ${input.samRegistered ?? null}, ${input.samCageCode ?? null}, ${input.dunsUei ?? null},
        ${input.previousSubmissions}, ${input.previousAwards},
        ${input.previousAwardPrograms ? [input.previousAwardPrograms] : []}::text[],
        ${input.techSummary},
        ${input.techAreas}::text[],
        ${input.targetPrograms}::text[],
        ${input.targetAgencies}::text[],
        ${input.desiredOutcomes}::text[],
        ${input.motivation}, ${input.referralSource}, ${input.sessionId ?? null}, ${contactId},
        -- terms_version was HARDCODED 'v1' here. The form sends the version it displayed to the
        -- signer, the schema validates it, and this INSERT threw it away and wrote a literal. So
        -- the column whose entire job is to record WHICH agreement somebody accepted said v1 for
        -- every applicant, including those shown v3. Nothing failed and nothing looked wrong: the
        -- row is present, the timestamp right, the value a legal version string. It is visible only
        -- by comparing what was STORED against what was SHOWN — drive-application-intake asserts it.
        'pending', now(), ${input.termsVersion},
        ${userAgent}, ${sql.json({
          termsSignature: input.termsSignature ?? null,
          termsVersion: input.termsVersion,
        })}
      )
      RETURNING id
    `;

    await emitEventSingle({
      namespace: 'capture',
      type: 'application.submitted',
      actor: { type: 'system', id: 'public-apply' },
      tenantId: null,
      payload: { correlationId: randomUUID(), applicationId: rows[0]?.id, companyName: input.companyName },
    });

    // Notify admin of new application
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'eric@rfppipeline.com';
    const adminEmailContent = adminNewApplicationAlert({
      companyName: input.companyName,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      techSummary: input.techSummary.slice(0, 300),
      adminDashboardUrl: `${(process.env.NEXTAUTH_URL || process.env.AUTH_URL) || ''}/admin/applications`,
    });
    await send({
      to: adminEmail,
      subject: adminEmailContent.subject,
      html: adminEmailContent.html,
      kind: 'transactional',
      tenantId: null,
      template: 'admin_new_application',
      // The application row is the natural key: a client that retries the submit gets a new
      // application and a new alert, which is correct — a re-POST of the SAME application cannot
      // reach here, because the insert above would have created a different row.
      idempotencyKey: rows[0]?.id ? `admin_new_application:${rows[0].id}` : undefined,
      tags: ['admin-alert'],
    });

    // Raise an rfp_admin triage ToDo so the application lands in the work-item ledger
    // (with nudges), not only an email — the emitted event otherwise has no consumer.
    // Best-effort: a task failure never 500s the public submit.
    try {
      await createTask({
        actor: { id: 'public-apply', email: null, role: 'master_admin', tenantId: null },
        tenantId: null, assigneeRole: 'rfp_admin', taskType: 'application_triage',
        title: `Review application: ${input.companyName}`,
        description: `${input.contactName} (${input.contactEmail}) applied. ${input.techSummary.slice(0, 200)}`,
        entityType: 'application', entityId: rows[0]?.id, nudgeDays: [1, 3],
      });
    } catch (e) { console.error('[applications] triage task failed', e); }

    return NextResponse.json({ data: { id: rows[0].id } }, { status: 201 });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '23505') {
      // Unique email violation — already applied
      return NextResponse.json(
        {
          error:
            'An application with this email already exists. If you need to update your submission, email eric@rfppipeline.com.',
          code: 'DUPLICATE_EMAIL',
        },
        { status: 409 },
      );
    }
    console.error('applications POST failed', err);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again or email eric@rfppipeline.com.', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
