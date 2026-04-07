import postgres from 'postgres';

if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL is required in production');
}

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';

export const sql = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: { column: { to: postgres.toCamel, from: postgres.fromCamel } },
  onnotice: () => {},
});

// pg Pool for NextAuth adapter
import { Pool } from 'pg';
export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
});
pool.on('error', (err) => console.error('[db] Pool error:', err));

export async function getTenantBySlug(slug: string) {
  try {
    const [tenant] = await sql`SELECT id, slug, name, status, product_tier FROM tenants WHERE slug = ${slug} AND status != 'suspended'`;
    return tenant ?? null;
  } catch (e) {
    console.error('[getTenantBySlug] Error:', e);
    return null;
  }
}

export async function verifyTenantAccess(userId: string, role: string, tenantId: string): Promise<boolean> {
  try {
    if (role === 'master_admin' || role === 'rfp_admin') return true;
    const [row] = await sql`SELECT 1 FROM users WHERE id = ${userId} AND tenant_id = ${tenantId} AND is_active = true`;
    return !!row;
  } catch (e) {
    console.error('[verifyTenantAccess] Error:', e);
    return false;
  }
}

export async function auditLog(params: { tenantId?: string; userId?: string; action: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) {
  try {
    await sql`INSERT INTO audit_log (tenant_id, user_id, action, entity_type, entity_id, metadata) VALUES (${params.tenantId ?? null}, ${params.userId ?? null}, ${params.action}, ${params.entityType ?? null}, ${params.entityId ?? null}, ${JSON.stringify(params.metadata ?? {})})`;
  } catch (e) {
    console.error('[auditLog] Error:', e);
  }
}
