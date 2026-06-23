/**
 * POST /api/admin/site/upload-image — upload a CMS image, return a stable public URL.
 *
 * Admin-only. Stores under the public `cms/` prefix and returns the permanent
 * serving URL (/api/uploads/cms/<id>.<ext>) — not an expiring presigned link —
 * so it can be saved into page/document content and stay valid.
 */
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAdmin } from '@/lib/admin-auth';
import { putObject } from '@/lib/storage/s3-client';

export const dynamic = 'force-dynamic';

const EXT_FOR_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export async function POST(request: Request) {
  try {
    const a = await requireAdmin();
    if (!a.ok) return a.res;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Expected multipart form data', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    const ext = EXT_FOR_TYPE[file.type];
    if (!ext) {
      return NextResponse.json({ error: 'File must be an image (PNG, JPEG, GIF, WebP, SVG)', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 10MB', code: 'VALIDATION_ERROR' }, { status: 413 });
    }

    const key = `cms/${randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject({ key, body: buffer, contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' });
    return NextResponse.json({ data: { url: `/api/uploads/${key}`, key, size: file.size } });
  } catch (e) {
    console.error('[admin/site/upload-image POST] error:', e);
    return NextResponse.json({ error: 'Image upload failed', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}
