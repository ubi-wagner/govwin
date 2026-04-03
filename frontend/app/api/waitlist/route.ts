/**
 * POST /api/waitlist — Join the waitlist with full registration info
 * Captures form fields + HTTP connection metadata for admin review.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

interface WaitlistBody {
  fullName?: string
  email?: string
  phone?: string
  company?: string
  companySize?: string
  technology?: string
  notes?: string
  plan?: string
  billingPeriod?: string
  visitorId?: string
}

export async function POST(request: NextRequest) {
  let body: WaitlistBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const fullName = body.fullName?.trim() ?? null
  const email = body.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 })
  }
  if (!fullName) {
    return NextResponse.json({ error: 'Full name is required.' }, { status: 400 })
  }

  const phone = body.phone?.trim() || null
  const company = body.company?.trim() || null
  const companySize = body.companySize?.trim() || null
  const technology = body.technology?.trim() || null
  const notes = body.notes?.trim() || null
  const plan = body.plan ?? null
  const billingPeriod = body.billingPeriod ?? null
  const visitorId = body.visitorId?.trim() || null

  // Capture connection metadata
  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? null
  const userAgent = request.headers.get('user-agent') ?? null
  const referer = request.headers.get('referer') ?? null
  // Railway / Cloudflare geo headers
  const country = request.headers.get('cf-ipcountry')
    ?? request.headers.get('x-vercel-ip-country')
    ?? null
  const region = request.headers.get('x-vercel-ip-country-region') ?? null
  const city = request.headers.get('x-vercel-ip-city') ?? null

  try {
    // Ensure the waitlist table has all columns (idempotent)
    await sql`
      CREATE TABLE IF NOT EXISTS waitlist (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        full_name TEXT,
        phone TEXT,
        company TEXT,
        company_size TEXT,
        technology TEXT,
        notes TEXT,
        plan TEXT,
        billing_period TEXT,
        visitor_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        referer TEXT,
        country TEXT,
        region TEXT,
        city TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `

    // Upsert — if they re-submit, update their info
    const rows = await sql`
      INSERT INTO waitlist (
        email, full_name, phone, company, company_size, technology, notes,
        plan, billing_period, visitor_id, ip_address, user_agent, referer, country, region, city
      )
      VALUES (
        ${email}, ${fullName}, ${phone}, ${company}, ${companySize}, ${technology}, ${notes},
        ${plan}, ${billingPeriod}, ${visitorId}, ${ipAddress}, ${userAgent}, ${referer}, ${country}, ${region}, ${city}
      )
      ON CONFLICT (email) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        company = EXCLUDED.company,
        company_size = EXCLUDED.company_size,
        technology = EXCLUDED.technology,
        notes = EXCLUDED.notes,
        plan = EXCLUDED.plan,
        billing_period = EXCLUDED.billing_period,
        visitor_id = COALESCE(EXCLUDED.visitor_id, waitlist.visitor_id),
        ip_address = EXCLUDED.ip_address,
        user_agent = EXCLUDED.user_agent,
        referer = EXCLUDED.referer,
        country = EXCLUDED.country,
        region = EXCLUDED.region,
        city = EXCLUDED.city
      RETURNING id
    `

    // Link visitor session to waitlist signup
    if (visitorId && rows.length > 0) {
      const waitlistId = (rows[0] as { id: number }).id
      await sql`
        UPDATE visitor_sessions SET waitlist_id = ${waitlistId}
        WHERE visitor_id = ${visitorId}
      `.catch(() => { /* table may not exist yet — non-critical */ })
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error: unknown) {
    console.error('[POST /api/waitlist] Error:', error)
    return NextResponse.json({ error: 'Unable to join waitlist. Please try again.' }, { status: 500 })
  }
}
