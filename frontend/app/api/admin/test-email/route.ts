import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sendEmail } from '@/lib/email';

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin') {
      return NextResponse.json({ error: 'master_admin only', code: 'FORBIDDEN' }, { status: 403 });
    }

    const adminEmail = (session.user as { email?: string }).email;
    if (!adminEmail) {
      return NextResponse.json({ error: 'No email in session', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const hasClientId = !!process.env.GOOGLE_CLIENT_ID;
    const hasClientSecret = !!process.env.GOOGLE_CLIENT_SECRET;
    const hasRefreshToken = !!process.env.GOOGLE_REFRESH_TOKEN;
    const workspaceEmail = process.env.GOOGLE_WORKSPACE_EMAIL || 'platform@rfppipeline.com';

    const envCheck = {
      GOOGLE_CLIENT_ID: hasClientId ? 'set' : 'MISSING',
      GOOGLE_CLIENT_SECRET: hasClientSecret ? 'set' : 'MISSING',
      GOOGLE_REFRESH_TOKEN: hasRefreshToken ? 'set' : 'MISSING',
      GOOGLE_WORKSPACE_EMAIL: workspaceEmail,
      RESEND_API_KEY: process.env.RESEND_API_KEY ? 'set' : 'not set',
    };

    const result = await sendEmail({
      to: adminEmail,
      subject: 'RFP Pipeline — Email Test',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #1e293b;">Email Test Successful</h2>
          <p>This email was sent from <strong>${workspaceEmail}</strong> via the RFP Pipeline platform.</p>
          <p style="color: #64748b; font-size: 14px;">If you're reading this, the Google Workspace email integration is working.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <pre style="font-size: 12px; color: #475569;">${JSON.stringify(envCheck, null, 2)}</pre>
        </div>
      `,
    });

    return NextResponse.json({
      data: {
        envCheck,
        sendResult: result,
        sentTo: adminEmail,
        sentFrom: workspaceEmail,
      },
    });
  } catch (err) {
    console.error('[api/admin/test-email] POST error:', err);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
