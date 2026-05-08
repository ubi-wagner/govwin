import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  return NextResponse.json({ error: 'Not implemented', code: 'NOT_IMPLEMENTED' }, { status: 501 });
}
