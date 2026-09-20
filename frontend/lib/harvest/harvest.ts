/**
 * HARVEST THE DOCUMENTS BEHIND A SCOUT FINDING.
 *
 * Fetch the page, find the links that are documents, fetch each one, store the bytes, and record
 * a row per document — filename, size and sha256 — so that cross-source matching has something to
 * match ON. Until this existed, `lib/scout/classify.ts` compared titles and solicitation numbers
 * and nothing else, because nothing else was ever collected.
 *
 * ── THE SHAPE OF THE RESULT ────────────────────────────────────────────────────────────────────
 * Every attempt produces a ROW, including the ones that failed. A 403 from an agency portal and a
 * document nobody ever tried to fetch are opposite operational facts, and if only successes are
 * written they look identical. `http_status` and `error` are that distinction.
 *
 * ── WHAT IT REFUSES ────────────────────────────────────────────────────────────────────────────
 * Bounds are the contract, not a precaution: the URLs come off a page nobody here wrote. A cap on
 * documents per page, a cap on bytes per document and on the page itself, and — the one that
 * matters most on a re-run — an UPSERT rather than an insert, so harvesting the same finding twice
 * converges instead of accumulating.
 *
 * ⚠️ THE CONFLICT TARGET IS `(finding_id, document_url)`, NOT the hash. Keying on the hash left
 * FAILED rows outside a partial index — they have no hash — so re-harvesting a dead link inserted
 * a second row for it and three rows became four. The drive caught that on its first run. The URL
 * is the honest identity: always present, and re-fetching it is the same fact observed again.
 */
import { createHash } from 'node:crypto';
import { sqlBypass } from '@/lib/db';
import { putObject } from '@/lib/storage/s3-client';
import { extractDocumentLinks, documentFilename } from './extract-links';
import { harvestFetch, harvestDriver, type HarvestDriver } from './fetch';

export interface HarvestLimits {
  /** How many documents to take from one page. */
  maxDocuments?: number;
  maxBytesPerDocument?: number;
  maxPageBytes?: number;
}

export interface HarvestedDoc {
  documentUrl: string;
  filename: string;
  contentType: string | null;
  size: number | null;
  hash: string | null;
  storageKey: string | null;
  httpStatus: number | null;
  error: string | null;
}

export interface HarvestResult {
  ok: boolean;
  findingId: string;
  pageUrl: string;
  driver: HarvestDriver;
  /** Links the extractor considered worth fetching, before the cap. */
  linksFound: number;
  documents: HarvestedDoc[];
  /** Set when the PAGE itself could not be read — then `documents` is empty and that is why. */
  error?: string;
  code?: string;
}

const DEFAULTS: Required<HarvestLimits> = {
  maxDocuments: 25,
  maxBytesPerDocument: 40 * 1024 * 1024,
  maxPageBytes: 8 * 1024 * 1024,
};

/**
 * Where harvested bytes live.
 *
 * Deliberately NOT `rfpPipelinePath` — that keys on an `opportunityId`, and a finding has no
 * opportunity yet; inventing one to satisfy a path helper would put a harvested candidate in the
 * same namespace as a curated solicitation's source documents. Keyed on the finding and the
 * content hash instead, which also makes the object idempotent: the same bytes harvested twice
 * write the same key.
 */
function harvestStorageKey(findingId: string, hash: string, filename: string): string {
  const ext = (filename.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? 'bin').toLowerCase();
  return `scout-harvest/${findingId}/${hash.slice(0, 32)}.${ext}`;
}

/**
 * Harvest one finding.
 *
 * `sqlBypass` and not `sql`: `scout_findings` is PLATFORM scope (no `tenant_id`), and a
 * tenant-context write of a platform row updates zero rows under `govtech_app` because the
 * isolation policy is tenant-EQUALITY and NULL equals nothing. That is the documented way to lose
 * a write silently in this codebase.
 */
