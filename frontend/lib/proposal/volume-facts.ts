/**
 * The identifiers a finished volume prints on itself.
 *
 * `finishVolumeCanvas` needs three things it cannot read off the canvas — who the offeror is, which
 * solicitation this answers, and which terms are the offeror's own. All three live in the database,
 * and every export path needs the same three, so they are loaded once here rather than assembled
 * differently (and inconsistently) at each call site.
 *
 * One query, tenant-scoped, and every field optional: a missing solicitation number suppresses the
 * line that would have carried it rather than printing an empty band or throwing inside a download.
 */
import { sql } from '@/lib/db';
import type { VolumeFacts } from '@/lib/proposal/volume-finish';

/**
 * Load the cover/header facts for one proposal.
 *
 * `artifactType` and `volumeName` are per-ARTIFACT and belong to the caller, which already has
 * them; this fills in only what requires a query. Never throws — an export must not 500 because a
 * cover band could not be labelled.
 */
export async function loadVolumeFacts(
  proposalId: string,
  tenantId: string,
): Promise<Omit<VolumeFacts, 'artifactType' | 'volumeName'>> {
  try {
    // camelCase field names: lib/db applies postgres.toCamel to every column, so a snake_case
    // declaration here would compile and read undefined at runtime (CLAUDE.md, SOP: Data Layer).
    const rows = await sql<Array<{
      companyName: string | null;
      solicitationNumber: string | null;
      solicitationTitle: string | null;
      proposalTitle: string | null;
    }>>`
      SELECT t.name                       AS "companyName",
             cs.solicitation_number       AS "solicitationNumber",
             cs.solicitation_title        AS "solicitationTitle",
             p.title                      AS "proposalTitle"
      FROM proposals p
      JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN curated_solicitations cs ON cs.id = p.solicitation_id
      WHERE p.id = ${proposalId}::uuid AND p.tenant_id = ${tenantId}::uuid
      LIMIT 1
    `;
    const r = rows[0];
    if (!r) return {};

    // The proposal title routinely leads with the topic/solicitation designator
    // ("OSW26BZ04-DP013: T3CP Patent Holiday…"), which is the number to print when the curated
    // record has none of its own — an uncurated or directly-loaded opportunity.
    const fromTitle = (r.proposalTitle ?? '').match(/^\s*([A-Z0-9][A-Z0-9.\-]{5,24})\s*[:—-]/)?.[1] ?? null;

    const [milestones, computed] = await Promise.all([
      loadMilestones(proposalId),
      loadComputedCostFacts(proposalId),
    ]);

    return {
      companyName: r.companyName,
      solicitationNumber: r.solicitationNumber ?? fromTitle,
      emphasise: emphasisTerms(r.companyName, r.solicitationTitle),
      milestones,
      ...computed,
    };
  } catch (e) {
    console.error('[volume-facts] load failed (non-fatal):', e);
    return {};
  }
}

/**
 * The solicitation's own Phase I deliverables, as milestones on a month axis.
 *
 * Source: the curated `solicitation_compliance.custom_variables.phase_i_deliverables` value an RFP
 * admin verified against the announcement — e.g. "Kick-Off Briefing (Day 15); Final Report (Day
 * 120); Initial Phase II Proposal (Day 120)". These are the AGENCY's dates. Drawing them is a
 * restatement of the solicitation, not a plan the offeror is being made to commit to, which is why
 * this is the one schedule the system may render without the offeror having written one.
 *
 * Days convert to months at 30/month, floored to whole months for the axis, with each milestone
 * given a short bar ending on its due month so the figure's diamonds land where the text says.
 */
