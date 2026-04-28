/**
 * GET /api/admin/sbir-data/lookup
 *
 * Search sbir_companies and sbir_awards for a given company.
 * Used by the application review UI to auto-enrich application cards.
 *
 * Query params:
 *   company — company name (required)
 *   uei     — UEI identifier (optional, highest-priority match)
 *   domain  — company website domain (optional, second-priority match)
 *
 * Returns: { data: { company, awards, summary } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const company = url.searchParams.get('company');
    const uei = url.searchParams.get('uei');
    const domain = url.searchParams.get('domain');

    if (!company || company.trim().length === 0) {
      return NextResponse.json(
        { error: 'company query parameter is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ---- Company lookup (best match) ----
    let companyRow: Record<string, unknown> | null = null;

    if (uei && uei.trim().length > 0) {
      // Strategy 1: exact UEI match
      const rows = await sql`
        SELECT id, company_name, uei, duns, address1, address2, city, state, zip,
               country, company_url, hubzone_owned, woman_owned, disadvantaged,
               number_awards, created_at, updated_at
        FROM sbir_companies
        WHERE uei = ${uei.trim()}
        LIMIT 1
      `;
      if (rows.length > 0) companyRow = rows[0];
    }

    if (!companyRow && domain && domain.trim().length > 0) {
      // Strategy 2: domain ILIKE match on company_url
      const escapedDomain = domain.trim().replace(/[%_\\]/g, '\\$&');
      const domainPattern = `%${escapedDomain}%`;
      const rows = await sql`
        SELECT id, company_name, uei, duns, address1, address2, city, state, zip,
               country, company_url, hubzone_owned, woman_owned, disadvantaged,
               number_awards, created_at, updated_at
        FROM sbir_companies
        WHERE company_url ILIKE ${domainPattern}
        LIMIT 1
      `;
      if (rows.length > 0) companyRow = rows[0];
    }

    if (!companyRow) {
      // Strategy 3: full-text search on company name
      const rows = await sql`
        SELECT id, company_name, uei, duns, address1, address2, city, state, zip,
               country, company_url, hubzone_owned, woman_owned, disadvantaged,
               number_awards, created_at, updated_at
        FROM sbir_companies
        WHERE to_tsvector('english', company_name) @@ plainto_tsquery('english', ${company.trim()})
        LIMIT 1
      `;
      if (rows.length > 0) companyRow = rows[0];
    }

    // ---- Awards lookup (same cascading strategy) ----
    let awards: Record<string, unknown>[] = [];

    if (uei && uei.trim().length > 0) {
      awards = await sql`
        SELECT award_title, agency, branch, phase, program, award_year,
               award_amount, topic_code, abstract, uei, company_name,
               company_website, hubzone_owned, woman_owned, disadvantaged
        FROM sbir_awards
        WHERE uei = ${uei.trim()}
        ORDER BY award_year DESC
        LIMIT 50
      `;
    }

    if (awards.length === 0 && domain && domain.trim().length > 0) {
      const escapedDomain = domain.trim().replace(/[%_\\]/g, '\\$&');
      const domainPattern = `%${escapedDomain}%`;
      awards = await sql`
        SELECT award_title, agency, branch, phase, program, award_year,
               award_amount, topic_code, abstract, uei, company_name,
               company_website, hubzone_owned, woman_owned, disadvantaged
        FROM sbir_awards
        WHERE company_website ILIKE ${domainPattern}
        ORDER BY award_year DESC
        LIMIT 50
      `;
    }

    if (awards.length === 0) {
      awards = await sql`
        SELECT award_title, agency, branch, phase, program, award_year,
               award_amount, topic_code, abstract, uei, company_name,
               company_website, hubzone_owned, woman_owned, disadvantaged
        FROM sbir_awards
        WHERE to_tsvector('english', company_name) @@ plainto_tsquery('english', ${company.trim()})
        ORDER BY award_year DESC
        LIMIT 50
      `;
    }

    // ---- Build summary ----
    const totalAwards = awards.length;
    const totalAmount = awards.reduce(
      (sum, a) => sum + (Number(a.awardAmount) || 0),
      0,
    );
    const agencies = [...new Set(awards.map((a) => String(a.agency || '')).filter(Boolean))];
    const phases = [...new Set(awards.map((a) => String(a.phase || '')).filter(Boolean))];
    const years = awards
      .map((a) => String(a.awardYear || ''))
      .filter(Boolean)
      .sort();
    const yearRange = {
      first: years[0] ?? '',
      last: years[years.length - 1] ?? '',
    };

    return NextResponse.json({
      data: {
        company: companyRow ?? null,
        awards,
        summary: {
          totalAwards,
          totalAmount,
          agencies,
          phases,
          yearRange,
        },
      },
    });
  } catch (err) {
    console.error('[sbir-data/lookup] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
