/**
 * Resolve a tenant's richest proposal, and sections within it, from the DATA.
 *
 * WHY. Two HITL specs opened with a hard-coded proposal id and a hard-coded section-id GENERATOR:
 *
 *     const P = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';
 *     const Q = (n) => `c3db6000-0000-4000-8000-${String(n).padStart(12, '0')}`;
 *
 * The proposal happens to be seeded, so it survives. The sections are not: nothing in the
 * repository ever creates a `c3db6000-…` row — those ids existed only as rows on a long-lived box.
 * So both specs navigated to a section that is not there, the page they wanted never rendered, and
 * each died on a 60-second `locator.click` timeout that read like a broken preview.
 *
 * Same family as the `lighthouse` tenant that did not exist, the command-centre watermarks nothing
 * seeded, and the six `DRIVE_SOL_ID!` specs: a fixture that lived only as somebody's shell history.
 * Ask the database instead.
 */
import { expect } from '@playwright/test';
import postgres from 'postgres';

export interface ResolvedProposal {
  id: string;
  /** Section ids in DOCUMENT order (sort_index), which is the order a reader sees. */
  sectionIds: string[];
}

/**
 * The tenant's proposal with the MOST sections — the one whose assembly is worth walking — plus
 * its sections in document order.
 *
 * "Most sections" is the right selector for these specs: they exist to photograph or verify a
 * fully-built proposal, and the richest one is that by definition. It also finds the same document
 * after a rebuild, which an id cannot.
 */
export async function resolveRichestProposal(
  tenantSlug: string,
  minSections = 3,
): Promise<ResolvedProposal> {
  const dsn = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  expect(dsn, 'DATABASE_URL_OWNER must be set to resolve the proposal').toBeTruthy();
  const sql = postgres(dsn!, { max: 1 });
  try {
    const [p] = await sql<{ id: string; n: number }[]>`
      SELECT p.id, count(s.id)::int AS n
      FROM proposals p
      JOIN tenants t ON t.id = p.tenant_id AND t.slug = ${tenantSlug}
      JOIN proposal_sections s ON s.proposal_id = p.id
      WHERE p.archived_at IS NULL
      GROUP BY p.id ORDER BY count(s.id) DESC, p.created_at DESC LIMIT 1`;
    expect(p?.n ?? 0, `no ${tenantSlug} proposal with at least ${minSections} sections`)
      .toBeGreaterThanOrEqual(minSections);

    const rows = await sql<{ id: string }[]>`
      SELECT id FROM proposal_sections WHERE proposal_id = ${p.id}
      ORDER BY sort_index ASC NULLS LAST, section_number ASC`;
    console.log(`[resolve] ${tenantSlug} proposal ${p.id} — ${rows.length} sections`);
    return { id: p.id, sectionIds: rows.map((r) => r.id) };
  } finally {
    await sql.end();
  }
}

/**
 * Pick `count` sections spread across the document — first, middle, later — so a walkthrough shows
 * variety rather than three consecutive pages. Clamps to what exists instead of indexing past the
 * end, because a shorter proposal should still produce a usable walk.
 */
export function spreadSections(sectionIds: string[], count: number): string[] {
  if (sectionIds.length === 0) return [];
  const n = Math.min(count, sectionIds.length);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(sectionIds[Math.floor((i * sectionIds.length) / n)]);
  }
  return out;
}
