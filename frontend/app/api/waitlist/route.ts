/**
 * GET  /api/waitlist — Check if email is already on waitlist (admin only)
 * POST /api/waitlist — Public endpoint to join the waitlist
 *
 * No auth required for POST. Inserts into waitlist table.
 * waitlist schema: id, email (UNIQUE), company_name, metadata (JSONB), created_at
 */

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { emitEventSingle, systemActor } from '@/lib/events';
import { recordContact } from '@/lib/contacts';
import { createTask } from '@/lib/tasks/tasks';

export async function GET() {
  // Admin-only check endpoint — not needed for V1 public form
  return NextResponse.json(
    { error: 'Use POST to join waitlist', code: 'NOT_IMPLEMENTED' },
    { status: 501 },
  );
}

export async function POST(request: Request) {
  try {
    // ── Parse body ───────────────────────────────────────────────
    let body: {
      email?: string;
      company_name?: string;
      website?: string;
      notes?: string;
      /** The analytics visitor session, when the browser has one. See migration 242. */
      session_id?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    // ── Input validation ─────────────────────────────────────────
    if (!body.email || typeof body.email !== 'string') {
      return NextResponse.json(
        { error: 'email is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return NextResponse.json(
        { error: 'Invalid email format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Insert into waitlist ─────────────────────────────────────
    try {
      // Write jsonb via sql.json so it round-trips as an object on read (a
      // `${JSON.stringify(x)}::jsonb` write reads back as a STRING — CLIFFNOTES Mistake 36).
      const metadata = sql.json({
        website: body.website ?? null,
        notes: body.notes ?? null,
      });

      // The analytics session that was in the browser. Optional — somebody who arrives by phone
      // or with a stripped referrer has none, and inventing one would be worse than leaving it
      // absent (migration 242). Joins to visitor_sessions for referrer and UTM.
      const sessionId = typeof body.session_id === 'string' && body.session_id.trim()
        ? body.session_id.trim().slice(0, 120) : null;

      const [entry] = await sql<{ id: string; createdAt: string }[]>`
        INSERT INTO waitlist (email, company_name, metadata, session_id)
        VALUES (${body.email.toLowerCase().trim()}, ${body.company_name ?? null}, ${metadata},
                ${sessionId})
        ON CONFLICT (email) DO UPDATE SET
          company_name = COALESCE(EXCLUDED.company_name, waitlist.company_name),
          metadata = waitlist.metadata || EXCLUDED.metadata,
          -- COALESCE keeps the FIRST touch. Somebody who signs up twice was brought here once;
          -- overwriting would credit the last campaign they happened to arrive through, which is
          -- the attribution error most worth avoiding.
          session_id = COALESCE(waitlist.session_id, EXCLUDED.session_id)
        RETURNING id, created_at
      `;

      // The person behind the sign-up (migration 243). `recordContact` never throws — a
      // bookkeeping failure must not cost somebody their place on the list — so a null id here
      // leaves `waitlist.contact_id` unset and the funnel view counts the row as un-attributed,
      // which is the honest reading.
      const contactId = await recordContact({
        email: body.email,
        companyName: body.company_name ?? null,
        sessionId: sessionId,
        source: 'waitlist',
      });
      if (contactId) {
        try {
          await sql`
            UPDATE waitlist SET contact_id = ${contactId}
             WHERE id = ${entry.id} AND contact_id IS NULL`;
        } catch (e) {
          console.error('[waitlist] contact link failed:', e);
        }
      }

      // ── SOMEBODY HAS TO BE TOLD ──────────────────────────────────────────────────────────
      // A waitlist sign-up is a person raising their hand on a public page. Until this existed the
      // row landed, the contact was recorded, `capture:waitlist.joined` was emitted — and NOTHING
      // consumed it. No ToDo, no mail, no surface. The applicant saw a success message and nobody
      // on our side ever found out, which is the same silent-and-total failure the application
      // path was given a ToDo to avoid.
      //
      // A ToDo rather than an email, deliberately: the waitlist is lower-urgency and higher-volume
      // than an application, so a message per sign-up would train an admin to ignore it. The work
      // ledger holds it with a nudge instead, and /admin/waitlist shows the list.
      //
      // Best-effort: a task failure must never cost somebody their place on the list.
      try {
        await createTask({
          actor: { id: 'public-waitlist', email: null, role: 'master_admin', tenantId: null },
          tenantId: null, assigneeRole: 'rfp_admin', taskType: 'admin_review',
          title: `Waitlist sign-up: ${body.company_name?.trim() || body.email.toLowerCase().trim()}`,
          description: `${body.email.toLowerCase().trim()}`
            + `${body.company_name ? ` — ${body.company_name.trim()}` : ''}`
            + ` joined the waitlist. Reach out, or leave it for the next cohort round.`,
          entityType: 'waitlist', entityId: entry.id, nudgeDays: [7],
        });
      } catch (e) {
        console.error('[waitlist] triage ToDo failed (sign-up unaffected):', e);
      }

      try {
        await emitEventSingle({
          namespace: 'capture',
          type: 'waitlist.joined',
          actor: systemActor('waitlist'),
          tenantId: null,
          payload: { email: body.email.toLowerCase().trim(), company: body.company_name ?? null },
        });
      } catch (e) {
        console.error('[waitlist] event emission failed:', e);
      }

      return NextResponse.json(
        { data: { id: entry.id, message: 'Successfully joined waitlist' } },
        { status: 201 },
      );
    } catch (dbErr) {
      console.error('[waitlist] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to join waitlist', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[waitlist] error:', err);
    return NextResponse.json(
      { error: 'Failed to process request', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
