import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { auth } from '@/auth';
import { putObject, getSignedGetUrl } from '@/lib/storage/s3-client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    // Validate image type
    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: 'File must be an image (PNG, JPEG, GIF, WebP, SVG)', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    // 10MB limit for images
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 10MB', code: 'VALIDATION_ERROR' }, { status: 413 });
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
    const storageKey = `reference/images/${randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    await putObject({
      key: storageKey,
      body: buffer,
      contentType: file.type,
    });

    // Get a presigned URL for display
    const url = await getSignedGetUrl(storageKey, 3600); // 1 hour

    return NextResponse.json({
      data: { storageKey, url, size: file.size, contentType: file.type, originalName: file.name }
    });
  } catch (err) {
    console.error('[admin/documents/upload-image] failed', err);
    return NextResponse.json({ error: 'Image upload failed', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}
