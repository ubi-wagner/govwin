/**
 * First-run onboarding: carry what the customer already told us into the workspace they land in.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────
 * The application form asks a company for its tech areas, target programs and target agencies.
 * Acceptance creates the tenant, backfills their opportunity cards, scores them, copies the starter
 * library and backfills templates — and drops those three answers on the floor.
 *
 * The consequence is precise, and it is not "a missing feature". The bucket form ALREADY has a
 * "start from your company profile" button, which reads `tenant_profiles` and does the typing. The
 * accept route writes `tenant_profiles` **zero times**. So the button finds nothing and tells a
 * brand-new customer:
 *
 *     "Your company profile has nothing to copy yet — fill it in on the Profile page
 *      and this will do the typing for you."
 *
 * …asking them to go and type, on another page, the information they typed on the application form
 * ten minutes earlier. Until they do, they author no bucket; with no bucket, `/cards` falls back to
 * recency ordering; and the ranking engine — the thing they are paying for — is inert on day one.
 *
 * Measured on the sandbox before this shipped: **6 of 7 tenants had an empty profile and zero
 * buckets.** The one exception to each was hand-populated. No ToDo type mentions buckets.
 *
 * ── WHY THIS SEEDS THE PROFILE AND NOT THE BUCKETS ───────────────────────────────────────────
 * The product deliberately opens buckets EMPTY: a bucket is the CUSTOMER's own ranking lens, a 1:n
 * they author, and migration 206 removed seeded defaults on purpose so the cap could be a plain
 * authoring budget rather than `seeded + headroom` (the entanglement behind B62). The accept route
 * says so in a comment, and this does not touch it.
 *
 * A profile is a different kind of thing — it is a record of what the company told us, which is
 * exactly what an application IS. Seeding it restores a fact they already stated; it does not
 * impose a lens they did not choose. The customer still opens the bucket form, still presses the
 * button, still edits, still submits. That line is what makes this safe to ship against a stated
 * product decision instead of a reversal of one.
 *
 * ── THE JOIN THIS DEPENDS ON ─────────────────────────────────────────────────────────────────
 * `applications.tenant_id`, added by migration 242 to answer "which application became which
 * customer". Built for the funnel; this is its second consumer.
 */

import { sqlBypass } from '@/lib/db';

/** Trim, drop blanks, de-duplicate case-insensitively, bound the length. */
function clean(values: unknown, max = 20): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export interface ProfileSeedResult {
  seeded: boolean;
  keywords: number;
  agencies: number;
  /** Why nothing was written, when nothing was. Logged, not shown to a customer. */
  reason?: 'no_application' | 'nothing_to_copy' | 'profile_already_filled' | 'error';
}

/**
 * Seed `tenant_profiles` from the application this tenant came from.
 *
 * Idempotent and NON-DESTRUCTIVE: it fills only array columns that are currently empty. A customer
 * who has already curated their profile is never overwritten by their own six-month-old
 * application — that would be the "convenience that discards typing" the bucket prefill is
 * carefully written to avoid, arriving through a side door.
 *
 * Never throws. This runs in the accept route's best-effort tail, where every other step is
 * likewise wrapped: an onboarding convenience must not be able to fail somebody's acceptance.
 */
export async function seedProfileFromApplication(
  tenantId: string,
  applicationId?: string,
): Promise<ProfileSeedResult> {
  try {
    const rows = await sqlBypass<{
      techAreas: string[] | null; targetAgencies: string[] | null;
      targetPrograms: string[] | null; techSummary: string | null;
    }[]>`
      SELECT tech_areas, target_agencies, target_programs, tech_summary
        FROM applications
       WHERE ${applicationId ? sqlBypass`id = ${applicationId}` : sqlBypass`tenant_id = ${tenantId}`}
       ORDER BY created_at DESC
       LIMIT 1`;
    const a = rows[0];
    if (!a) return { seeded: false, keywords: 0, agencies: 0, reason: 'no_application' };

    const keywords = clean(a.techAreas);
    const agencies = clean(a.targetAgencies);
    const programs = clean(a.targetPrograms);
    const summary = typeof a.techSummary === 'string' ? a.techSummary.trim().slice(0, 4000) : '';
    if (!keywords.length && !agencies.length && !programs.length && !summary) {
      return { seeded: false, keywords: 0, agencies: 0, reason: 'nothing_to_copy' };
    }

    // COALESCE-on-empty, per column: an existing non-empty value always wins. Written as one
    // upsert so a tenant with no profile row and a tenant with an empty one take the same path.
    const [saved] = await sqlBypass<{ keywords: string[]; agencyPriorities: string[] }[]>`
      INSERT INTO tenant_profiles
        (tenant_id, keywords, agency_priorities, target_agencies, research_areas,
         technology_focus, updated_at)
      VALUES
        (${tenantId}, ${keywords}, ${agencies}, ${agencies}, ${programs},
         ${summary || null}, now())
      ON CONFLICT (tenant_id) DO UPDATE SET
        keywords          = CASE WHEN COALESCE(array_length(tenant_profiles.keywords, 1), 0) = 0
                                 THEN EXCLUDED.keywords          ELSE tenant_profiles.keywords END,
        agency_priorities = CASE WHEN COALESCE(array_length(tenant_profiles.agency_priorities, 1), 0) = 0
                                 THEN EXCLUDED.agency_priorities ELSE tenant_profiles.agency_priorities END,
        target_agencies   = CASE WHEN COALESCE(array_length(tenant_profiles.target_agencies, 1), 0) = 0
                                 THEN EXCLUDED.target_agencies   ELSE tenant_profiles.target_agencies END,
        research_areas    = CASE WHEN COALESCE(array_length(tenant_profiles.research_areas, 1), 0) = 0
                                 THEN EXCLUDED.research_areas    ELSE tenant_profiles.research_areas END,
        technology_focus  = COALESCE(NULLIF(tenant_profiles.technology_focus, ''), EXCLUDED.technology_focus),
        updated_at        = now()
      RETURNING keywords, agency_priorities`;

    return {
      seeded: true,
      keywords: saved?.keywords?.length ?? 0,
      agencies: saved?.agencyPriorities?.length ?? 0,
    };
  } catch (e) {
    console.error('[onboarding] profile seed from application failed:', e);
    return { seeded: false, keywords: 0, agencies: 0, reason: 'error' };
  }
}
