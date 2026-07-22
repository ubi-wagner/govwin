/**
 * The customer automation-preferences route is RETIRED (deepest-review sweep A1). It wrote the
 * OLD tenant_automation_preferences table, which diverged from the tenant_automation_policies
 * table the grammar editor writes and the CMS notifier now reads (the split-brain). It returns
 * 410 Gone, pointing callers at /api/portal/[tenantSlug]/automation-policies.
 */
import { describe, it, expect } from 'vitest';
import { GET, PATCH, POST, PUT } from '@/app/api/portal/[tenantSlug]/automation-preferences/route';

describe('retired automation-preferences route', () => {
  it('every method returns 410 Gone with a moved-to pointer', async () => {
    for (const handler of [GET, PATCH, POST, PUT]) {
      const res = await handler();
      expect(res.status).toBe(410);
      const json = await res.json();
      expect(json.code).toBe('GONE');
      expect(json.moved_to).toContain('automation-policies');
    }
  });
});