async function loadMilestones(proposalId: string): Promise<VolumeFacts['milestones']> {
  try {
    const rows = await sql<Array<{ deliverables: string | null }>>`
      SELECT sc.custom_variables -> 'phase_i_deliverables' ->> 'value' AS "deliverables"
      FROM proposals p
      JOIN solicitation_compliance sc ON sc.solicitation_id = p.solicitation_id
      WHERE p.id = ${proposalId}::uuid
      LIMIT 1
    `;
    const raw = rows[0]?.deliverables;
    if (!raw) return null;

    const out: NonNullable<VolumeFacts['milestones']> = [];
    for (const part of raw.split(/[;\n]+/)) {
      const text = part.trim();
      if (!text) continue;
      const m = text.match(/\((?:day|days)\s*(\d{1,4})\)|\((?:month|months)\s*(\d{1,2})\)/i);
      if (!m) continue;
      const month = m[1] ? Math.max(1, Math.round(Number(m[1]) / 30)) : Number(m[2]);
      if (!Number.isFinite(month) || month <= 0 || month > 60) continue;
      const name = text.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (name.length < 3) continue;
      out.push({ name, startMonth: Math.max(0, month - 1), endMonth: month, milestone: true });
    }
    return out.length >= 2 ? out.sort((a, b) => a.endMonth - b.endMonth) : null;
  } catch (e) {
    console.error('[volume-facts] milestones load failed (non-fatal):', e);
    return null;
  }
}

/**
 * The cost build-up and the work share, read back off the COMPUTED cost volume.
 *
 * Not recomputed here. `lib/proposal/cost-volume-canvas.ts` already ran the deterministic burden
 * engine at provision and wrote the result into the cost artifact as native `chart` nodes; reading
 * those is how the figures in a narrative volume are guaranteed to agree with the numbers in the
 * cost volume to the cent. Recomputing would introduce a second source of truth for the one number
 * a contracting officer checks against the form.
 */
async function loadComputedCostFacts(
  proposalId: string,
): Promise<Pick<VolumeFacts, 'cost' | 'workShare'>> {
  try {
    const rows = await sql<Array<{ title: string | null; categories: string[] | null; data: number[] | null }>>`
      SELECT n -> 'content' ->> 'title' AS "title",
             ARRAY(SELECT jsonb_array_elements_text(n -> 'content' -> 'categories')) AS "categories",
             ARRAY(SELECT (jsonb_array_elements_text(n -> 'content' -> 'series' -> 0 -> 'data'))::float) AS "data"
      FROM proposal_sections s
      JOIN proposal_artifacts a ON a.id = s.artifact_id AND a.artifact_type = 'cost'
      CROSS JOIN LATERAL jsonb_array_elements(s.content::jsonb -> 'nodes') n
      WHERE s.proposal_id = ${proposalId}::uuid AND n ->> 'type' = 'chart'
    `;

    const out: Pick<VolumeFacts, 'cost' | 'workShare'> = {};
    for (const r of rows) {
      const cats = r.categories ?? [];
      const vals = r.data ?? [];
      if (cats.length !== vals.length || cats.length === 0) continue;
      if (/cost|build.?up|element/i.test(r.title ?? '')) {
        out.cost = cats.map((label, i) => ({ label, amount: vals[i] }));
      } else if (/work.?share|effort/i.test(r.title ?? '')) {
        // categories are the parties, data their percentages; the first is the small business.
        out.workShare = {
          primePct: vals[0],
          // The floor the chart was drawn against is not stored on it. SBIR Phase I is two-thirds
          // by the SBC; STTR is 40%. Take the lower of the two only when the title says STTR, so a
          // figure never claims compliance against a floor easier than the one that applies.
          floorPct: /sttr/i.test(r.title ?? '') ? 40 : 67,
          primeLabel: cats[0],
          partnerLabel: cats[1] ?? 'Partner / subcontract',
        };
      }
    }
    return out;
  } catch (e) {
    console.error('[volume-facts] computed cost facts load failed (non-fatal):', e);
    return {};
  }
}

/**
 * Terms worth an inline bold run in body copy.
 *
 * Deliberately tiny: the offeror's own name and the multi-word proper nouns out of the solicitation
 * title. `emphasise` bolds only the FIRST occurrence in each block, so a short list produces the
 * scannable page a reviewer navigates by; a long one produces a page that looks shouted.
 */
function emphasisTerms(companyName: string | null, solicitationTitle: string | null): string[] {
  const out: string[] = [];
  if (companyName) out.push(companyName.replace(/,?\s+(inc|llc|ltd|corp)\.?$/i, '').trim());
  for (const m of (solicitationTitle ?? '').matchAll(/\b([A-Z][A-Za-z0-9]{2,}(?:\s+[A-Z][A-Za-z0-9]{2,}){0,2})\b/g)) {
    const term = m[1].trim();
    if (term.length >= 4 && !out.includes(term)) out.push(term);
    if (out.length >= 6) break;
  }
  return out;
}
