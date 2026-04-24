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
 * See docs/DECISIONS.md D002 and docs/STORAGE_LAYOUT.md.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Skip the guard during the Next.js "Collecting page data" step at
// build time — Railway's build container has no runtime secrets.
// Runtime still throws if the var is missing when the request fires.
const _isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
if (!process.env.AWS_S3_BUCKET_NAME && process.env.NODE_ENV === 'production' && !_isBuildPhase) {
  throw new Error('[storage/s3-client] AWS_S3_BUCKET_NAME is required in production');
}

export const BUCKET = process.env.AWS_S3_BUCKET_NAME || 'rfp-pipeline-local';

// Singleton — construct once per process. The SDK uses env vars
// (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION,
// AWS_ENDPOINT_URL) for all configuration.
export const s3 = new S3Client({
  forcePathStyle: true,
});

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export async function putObject(input: PutObjectInput): Promise<void> {
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
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (e) {
    console.error('[s3.deleteObject] failed', { key, err: String(e) });
    throw new Error('storage delete failed');
  }
}

/**
 * Presigned GET URL for time-limited browser downloads.
 * Default TTL is 15 minutes.
 */
export async function getSignedGetUrl(key: string, expiresInSeconds = 900): Promise<string> {
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
 * Health check — verifies the bucket is reachable.
 * Used by /api/health and pipeline /healthz.
 */
export async function pingS3(): Promise<{ ok: true; bucket: string } | { ok: false; error: string }> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return { ok: true, bucket: BUCKET };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
