/**
 * GET /api/admin/storage-test
 *
 * Diagnostic endpoint that tests S3 connectivity by writing a tiny
 * test file, reading it back, then deleting it. Returns the exact
 * error at whichever step fails. Admin-only.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const results: Record<string, string> = {};

  // Step 1: Check env vars
  const vars = {
    AWS_S3_BUCKET_NAME: process.env.AWS_S3_BUCKET_NAME ?? '(NOT SET)',
    AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL ?? '(NOT SET)',
    AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? '(NOT SET)',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ? '***set***' : '(NOT SET)',
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ? '***set***' : '(NOT SET)',
  };
  results['env_vars'] = JSON.stringify(vars);

  if (!process.env.AWS_S3_BUCKET_NAME || !process.env.AWS_ENDPOINT_URL) {
    return NextResponse.json({
      data: {
        status: 'FAIL',
        step: 'env_check',
        message: 'Missing required AWS env vars',
        vars,
      },
    });
  }

  // Step 2: Try to write a test object
  const testKey = `_diagnostic/test-${Date.now()}.txt`;
  const testBody = `Storage test at ${new Date().toISOString()}`;

  try {
    const { putObject } = await import('@/lib/storage/s3-client');
    await putObject({ key: testKey, body: testBody, contentType: 'text/plain' });
    results['put'] = 'OK';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : 'unknown';
    return NextResponse.json({
      data: {
        status: 'FAIL',
        step: 'put_object',
        message: msg,
        errorName: name,
        key: testKey,
        vars,
      },
    });
  }

  // Step 3: Try to read it back
  try {
    const { getObjectBuffer } = await import('@/lib/storage/s3-client');
    const buf = await getObjectBuffer(testKey);
    results['get'] = buf ? `OK (${buf.length} bytes)` : 'FAIL (null returned)';
  } catch (err) {
    results['get'] = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Step 4: Clean up
  try {
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ forcePathStyle: true });
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: testKey,
    }));
    results['delete'] = 'OK';
  } catch (err) {
    results['delete'] = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
  }

  return NextResponse.json({
    data: {
      status: 'OK',
      step: 'all_passed',
      results,
      vars,
    },
  });
}