export async function harvestFinding(
  findingId: string,
  limits: HarvestLimits = {},
): Promise<HarvestResult> {
  const lim = { ...DEFAULTS, ...limits };
  const driver = harvestDriver();

  let pageUrl = '';
  try {
    const [row] = await sqlBypass<Array<{ url: string | null }>>`
      SELECT url FROM scout_findings WHERE id = ${findingId}::uuid LIMIT 1`;
    if (!row) {
      return { ok: false, findingId, pageUrl: '', driver, linksFound: 0, documents: [],
        error: 'No such finding', code: 'NOT_FOUND' };
    }
    if (!row.url) {
      return { ok: false, findingId, pageUrl: '', driver, linksFound: 0, documents: [],
        error: 'That finding carries no URL, so there is no page to harvest', code: 'NO_URL' };
    }
    pageUrl = row.url;
  } catch (err) {
    console.error('[harvest] could not read the finding:', err);
    return { ok: false, findingId, pageUrl: '', driver, linksFound: 0, documents: [],
      error: 'Could not read the finding', code: 'DB_ERROR' };
  }

  const page = await harvestFetch(pageUrl, { maxBytes: lim.maxPageBytes });
  if (!page.ok) {
    return {
      ok: false, findingId, pageUrl, driver, linksFound: 0, documents: [],
      error: `Could not read the page: ${page.error ?? `http ${page.status}`}`,
      code: 'PAGE_UNREADABLE',
    };
  }

  const links = extractDocumentLinks(page.body.toString('utf8'), pageUrl);
  const take = links.slice(0, lim.maxDocuments);

  const documents: HarvestedDoc[] = [];
  for (const link of take) {
    const got = await harvestFetch(link.url, { maxBytes: lim.maxBytesPerDocument });
    const filename = documentFilename({
      contentDisposition: got.contentDisposition,
      url: link.url,
      linkText: link.text,
    });

    if (!got.ok) {
      documents.push({
        documentUrl: link.url, filename, contentType: got.contentType,
        size: null, hash: null, storageKey: null,
        httpStatus: got.status || null, error: got.error ?? 'fetch failed',
      });
      continue;
    }

    const hash = createHash('sha256').update(got.body).digest('hex');
    const storageKey = harvestStorageKey(findingId, hash, filename);
    let stored: string | null = storageKey;
    try {
      await putObject({
        key: storageKey,
        body: got.body,
        contentType: got.contentType ?? 'application/octet-stream',
      });
    } catch (err) {
      // The bytes are still a fact — their NAME, SIZE and HASH are what matching needs, and all
      // three survive a storage failure. So the row is written with `storage_key = NULL` and the
      // reason recorded, rather than the whole document being dropped for want of a bucket.
      console.error('[harvest] storage write failed:', err);
      stored = null;
    }

    documents.push({
      documentUrl: link.url, filename, contentType: got.contentType,
      size: got.body.byteLength, hash, storageKey: stored,
      httpStatus: got.status || null,
      error: stored === null ? 'stored nowhere — object write failed; name, size and hash are still recorded' : null,
    });
  }

  try {
    for (const d of documents) {
      await sqlBypass`
        INSERT INTO scout_finding_documents
          (finding_id, page_url, document_url, original_filename, content_type,
           file_size, content_hash, storage_key, harvest_driver, http_status, error)
        VALUES
          (${findingId}::uuid, ${pageUrl}, ${d.documentUrl}, ${d.filename}, ${d.contentType},
           ${d.size}, ${d.hash}, ${d.storageKey}, ${driver}, ${d.httpStatus}, ${d.error})
        ON CONFLICT (finding_id, document_url) DO UPDATE SET
          original_filename = EXCLUDED.original_filename,
          content_type      = EXCLUDED.content_type,
          file_size         = EXCLUDED.file_size,
          content_hash      = EXCLUDED.content_hash,
          storage_key       = EXCLUDED.storage_key,
          harvest_driver    = EXCLUDED.harvest_driver,
          http_status       = EXCLUDED.http_status,
          error             = EXCLUDED.error,
          harvested_at      = now()`;
    }
  } catch (err) {
    console.error('[harvest] could not record the documents:', err);
    return {
      ok: false, findingId, pageUrl, driver, linksFound: links.length, documents,
      error: 'Harvested, but could not record the documents', code: 'DB_ERROR',
    };
  }

  return { ok: true, findingId, pageUrl, driver, linksFound: links.length, documents };
}
