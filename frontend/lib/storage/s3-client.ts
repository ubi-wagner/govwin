/**
 * Shared S3 client for the frontend (Next.js server routes + server
 * components). The AWS SDK auto-reads AWS_ACCESS_KEY_ID,
 * AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION, and AWS_ENDPOINT_URL from
 * the environment — no explicit configuration code is needed here.
 *
 * Application code should go through the higher-level helpers in
 * this module (putObject, getObject, getSignedGetUrl) rather than
 * constructing command objects directly, so tenant-isolation and
 * error-logging conventions stay in one place.
 *
 * LOCAL DRIVER (dev/sandbox): with STORAGE_DRIVER=local, these SAME helpers are
 * backed by the local filesystem instead of a reachable S3/R2 bucket — so the
 * image pipeline (capture, box-atomize, uploads, export) runs end-to-end where
 * Railway's R2 service isn't linked. Keys are stored verbatim (S3 naming) under
 * LOCAL_STORAGE_DIR/<bucket>/; signed URLs resolve to the gated
 * /api/storage/local/<key> route. Production (no flag) is byte-for-byte unchanged.
 *
 * See docs/DECISIONS.md D002 and docs/STORAGE_LAYOUT.md.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';

// ── Local driver flag + primitives ──────────────────────────────────────────
export const LOCAL = process.env.STORAGE_DRIVER === 'local';
const LOCAL_DIR = process.env.LOCAL_STORAGE_DIR || '/tmp/govwin-storage';
const LOCAL_URL_BASE = '/api/storage/local';

// Railway's R2/bucket service injects the bucket name as AWS_S3_BUCKET; older config used
// AWS_S3_BUCKET_NAME. Read AWS_S3_BUCKET first, fall back to the legacy name — otherwise the
// code looks for a var Railway never sets and throws below (the recurring prod storage error).
const _bucketEnv = process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME;

// Skip the guard during the Next.js "Collecting page data" step at
// build time — Railway's build container has no runtime secrets.
// Runtime still throws if the var is missing when the request fires (unless local).
const _isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
if (!_bucketEnv && process.env.NODE_ENV === 'production' && !_isBuildPhase && !LOCAL) {
  throw new Error('[storage/s3-client] AWS_S3_BUCKET (or AWS_S3_BUCKET_NAME) is required in production');
}

export const BUCKET = _bucketEnv || 'rfp-pipeline-local';

const _localPath = (key: string) => join(LOCAL_DIR, BUCKET, key);
async function _localWrite(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<void> {
  const p = _localPath(key);
  await fs.mkdir(dirname(p), { recursive: true });
  const buf = Buffer.isBuffer(body) ? body : typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
  await fs.writeFile(p, buf);
  await fs.writeFile(`${p}.contenttype`, contentType || 'application/octet-stream');
}
async function _localRead(key: string): Promise<Buffer | null> {
  try { return await fs.readFile(_localPath(key)); } catch { return null; }
}
/** Content-type sidecar for a locally-stored key (used by the serving route). */
export async function localContentType(key: string): Promise<string> {
  try { return (await fs.readFile(`${_localPath(key)}.contenttype`, 'utf8')).trim() || 'application/octet-stream'; }
  catch { return 'application/octet-stream'; }
}
/** Read/write helpers the local serving route uses (never touched in prod). */
export async function localReadObject(key: string): Promise<Buffer | null> { return _localRead(key); }
export async function localWriteObject(key: string, body: Buffer, contentType?: string): Promise<void> { return _localWrite(key, body, contentType); }

// Singleton — construct once per process. The SDK v3 reads credentials
// from AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY and endpoint from
// AWS_ENDPOINT_URL automatically. HOWEVER: it reads region from
// AWS_REGION, not AWS_DEFAULT_REGION (which is what Railway + boto3
// use). We bridge that here. (Unused when LOCAL — construction is lazy/harmless.)
export const s3 = new S3Client({
  forcePathStyle: true,
  region: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'auto',
});

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export async function putObject(input: PutObjectInput): Promise<void> {
  if (LOCAL) return _localWrite(input.key, input.body, input.contentType);
  const params: PutObjectCommandInput = {
    Bucket: BUCKET,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    CacheControl: input.cacheControl,
    Metadata: input.metadata,
  };
  try {
    await s3.send(new PutObjectCommand(params));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const code = (e as { Code?: string; name?: string })?.Code ?? (e as { name?: string })?.name ?? 'unknown';
    console.error('[s3.putObject] failed', { key: input.key, bucket: BUCKET, code, err: detail });
    throw new Error(`S3 put failed (${code}): ${detail}`);
  }
}

export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  if (LOCAL) return _localRead(key);
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!res.Body) return null;
    const chunks: Buffer[] = [];
    // @ts-expect-error Node stream — SDK's Body is a Readable in Node runtime
    for await (const chunk of res.Body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    console.error('[s3.getObjectBuffer] failed', { key, err: String(e) });
    throw new Error('storage get failed');
  }
}

