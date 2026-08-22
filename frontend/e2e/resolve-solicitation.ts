/**
 * Resolve the solicitation a drive spec runs against — from the DATA, not from an env var.
 *
 * WHY THIS EXISTS. Six drive specs opened with some variant of
 *
 *     const SOL = process.env.DRIVE_SOL_ID!;
 *
 * and nothing in the repo set it. The non-null assertion makes that compile; at runtime the URL
 * becomes `/api/admin/rfp-curation/undefined/ingest-assist`, every request 404s, and each spec fails
 * on a bare `expect(false).toBeTruthy()`. Measured on this checkout that was 6 of 11 remaining
 * failures — and every one of them read like a broken feature rather than an unset variable.
 *
 * It is the same defect as the `lighthouse` tenant that did not exist and the command-centre
 * watermarks nothing seeded: a fixture that lived only as shell history on a long-lived box. The
 * cure is the same — derive it from what is actually in the database.
 *
 * WHAT THEY ALL WANT is the DoW 2026 SBIR BAA: a real, shredded, multi-hundred-page solicitation.
 * `t3cp-v1-items` quotes its Volume 1 language directly; `t3cp-molds` needs authored items to mold;
 * `ingest-studio` needs a matrix worth staging. Selecting the curated solicitation with the most
 * extracted text finds it without hard-coding an id that a rebuild will not reproduce.
 *
 * Stand one up (product path — upload + async shred, not a SQL seed):
 *
 *   node scripts/drive-ingest-scenario.mjs "DoW 2026 SBIR BAA (R1)" baa 2026-12-15 \
 *     "docs/DoW 2026 SBIR BAA FULL_R1_04132026.pdf"
 *
 * The env var still wins when set, so a spec can be pointed at one specific document.
 */
import { expect } from '@playwright/test';
import postgres from 'postgres';

/** A shred this short is a crawler lead (title + summary), not a solicitation worth driving. */
export const MIN_DRIVE_CHARS = 100_000;

export interface ResolvedSolicitation {
  id: string;
  chars: number;
  title: string | null;
}

/**
 * The largest shredded curated solicitation, or the one `envVar` names.
 *
 * Fails LOUDLY with the command to fix it — a drive that silently skips is how a suite reports
 * green over work that never ran.
 */
/* Solicitations a drive OWNS and mutates heavily are marked in their title and kept OUT of the
 * shared pool. flex-midwindow curates, pushes, amends and adds a late topic to whatever it is given
 * — so once it stopped skipping, five other specs that resolve "the newest / the largest" silently
 * retargeted onto its artifacts and failed on state they never created. Resolve by IDENTITY, not by
 * recency (docs/FIXTURE_INTEGRITY.md). */
export const OWNED_MARKER = '[owned:';

export async function resolveShreddedSolicitation(
  envVar = 'DRIVE_SOL_ID',
  /** Set to claim the scenario titled "… [owned:<owner>]" instead of the shared pool. */
  owner?: string,
): Promise<ResolvedSolicitation> {
  const pinned = process.env[envVar];
  const dsn = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  expect(dsn, `DATABASE_URL_OWNER must be set to resolve ${envVar}`).toBeTruthy();

  const sql = postgres(dsn!, { max: 1 });
  try {
    const rows = pinned
      ? await sql<{ id: string; chars: number; title: string | null }[]>`
          SELECT cs.id, coalesce(length(cs.full_text), 0)::int AS chars, o.title
          FROM curated_solicitations cs
          LEFT JOIN opportunities o ON o.id = cs.opportunity_id
          WHERE cs.id = ${pinned}::uuid`
      /* The tie-break is load-bearing, not tidiness.
       *
       * Ingesting the same BAA twice produces two rows with byte-identical text, so ordering on
       * length alone leaves the winner to whatever the planner returns first. Measured: two
       * consecutive runs of the same spec resolved DIFFERENT solicitations — one freshly staged,
       * one whose matrix had already landed — and the phase machine correctly answered `review`
       * for the first and `extract` for the second. That reads as a flaky product; it was a
       * non-deterministic fixture. Newest ingest wins, which is also what an operator means by
       * "the BAA I just loaded". */
      : owner
        ? await sql<{ id: string; chars: number; title: string | null }[]>`
            SELECT cs.id, length(cs.full_text)::int AS chars, o.title
            FROM curated_solicitations cs
            LEFT JOIN opportunities o ON o.id = cs.opportunity_id
            WHERE cs.full_text IS NOT NULL AND o.title LIKE ${'%' + OWNED_MARKER + owner + ']%'}
            ORDER BY cs.created_at DESC LIMIT 1`
        : await sql<{ id: string; chars: number; title: string | null }[]>`
            SELECT cs.id, length(cs.full_text)::int AS chars, o.title
            FROM curated_solicitations cs
            LEFT JOIN opportunities o ON o.id = cs.opportunity_id
            WHERE cs.full_text IS NOT NULL
              AND coalesce(o.title, '') NOT LIKE ${'%' + OWNED_MARKER + '%'}
            ORDER BY length(cs.full_text) DESC, cs.created_at DESC, cs.id DESC LIMIT 1`;

    const row = rows[0];
    expect(
      row?.chars ?? 0,
      pinned
        ? `${envVar}=${pinned} is not a shredded solicitation`
        : owner
          ? `no solicitation owned by "${owner}" — stand one up with:\n`
            + '  node scripts/drive-ingest-scenario.mjs "FLEX mid-window scenario '
            + `${OWNED_MARKER}${owner}]" baa 2026-12-15 "docs/DoD 25.2 SBIR BAA FULL_04212025.pdf"`
          : 'no shredded solicitation in the database — run:\n'
          + '  node scripts/drive-ingest-scenario.mjs "DoW 2026 SBIR BAA (R1)" baa 2026-12-15 '
          + '"docs/DoW 2026 SBIR BAA FULL_R1_04132026.pdf"',
    ).toBeGreaterThan(MIN_DRIVE_CHARS);

    console.log(
      `[drive] solicitation ${row.id} — ${row.chars.toLocaleString()} chars`
      + `${row.title ? ` — "${row.title.slice(0, 52)}"` : ''}${pinned ? ` (pinned via ${envVar})` : ''}`,
    );
    return row;
  } finally {
    await sql.end();
  }
}
