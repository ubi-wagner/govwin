# Storage Layout — V1

Canonical reference for the object storage layout. Enforced by path
helpers in `frontend/lib/storage/paths.ts` and
`pipeline/src/storage/paths.py`. Application code MUST NOT construct
S3 keys directly.

See `docs/DECISIONS.md` D002 for the rationale behind the
single-bucket-three-folder layout.

---

## Bucket

Single S3-compatible bucket on Railway:

- **Bucket name (prod):** `rfp-pipeline-prod-r8t7tr6`
- **Endpoint:** `https://t3.storageapi.dev`
- **Region:** `auto`
- **Code reads bucket via:** `process.env.AWS_S3_BUCKET_NAME` (TS) or
  `os.environ['AWS_S3_BUCKET_NAME']` (Python)

The AWS SDK (both `@aws-sdk/client-s3` v3+ and `boto3`) auto-reads
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, and
`AWS_ENDPOINT_URL` from the environment with zero configuration code.

---

## Top-Level Prefixes

### `rfp-admin/` — Curation staging area

Used by `rfp_admin` users to triage raw solicitations before promoting
them to the public opportunity pool. Objects here are NOT visible to
tenants. No tenant scoping.

```
rfp-admin/inbox/{yyyy}/{mm}/{dd}/{source}/{external_id}.{ext}
rfp-admin/discarded/{yyyy}/{mm}/{external_id}.{ext}
```

- `source`: `sam-gov`, `sbir-gov`, `grants-gov`, `manual-upload`
- `external_id`: The source's native ID (e.g., SAM notice_id)
- `ext`: Original file extension

### `rfp-pipeline/` — Published opportunity artifacts

Canonical storage for opportunities that have been promoted from the
curation inbox. Read by tenants (indirectly, via signed URLs). Write
access restricted to pipeline workers and `rfp_admin`.

```
rfp-pipeline/{opportunity_id}/source.{ext}       # Original document
rfp-pipeline/{opportunity_id}/text.md            # Normalized markdown
rfp-pipeline/{opportunity_id}/metadata.json      # Extracted fields
rfp-pipeline/{opportunity_id}/shredded/{section}.md
rfp-pipeline/{opportunity_id}/attachments/{name}
```

- `opportunity_id`: UUID from `opportunities.id`
- `section`: Lowercased section slug (`requirements`, `evaluation`, etc.)

### `customers/` — Per-tenant isolated storage

Strict tenant isolation: every key under `customers/{slug}/` belongs
exclusively to that tenant. Code MUST validate tenant ownership before
generating any customer path. Tenant-leakage prevention is the single
most important invariant of the storage layer.

```
customers/{tenant_slug}/uploads/{yyyy}/{mm}/{uuid}.{ext}
customers/{tenant_slug}/proposals/{proposal_id}/sections/{section_slug}.md
customers/{tenant_slug}/proposals/{proposal_id}/attachments/{uuid}.{ext}
customers/{tenant_slug}/proposals/{proposal_id}/exports/{version}.{ext}
customers/{tenant_slug}/library/units/{unit_id}.md
customers/{tenant_slug}/library/assets/{uuid}.{ext}
```

- `tenant_slug`: The `tenants.slug` column (URL-safe, unique)
- `proposal_id`: UUID from `proposals.id`
- `unit_id`: UUID from `library_units.id`

---

## Path Helper Contracts

### TypeScript (`frontend/lib/storage/paths.ts`)

```ts
export function rfpAdminInboxPath(p: {
  source: 'sam-gov' | 'sbir-gov' | 'grants-gov' | 'manual-upload';
  externalId: string;
  ext: string;
  at?: Date;
}): string;

export function rfpPipelinePath(p: {
  opportunityId: string;
  kind: 'source' | 'text' | 'metadata' | 'shredded' | 'attachment';
  name?: string;
  ext?: string;
}): string;

export function customerPath(p: {
  tenantSlug: string;
  kind: 'upload' | 'proposal-section' | 'proposal-attachment'
      | 'proposal-export' | 'library-unit' | 'library-asset';
  proposalId?: string;
  sectionSlug?: string;
  unitId?: string;
  name?: string;
  ext?: string;
}): string;
```

### Python (`pipeline/src/storage/paths.py`)

Mirror of the TS helpers using keyword arguments. Same output strings.

---

## Invariants (enforced by helpers)

1. **Tenant slug sanitization:** `customerPath` rejects slugs
   containing `/`, `..`, whitespace, or uppercase characters. The slug
   must match `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`.
2. **No raw concatenation:** Application code imports the helpers; it
   never imports `BUCKET` and builds its own keys.
3. **Deterministic outputs:** Given the same inputs, the helpers return
   the same string on every call. No timestamps embedded in keys except
   where explicitly part of the layout (e.g., `inbox/{yyyy}/{mm}/{dd}`).
4. **Hot path cache:** Slug sanitization uses a memoized check to
   avoid regex compile on every call.

---

## Access Patterns

| Operation | Frontend | Pipeline |
|---|---|---|
| Read opportunity source doc | Signed URL (rfp-pipeline/) | Direct (rfp-pipeline/) |
| Upload raw customer file | Direct (customers/{slug}/uploads/) | — |
| Read proposal section | Direct (customers/{slug}/...) | Direct (customers/{slug}/...) |
| Write shredded RFP output | — | Direct (rfp-pipeline/{id}/shredded/) |
| Admin move inbox → published | Direct (copy + delete, admin only) | — |

"Signed URL" means the frontend generates a presigned GET URL using
the S3 client and returns it to the browser so the browser fetches
from the bucket directly, bypassing the Next.js server.
