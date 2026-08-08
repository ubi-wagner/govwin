/**
 * Partner registration validation (docs/PARTNER_MANAGER_DESIGN.md §4 Branch A).
 * Pure required-field/email/length checks — the DB insert + dedup re-guard + ToDo are covered by
 * the drive/E2E. @/lib/db is mocked because the module graph pulls it in at load.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ sqlBypass: Object.assign(vi.fn(), { json: (v: unknown) => v }) }));
vi.mock('@/lib/events', () => ({ emitEventSingle: vi.fn(), userActor: (id: string, email?: string) => ({ type: 'user', id, email }) }));
vi.mock('@/lib/tasks/tasks', () => ({ createTask: vi.fn() }));

import { validateRegistration, type PartnerRegistrationInput } from '@/lib/partner/registration';

const base: PartnerRegistrationInput = {
  partner: { id: 'p1', email: 'paul@ec.com' },
  companyName: 'Acme Robotics',
  adminName: 'Ada Byron',
  adminEmail: 'ada@acme.com',
  description: 'Builds autonomous inspection robots for federal facilities.',
};

describe('validateRegistration', () => {
  it('accepts a complete input', () => {
    expect(validateRegistration(base)).toEqual({ ok: true });
  });
  it('requires company name, admin name, admin email and description', () => {
    expect(validateRegistration({ ...base, companyName: '  ' }).ok).toBe(false);
    expect(validateRegistration({ ...base, adminName: '' }).ok).toBe(false);
    expect(validateRegistration({ ...base, adminEmail: '' }).ok).toBe(false);
    expect(validateRegistration({ ...base, description: '' }).ok).toBe(false);
  });
  it('rejects a malformed admin email', () => {
    const r = validateRegistration({ ...base, adminEmail: 'not-an-email' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });
  it('rejects a too-short description', () => {
    const r = validateRegistration({ ...base, description: 'short' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });
});
