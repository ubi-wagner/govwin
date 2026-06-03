/**
 * POST /api/analytics/pageview
 *
 * Public endpoint for recording page views and time-on-page durations.
 * No auth required — serves marketing/public pages.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import crypto from 'crypto';
import { lookupIp, isPublicIp } from '@/lib/geoip';

function detectDeviceType(ua: string | null): string {
  if (!ua) return 'desktop';
  const lower = ua.toLowerCase();
  if (/tablet|ipad|playbook|silk/.test(lower)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry/.test(lower)) return 'mobile';
  return 'desktop';
}

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

interface PageviewBody {
  sessionId?: unknown;
  pagePath?: unknown;
  referrer?: unknown;
  userAgent?: unknown;
  durationMs?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
}

export async function POST(request: NextRequest) {
  // ── Parse body ──────────────────────────────────────────────────────
  let body: PageviewBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 },
    );
  }

  const {
    sessionId,
    pagePath,
    referrer,
    userAgent,
    durationMs,
    utmSource,
    utmMedium,
    utmCampaign,
  } = body;

  // ── Validate required fields ────────────────────────────────────────
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    return NextResponse.json(
      { error: 'sessionId is required', code: 'MISSING_SESSION_ID' },
      { status: 400 },
    );
  }
  if (typeof pagePath !== 'string' || pagePath.trim() === '') {
    return NextResponse.json(
      { error: 'pagePath is required', code: 'MISSING_PAGE_PATH' },
      { status: 400 },
    );
  }

  // ── If this is a duration-only update, just update the page_view row ─
  if (typeof durationMs === 'number' && durationMs > 0) {
    try {
      await sql`
        UPDATE page_views
        SET duration_ms = ${Math.round(durationMs)}
        WHERE session_id = ${sessionId}
          AND page_path = ${pagePath}
          AND duration_ms IS NULL
          AND created_at = (
            SELECT created_at FROM page_views
            WHERE session_id = ${sessionId} AND page_path = ${pagePath}
            ORDER BY created_at DESC LIMIT 1
          )
      `;
    } catch (e) {
      console.error('[analytics/pageview] duration update failed:', e);
      return NextResponse.json(
        { error: 'Failed to update duration', code: 'DURATION_UPDATE_FAILED' },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  // ── Compute derived fields ──────────────────────────────────────────
  const ua = typeof userAgent === 'string' ? userAgent : null;
  const deviceType = detectDeviceType(ua);
  const rawIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
  const ipHash = hashIp(rawIp);

  const refStr = typeof referrer === 'string' && referrer.trim() !== '' ? referrer : null;
  const utmSrc = typeof utmSource === 'string' && utmSource.trim() !== '' ? utmSource : null;
  const utmMed = typeof utmMedium === 'string' && utmMedium.trim() !== '' ? utmMedium : null;
  const utmCmp = typeof utmCampaign === 'string' && utmCampaign.trim() !== '' ? utmCampaign : null;

  // ── UPSERT visitor session ──────────────────────────────────────────
  let sessionInserted = false;
  try {
    const rows = await sql<{ inserted: boolean }[]>`
      INSERT INTO visitor_sessions (id, session_id, first_page, referrer, user_agent, ip_hash, device_type, last_seen_at, page_count)
      VALUES (gen_random_uuid(), ${sessionId}, ${pagePath}, ${refStr}, ${ua}, ${ipHash}, ${deviceType}, NOW(), 1)
      ON CONFLICT (session_id) DO UPDATE SET
        last_seen_at = NOW(),
        page_count = visitor_sessions.page_count + 1
      RETURNING (xmax = 0) AS inserted
    `;
    sessionInserted = rows[0]?.inserted === true;
  } catch (e) {
    console.error('[analytics/pageview] session upsert failed:', e);
    return NextResponse.json(
      { error: 'Failed to record session', code: 'SESSION_UPSERT_FAILED' },
      { status: 500 },
    );
  }

  // ── Enrich a NEW session with connection info (ISP/org/ASN/geo) ──────
  // Best-effort, once per session; the raw IP is used only here and discarded
  // (only the hash + derived fields persist). Never fails the beacon.
  if (sessionInserted && isPublicIp(rawIp)) {
    try {
      const geo = await lookupIp(rawIp);
      if (geo) {
        await sql`
          UPDATE visitor_sessions SET
            country = ${geo.country}, region = ${geo.region}, city = ${geo.city},
            isp = ${geo.isp}, org = ${geo.org}, asn = ${geo.asn},
            timezone = ${geo.timezone}, latitude = ${geo.latitude}, longitude = ${geo.longitude}
          WHERE session_id = ${sessionId}
        `;
      }
    } catch (e) {
      console.error('[analytics/pageview] geo enrichment failed:', e);
    }
  }

  // ── INSERT page view ────────────────────────────────────────────────
  try {
    await sql`
      INSERT INTO page_views (id, session_id, page_path, referrer, utm_source, utm_medium, utm_campaign, created_at)
      VALUES (gen_random_uuid(), ${sessionId}, ${pagePath}, ${refStr}, ${utmSrc}, ${utmMed}, ${utmCmp}, NOW())
    `;
  } catch (e) {
    console.error('[analytics/pageview] page view insert failed:', e);
    return NextResponse.json(
      { error: 'Failed to record page view', code: 'PAGEVIEW_INSERT_FAILED' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
