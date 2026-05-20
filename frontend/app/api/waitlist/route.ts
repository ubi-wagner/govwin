/**
 * GET  /api/waitlist — Check if email is already on waitlist (admin only)
 * POST /api/waitlist — Public endpoint to join the waitlist
 *
 * No auth required for POST. Inserts into waitlist table.
 * waitlist schema: id, email (UNIQUE), company_name, metadata (JSONB), created_at
 */

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

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
      const metadata = JSON.stringify({
        website: body.website ?? null,
        notes: body.notes ?? null,
      });

      const [entry] = await sql<{ id: string; createdAt: string }[]>`
        INSERT INTO waitlist (email, company_name, metadata)
        VALUES (${body.email.toLowerCase().trim()}, ${body.company_name ?? null}, ${metadata}::jsonb)
        ON CONFLICT (email) DO UPDATE SET
          company_name = COALESCE(EXCLUDED.company_name, waitlist.company_name),
          metadata = waitlist.metadata || EXCLUDED.metadata
        RETURNING id, created_at
      `;

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
