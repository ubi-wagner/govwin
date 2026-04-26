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
import { emitEventSingle } from '@/lib/events';

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

  motivation: z.string().max(2000).nullable().optional(),
  referralSource: z.string().max(200).nullable().optional(),

  termsAccepted: z.literal(true),
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

  // Pull loose metadata we don't promote to named columns
  const userAgent = request.headers.get('user-agent')?.slice(0, 500) ?? null;

  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO applications (
        contact_email, contact_name, contact_title, contact_phone,
        company_name, company_website, company_size, company_state,
        sam_registered, sam_cage_code, duns_uei,
        previous_submissions, previous_awards, previous_award_programs,
        tech_summary, tech_areas, target_programs, target_agencies, desired_outcomes,
        motivation, referral_source,
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
        ${input.motivation ?? null}, ${input.referralSource ?? null},
        'pending', now(), 'v1',
        ${userAgent}, '{}'::jsonb
      )
      RETURNING id
    `;

    await emitEventSingle({
      namespace: 'identity',
      type: 'application.submitted',
      actor: { type: 'system', id: 'public-apply' },
      tenantId: null,
      payload: { applicationId: rows[0]?.id, companyName: input.companyName },
    });

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
