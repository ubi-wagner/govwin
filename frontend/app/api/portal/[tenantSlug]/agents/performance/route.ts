import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }, { status: 501 });
}
