/**
 * POST /api/analytics — Ingest visitor analytics events (page views + interactions)
 * Called by the client-side tracker. Batches multiple events per request.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'

interface SessionPayload {
  visitorId: string
  screenWidth?: number
  screenHeight?: number
  language?: string
  deviceType?: string
  browser?: string
  os?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
}

interface PageViewPayload {
  visitorId: string
  path: string
  pageTitle?: string
  referrerPath?: string
}

interface InteractionPayload {
  visitorId: string
  path: string
  eventType: string
  target: string
  targetLabel?: string
  metadata?: Record<string, unknown>
}

interface UpdatePayload {
  visitorId: string
  path: string
  timeOnPageMs?: number
  scrollDepthPct?: number
}

interface AnalyticsEvent {
  type: 'session' | 'pageview' | 'interaction' | 'update'
  data: SessionPayload | PageViewPayload | InteractionPayload | UpdatePayload
}

export async function POST(request: NextRequest) {
  let body: { events?: AnalyticsEvent[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const events = body.events
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: 'No events' }, { status: 400 })
  }

  // Cap batch size
  if (events.length > 50) {
    return NextResponse.json({ error: 'Too many events' }, { status: 400 })
  }

  // Extract IP and headers once
  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? null
  const userAgent = request.headers.get('user-agent') ?? null
  const referer = request.headers.get('referer') ?? null
  const country = request.headers.get('cf-ipcountry')
    ?? request.headers.get('x-vercel-ip-country')
    ?? null
  const region = request.headers.get('x-vercel-ip-country-region') ?? null
  const city = request.headers.get('x-vercel-ip-city') ?? null

  try {
    // Ensure tables exist (idempotent — fast no-op after first call)
    await sql`
      CREATE TABLE IF NOT EXISTS visitor_sessions (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL UNIQUE,
        ip_address TEXT, user_agent TEXT, referer TEXT,
        utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT,
        country TEXT, region TEXT, city TEXT,
        device_type TEXT, browser TEXT, os TEXT,
        screen_width INT, screen_height INT, language TEXT,
        waitlist_id INT,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        page_view_count INT NOT NULL DEFAULT 0,
        interaction_count INT NOT NULL DEFAULT 0
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS page_views (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL, path TEXT NOT NULL, page_title TEXT,
        referrer_path TEXT, time_on_page_ms INT, scroll_depth_pct INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS page_interactions (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL, path TEXT NOT NULL,
        event_type TEXT NOT NULL, target TEXT NOT NULL, target_label TEXT,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `

    for (const event of events) {
      if (event.type === 'session') {
        const d = event.data as SessionPayload
        if (!d.visitorId) continue
        await sql`
          INSERT INTO visitor_sessions (
            visitor_id, ip_address, user_agent, referer,
            utm_source, utm_medium, utm_campaign, utm_term, utm_content,
            country, region, city,
            device_type, browser, os, screen_width, screen_height, language
          ) VALUES (
            ${d.visitorId}, ${ipAddress}, ${userAgent}, ${referer},
            ${d.utmSource ?? null}, ${d.utmMedium ?? null}, ${d.utmCampaign ?? null},
            ${d.utmTerm ?? null}, ${d.utmContent ?? null},
            ${country}, ${region}, ${city},
            ${d.deviceType ?? null}, ${d.browser ?? null}, ${d.os ?? null},
            ${d.screenWidth ?? null}, ${d.screenHeight ?? null}, ${d.language ?? null}
          )
          ON CONFLICT (visitor_id) DO UPDATE SET
            last_seen_at = now(),
            ip_address = COALESCE(EXCLUDED.ip_address, visitor_sessions.ip_address),
            user_agent = COALESCE(EXCLUDED.user_agent, visitor_sessions.user_agent),
            country = COALESCE(EXCLUDED.country, visitor_sessions.country),
            region = COALESCE(EXCLUDED.region, visitor_sessions.region),
            city = COALESCE(EXCLUDED.city, visitor_sessions.city)
        `
      } else if (event.type === 'pageview') {
        const d = event.data as PageViewPayload
        if (!d.visitorId || !d.path) continue
        await sql`
          INSERT INTO page_views (visitor_id, path, page_title, referrer_path)
          VALUES (${d.visitorId}, ${d.path}, ${d.pageTitle ?? null}, ${d.referrerPath ?? null})
        `
        await sql`
          UPDATE visitor_sessions
          SET page_view_count = page_view_count + 1, last_seen_at = now()
          WHERE visitor_id = ${d.visitorId}
        `
      } else if (event.type === 'interaction') {
        const d = event.data as InteractionPayload
        if (!d.visitorId || !d.path || !d.eventType || !d.target) continue
        await sql`
          INSERT INTO page_interactions (visitor_id, path, event_type, target, target_label, metadata)
          VALUES (${d.visitorId}, ${d.path}, ${d.eventType}, ${d.target}, ${d.targetLabel ?? null}, ${JSON.stringify(d.metadata ?? {})})
        `
        await sql`
          UPDATE visitor_sessions
          SET interaction_count = interaction_count + 1, last_seen_at = now()
          WHERE visitor_id = ${d.visitorId}
        `
      } else if (event.type === 'update') {
        const d = event.data as UpdatePayload
        if (!d.visitorId || !d.path) continue
        // Update the most recent page view for this visitor+path with time/scroll data
        await sql`
          UPDATE page_views SET
            time_on_page_ms = COALESCE(${d.timeOnPageMs ?? null}, time_on_page_ms),
            scroll_depth_pct = GREATEST(COALESCE(${d.scrollDepthPct ?? null}, 0), COALESCE(scroll_depth_pct, 0))
          WHERE id = (
            SELECT id FROM page_views
            WHERE visitor_id = ${d.visitorId} AND path = ${d.path}
            ORDER BY created_at DESC LIMIT 1
          )
        `
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[POST /api/analytics] Error:', error)
    return NextResponse.json({ error: 'Failed to record analytics' }, { status: 500 })
  }
}
