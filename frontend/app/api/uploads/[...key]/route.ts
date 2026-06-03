/**
 * GET /api/uploads/cms/<file> — public, permanent serving of CMS-uploaded images.
 *
 * Streams the object from storage so the URL is stable (no expiring presigned
 * links). Scoped to the `cms/` prefix so it can never be used to read other
 * areas of the bucket; path traversal is rejected.
 */
import { NextResponse } from 'next/server';
import { getObjectBuffer } from '@/lib/storage/s3-client';

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const objectKey = (key ?? []).join('/');
  // Only the public CMS prefix; never allow traversal out of it.
  if (!objectKey.startsWith('cms/') || objectKey.includes('..')) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  try {
    const buf = await getObjectBuffer(objectKey);
    if (!buf) {
      return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const ext = objectKey.split('.').pop()?.toLowerCase() ?? '';
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (e) {
    console.error('[api/uploads GET] error:', e);
    return NextResponse.json({ error: 'Failed to read image', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}
