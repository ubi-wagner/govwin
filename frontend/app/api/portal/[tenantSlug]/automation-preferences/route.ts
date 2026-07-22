/**
 * RETIRED (#190 sweep A1) — 410 Gone.
 *
 * This endpoint wrote the tenant's automation choices into `tenant_automation_preferences`.
 * Since #190 the tenant edits its choices in the grammar editor, which writes
 * `tenant_automation_policies`, and the CMS notifier now reads THAT table as the single source
 * of truth (see `services/cms/src/event_listener.py:_automation_pref_allows`). Keeping this
 * route live would let it write a third, divergent copy of the tenant's preferences — the exact
 * split-brain the sweep found — so it is retired. Use
 * `/api/portal/[tenantSlug]/automation-policies` instead.
 */
import { NextResponse } from 'next/server';

const gone = () =>
  NextResponse.json(
    {
      error: 'Automation preferences moved to the automation-policies grammar editor.',
      code: 'GONE',
      moved_to: '/api/portal/[tenantSlug]/automation-policies',
    },
    { status: 410 },
  );

export const GET = gone;
export const PATCH = gone;
export const POST = gone;
export const PUT = gone;
