/**
 * GET/PUT /api/storage/local/<key>  — the local-storage-driver serving route.
 *
 * Only active when STORAGE_DRIVER=local (dev/sandbox). It's the local analog of an
 * R2/S3 presigned URL: getSignedGetUrl(key) → this GET; getSignedPutUrl(key) → this PUT.
 * In production the LOCAL flag is off and every method 404s, so this exposes nothing.
 * (A signed URL is itself an unauthenticated bearer link; gating on LOCAL is the guard.)
 */
import { NextResponse } from 'next/server';
import { LOCAL, localReadObject, localWriteObject, localContentType } from '@/lib/storage/s3-client';

export const dynamic = 'force-dynamic';

const gone = () => NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
const keyOf = (parts: string[] | undefined) => (parts ?? []).map((p) => decodeURIComponent(p)).join('/');

export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (!LOCAL) return gone();
  const { key } = await params;
  const k = keyOf(key);
  if (!k || k.includes('..')) return gone();
  const buf = await localReadObject(k);
  if (!buf) return gone();
  const contentType = await localContentType(k);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=300' },
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (!LOCAL) return gone();
  const { key } = await params;
  const k = keyOf(key);
  if (!k || k.includes('..')) return gone();
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    await localWriteObject(k, buf, req.headers.get('content-type') || 'application/octet-stream');
    return new NextResponse(null, { status: 200 });
  } catch (e) {
    console.error('[storage/local] PUT failed', { key: k, err: String(e) });
    return NextResponse.json({ error: 'Write failed', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}
