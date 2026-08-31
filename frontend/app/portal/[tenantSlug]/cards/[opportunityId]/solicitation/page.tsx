import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { withTenant } from '@/lib/rls';
import { coerceJsonb } from '@/lib/jsonb';
import { isValidUUID } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * The reading view — where "View Solicitation" actually goes.
 *
 * ── WHY THIS PAGE HAD TO EXIST BEFORE THE BUTTON COULD ───────────────────────────────────────
 * `copyCorpusInward` has been writing `tenant_opportunity_documents` since migration 238, with the
 * text, the page counts, the content hashes and the per-document storage keys. Nothing in the
 * entire tree READ that table. A customer could pull a 330-page solicitation into their own space
 * and had no way to open it — the same "carried but invisible" shape as `complianceSummary` and
 * `expertNotes`, one layer deeper.
 *
 * So a "View Solicitation" control that only ran the copy would have been a button that fetches
 * something you cannot look at. The copy is plumbing underneath a destination; this is the
 * destination.
 *
 * ── WHAT IT SHOWS, IN THE ORDER A PERSON NEEDS IT ────────────────────────────────────────────
 * The analyst's reading first, the raw document second. A curator marked eight passages in a 330-page
 * BAA precisely so nobody else has to read 330 pages, and burying that under the source text would
 * throw away the work that makes the product worth anything. `expertNotes` leads — it is the note
 * the RFP admin wrote FOR this customer, has had an editor since curation shipped, rides the bridge
 * on every card, and until now was rendered nowhere.
 *
 * ── AND IT DOES NOT REQUIRE THE COPY ─────────────────────────────────────────────────────────
 * The curated record — note, highlights, volumes, page limits — lives on the card and reaches every
 * tenant at fan-out, copy or no copy. So this page is useful the moment someone lands on it, and
 * degrades to "documents not copied yet" rather than to a blank screen. That is what keeps the
 * un-copied tier informative instead of a paywall.
 */