export async function objectExists(key: string): Promise<boolean> {
  if (LOCAL) { try { await fs.access(_localPath(key)); return true; } catch { return false; } }
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'NotFound' || name === 'NoSuchKey') return false;
    console.error('[s3.objectExists] failed', { key, err: String(e) });
    throw new Error('storage head failed');
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (LOCAL) { try { await fs.unlink(_localPath(key)); await fs.unlink(`${_localPath(key)}.contenttype`); } catch { /* absent is fine */ } return; }
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (e) {
    console.error('[s3.deleteObject] failed', { key, err: String(e) });
    throw new Error('storage delete failed');
  }
}

/**
 * Copy an object within the same bucket.
 * Used during proposal provisioning to copy RFP documents into the customer sandbox.
 */
export async function copyObject({ sourceKey, destKey }: { sourceKey: string; destKey: string }): Promise<void> {
  if (LOCAL) {
    const b = await _localRead(sourceKey);
    if (b == null) throw new Error(`S3 copy failed (local): source missing ${sourceKey}`);
    await _localWrite(destKey, b, await localContentType(sourceKey));
    return;
  }
  try {
    const command = new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${sourceKey}`,
      Key: destKey,
    });
    await s3.send(command);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const code = (e as { Code?: string; name?: string })?.Code ?? (e as { name?: string })?.name ?? 'unknown';
    console.error('[s3.copyObject] failed', { sourceKey, destKey, bucket: BUCKET, code, err: detail });
    throw new Error(`S3 copy failed (${code}): ${detail}`);
  }
}

/**
 * Presigned GET URL for time-limited browser downloads.
 * Default TTL is 15 minutes. (LOCAL: a stable gated route URL — the local analog of a bearer link.)
 */
export async function getSignedGetUrl(key: string, expiresInSeconds = 900): Promise<string> {
  if (LOCAL) return `${LOCAL_URL_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
  try {
    return await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  } catch (e) {
    console.error('[s3.getSignedGetUrl] failed', { key, err: String(e) });
    throw new Error('storage sign failed');
  }
}

/**
 * Presigned PUT URL for direct browser-to-S3 uploads.
 * Bypasses Next.js body limits — critical for large files (300MB+).
 * Default TTL is 15 minutes. (LOCAL: the gated route accepts the PUT to the filesystem.)
 */
export async function getSignedPutUrl(
  key: string,
  contentType?: string,
  expiresInSeconds = 900,
): Promise<string> {
  if (LOCAL) return `${LOCAL_URL_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
  try {
    return await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: contentType || 'application/octet-stream',
      }),
      { expiresIn: expiresInSeconds },
    );
  } catch (e) {
    console.error('[s3.getSignedPutUrl] failed', { key, err: String(e) });
    throw new Error('storage presign-put failed');
  }
}

/**
 * Health check — verifies the bucket is reachable.
 * Used by /api/health and pipeline /healthz.
 */
export async function pingS3(): Promise<{ ok: true; bucket: string } | { ok: false; error: string }> {
  if (LOCAL) return { ok: true, bucket: `${BUCKET} (local fs)` };
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return { ok: true, bucket: BUCKET };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * List objects and common prefixes under a given S3 prefix.
 * Used by the admin file manager to browse the bucket.
 */
export async function listObjects(prefix: string, delimiter = '/'): Promise<{
  objects: Array<{ key: string; size: number; lastModified: Date | null }>;
  prefixes: string[];
}> {
  if (LOCAL) {
    // Walk LOCAL_DIR/<bucket>/<prefix>; one level deep per the delimiter convention.
    const base = join(LOCAL_DIR, BUCKET);
    const dir = join(base, prefix);
    const objects: Array<{ key: string; size: number; lastModified: Date | null }> = [];
    const prefixes: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.endsWith('.contenttype')) continue;
        const rel = `${prefix}${prefix && !prefix.endsWith('/') ? '/' : ''}${e.name}`;
        if (e.isDirectory()) { if (delimiter) prefixes.push(`${rel}/`); }
        else { const st = await fs.stat(join(dir, e.name)); objects.push({ key: rel, size: st.size, lastModified: st.mtime }); }
      }
    } catch { /* missing prefix → empty */ }
    return { objects, prefixes };
  }
  if (!s3 || !BUCKET) return { objects: [], prefixes: [] };
  const cmd = new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
    Delimiter: delimiter,
  });
  let res;
  try {
    res = await s3.send(cmd);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[s3.listObjects] failed', { prefix, bucket: BUCKET, err: detail });
    throw new Error(`S3 list failed: ${detail}`);
  }
  const objects = (res.Contents ?? [])
    .filter(o => o.Key && o.Key !== prefix)
    .map(o => ({
      key: o.Key!,
      size: o.Size ?? 0,
      lastModified: o.LastModified ?? null,
    }));
  const prefixes = (res.CommonPrefixes ?? [])
    .map(p => p.Prefix!)
    .filter(Boolean);
  return { objects, prefixes };
}
