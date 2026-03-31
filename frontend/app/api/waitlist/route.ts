/**
 * POST /api/waitlist
 * Stores an email address on the early-access waitlist.
 */
import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'

export async function POST(request: Request) {
  let body: { email?: string; plan?: string; billingPeriod?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 })
  }

  const plan = body.plan ?? null
  const billingPeriod = body.billingPeriod ?? null

  try {
    // Ensure the waitlist table exists (idempotent)
    await sql`
      CREATE TABLE IF NOT EXISTS waitlist (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        plan TEXT,
        billing_period TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `

    await sql`
      INSERT INTO waitlist (email, plan, billing_period)
      VALUES (${email}, ${plan}, ${billingPeriod})
      ON CONFLICT (email) DO UPDATE SET
        plan = EXCLUDED.plan,
        billing_period = EXCLUDED.billing_period
    `

    return NextResponse.json({ data: { success: true } })
  } catch (error: unknown) {
    console.error('[POST /api/waitlist] Error:', error)
    return NextResponse.json({ error: 'Unable to join waitlist. Please try again.' }, { status: 500 })
  }
}