export default async function SolicitationReadingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; opportunityId: string }>;
}) {
  const { tenantSlug, opportunityId } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');
  if (!isValidUUID(opportunityId)) redirect(`/portal/${tenantSlug}/cards`);
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(su.id, role, tenantId))) redirect('/portal');
  // Reading is a tenant_user capability — everyone who can see the feed can read what it points at.
  if (!hasRoleAtLeast(role, 'tenant_user')) redirect(`/portal/${tenantSlug}`);

  interface CardRow { card: unknown; pursuitStatus: string | null; docsCopied: boolean; docsUpdateAvailable: boolean }
  interface DocRow {
    id: string; originalFilename: string | null; documentLabel: string | null; documentType: string | null;
    isPrimary: boolean; pageCount: number | null; charCount: number | null; extractedText: string | null;
  }

  let card: Record<string, unknown> = {};
  let meta: CardRow | null = null;
  let docs: DocRow[] = [];
  try {
    const read = await withTenant(tenantId, async (tx) => {
      const [c] = (await tx`
        SELECT card, pursuit_status, docs_copied, docs_update_available
        FROM tenant_opportunity_cards
        WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid`) as unknown as CardRow[];
      // Ordered the way the organization published them: the primary source first, then the rest by
      // creation — the same order the card's manifest uses, so the two lists never disagree.
      const d = (await tx`
        SELECT id, original_filename, document_label, document_type, is_primary,
               page_count, char_count, extracted_text
        FROM tenant_opportunity_documents
        WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
        ORDER BY is_primary DESC, (document_type = 'source') DESC, created_at`) as unknown as DocRow[];
      return { c, d };
    });
    meta = read.c ?? null;
    docs = read.d ?? [];
    card = coerceJsonb<Record<string, unknown>>(meta?.card ?? {}, {});
  } catch (e) {
    console.error('[portal/solicitation] read failed', e);
  }

  // A card this tenant does not hold is a 404 in the only sense that matters: the mirror is complete,
  // so an unknown id means the opportunity is not theirs, not that it does not exist.
  if (!meta) redirect(`/portal/${tenantSlug}/cards`);

  const str = (k: string): string | null => {
    const v = card[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };
  const highlights = (Array.isArray(card.highlights) ? (card.highlights as Array<Record<string, unknown>>) : [])
    .filter((h) => typeof h.text === 'string' && (h.text as string).trim() !== '');
  const manifest = Array.isArray(card.documents) ? (card.documents as Array<Record<string, unknown>>) : [];
  const title = str('title') ?? 'Untitled opportunity';
  const note = str('expertNotes');
  const summary = str('spotlightSummary');

  return (
    <div className="max-w-4xl">
      <Link href={`/portal/${tenantSlug}/cards`} className="text-xs text-gray-500 hover:text-gray-800">← Opportunity Pipeline</Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {str('agency') ?? '—'}
        {str('solicitationNumber') ? ` · ${str('solicitationNumber')}` : ''}
        {str('topicNumber') ? ` · ${str('topicNumber')}` : ''}
      </p>

      {meta.docsUpdateAvailable && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          The organization has published changes since your copy was made. Resync from the pipeline to pull them in.
        </p>
      )}

      {/*
        THE ANALYST'S READING, FIRST.

        `expertNotes` is the note an RFP admin wrote for this customer. It has had an editor since
        curation shipped and rode the bridge onto every card, and no customer-facing surface has ever
        rendered it — the note was written, carried, and never delivered.
      */}
      {(note || summary) && (
        <section className="mt-5 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-blue-800">From our RFP team</h2>
          {note && <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-gray-800">{note}</p>}
          {summary && <p className={`text-[12px] leading-relaxed text-gray-600 ${note ? 'mt-2' : 'mt-1.5'}`}>{summary}</p>}
        </section>
      )}

      {highlights.length > 0 && (
        <section className="mt-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            What our analysts marked · {highlights.length} passage{highlights.length === 1 ? '' : 's'}
          </h2>
          <ul className="mt-2 space-y-2.5">
            {highlights.map((h, i) => (
              <li key={i} className="border-l-2 border-blue-300 pl-3">
                <p className="text-[13px] leading-relaxed text-gray-800">“{String(h.text)}”</p>
                <p className="mt-0.5 text-[10px] text-gray-400">
                  {typeof h.page === 'number' ? `page ${h.page}` : 'in the solicitation'}
                  {typeof h.variable === 'string' && h.variable ? ` · ${h.variable.replace(/_/g, ' ')}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">The solicitation</h2>
        {docs.length === 0 ? (
          /*
            Not copied, or copied and empty — and those are DIFFERENT, so say which. The manifest
            rides the card, so we always know what the organization published even when we hold none
            of it; reporting "no documents" when the organization published four would be a lie about
            them rather than about us.
          */
          <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-4 text-[13px] text-gray-600">
            {manifest.length > 0 ? (
              <>
                <p>
                  The organization published {manifest.length} document{manifest.length === 1 ? '' : 's'}, and none of
                  {' '}them are in your library yet.
                </p>
                <ul className="mt-2 space-y-0.5 text-[12px] text-gray-500">
                  {manifest.map((m, i) => (
                    <li key={i}>
                      {String(m.filename ?? 'document')}
                      {typeof m.pageCount === 'number' ? ` · ${m.pageCount} pages` : ''}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[12px] text-gray-500">
                  Use <span className="font-medium">View Solicitation</span> on the card to copy them here.
                </p>
              </>
            ) : (
              <p>The organization has not published any documents for this opportunity yet.</p>
            )}
          </div>
        ) : (
          <div className="mt-2 space-y-4">
            {docs.map((d) => (
              <details key={d.id} open={d.isPrimary} className="rounded-lg border border-gray-200 bg-white">
                <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium text-gray-800">
                  {d.documentLabel || d.originalFilename || 'Document'}
                  <span className="ml-2 font-normal text-[11px] text-gray-400">
                    {d.isPrimary ? 'primary · ' : ''}
                    {typeof d.pageCount === 'number' ? `${d.pageCount} pages · ` : ''}
                    {(d.charCount ?? d.extractedText?.length ?? 0).toLocaleString()} characters
                  </span>
                </summary>
                {/*
                  The extracted text, as extracted. Rendered in a scrolling pre so a 300-page
                  document cannot make the page itself scroll sideways, and so whitespace the
                  shredder preserved (tables, indented clause numbering) still reads as it did.
                */}
                {d.extractedText && d.extractedText.trim() !== '' ? (
                  <pre className="mx-4 mb-4 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 font-mono text-[11.5px] leading-relaxed text-gray-700">
                    {d.extractedText}
                  </pre>
                ) : (
                  /* A row with no text is a document we hold a POINTER to and no readable content —
                     usually one the shredder has not finished. Absent is not empty. */
                  <p className="mx-4 mb-4 text-[12px] text-gray-500">
                    This document is in your library but has no extracted text yet.
                  </p>
                )}
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
