/** Generate db/migrations/191_seed_immobileyes_proposals.sql from the LIVE sandbox rows —
 *  the four real DSIP proposals ingested through the product (tenant + admin + membership +
 *  profile + 4 package cocoons + every atom + tag), captured as an idempotent deploy seed.
 *
 *  Safety: the whole seed runs inside one DO block that RESOLVES the tenant/user by
 *  slug/email and SKIPS (RAISE NOTICE) if either already exists with a DIFFERENT id — no
 *  partial FK breakage on a drifted deploy. Re-running with matching ids no-ops via
 *  ON CONFLICT. Embeddings are not captured (regenerated on demand).
 *
 *  cd frontend && DATABASE_URL=… node --import tsx scripts/gen-immobileyes-seed.mts */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sql } from '@/lib/db';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations', '191_seed_immobileyes_proposals.sql');
const TAG = '$IMM191$';

const q = (v: unknown): string => {
  if (v == null) return 'NULL';
  const s = typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : JSON.stringify(v);
  if (s.includes('IMM191')) throw new Error('content collides with the dollar-quote tag');
  return `'${s.replace(/'/g, "''")}'`;
};
const qj = (v: unknown): string => (v == null ? 'NULL' : `${q(typeof v === 'string' ? v : JSON.stringify(v))}::jsonb`);
const qn = (v: unknown): string => (v == null ? 'NULL' : String(v));
const qb = (v: unknown): string => (v ? 'true' : 'false');

const [tenant] = await sql<Array<Record<string, unknown>>>`
  SELECT id, name, slug, legal_name, website, status, lifecycle_stage, billing_email
  FROM tenants WHERE slug = 'immobileyes' LIMIT 1`;
if (!tenant) throw new Error('immobileyes tenant not found');
const tid = String(tenant.id);

const [admin] = await sql<Array<Record<string, unknown>>>`
  SELECT id, email, name, role, password_hash FROM users WHERE email = 'admin@immobileyes.test' LIMIT 1`;
const uid = String(admin.id);

const [profile] = await sql<Array<Record<string, unknown>>>`
  SELECT naics_codes, keywords, target_agencies, set_aside_types, research_areas,
         company_summary, technology_focus, agency_priorities
  FROM tenant_profiles WHERE tenant_id = ${tid}::uuid LIMIT 1`;

const cocoons = await sql<Array<Record<string, unknown>>>`
  SELECT id, name, program_type, scope, structure, source, created_at
  FROM document_cocoons WHERE tenant_id = ${tid}::uuid AND source = 'upload'
    AND id IN (SELECT DISTINCT cocoon_id FROM library_atoms WHERE tenant_id = ${tid}::uuid AND cocoon_id IS NOT NULL)
  ORDER BY created_at`;

const atoms = await sql<Array<Record<string, unknown>>>`
  SELECT id, grain, title, content, canvas_nodes, summary, word_count, char_count,
         member_summary, status, confidence, outcome, outcome_score, usage_count, source,
         cocoon_id, origin_proposal_id, origin_section_id, owner_user_id, visibility,
         created_at, updated_at, creator_kind, created_by, source_anchor, vault_id
  FROM library_atoms
  WHERE tenant_id = ${tid}::uuid AND cocoon_id = ANY(${cocoons.map((c) => String(c.id))}::uuid[])
  ORDER BY created_at, id`;

const tags = await sql<Array<Record<string, unknown>>>`
  SELECT t.atom_id, t.dimension, t.value, t.is_other, t.tag_source, t.confirmed
  FROM atom_tags t JOIN library_atoms a ON a.id = t.atom_id
  WHERE a.tenant_id = ${tid}::uuid AND a.cocoon_id = ANY(${cocoons.map((c) => String(c.id))}::uuid[])
  ORDER BY t.atom_id, t.dimension, t.value`;

const lines: string[] = [];
lines.push(`-- 191_seed_immobileyes_proposals.sql
-- Deploy seed: the Immobileyes tenant + admin + company profile + the FOUR real DSIP past
-- proposals ingested live through the product's deconstruct pipeline on 2026-08-18
-- (Navy N26BX GHOST 14-file package · Navy N254 LEOPARD · AFWERX CSO HALAR · AF STTR-II
-- Directed Energy): ${cocoons.length} package cocoons, ${atoms.length} library atoms
-- (per-volume foundation docs + page-cited primitives + sidecar references), ${tags.length} tags.
-- Idempotent + drift-safe: everything runs in one guarded DO block that SKIPS with a NOTICE
-- if 'immobileyes' or its admin already exist under different ids. Embeddings regenerate on
-- demand. Generated from the verified sandbox by frontend/scripts/gen-immobileyes-seed.mts.

DO ${TAG}
DECLARE
  tid uuid;
  uid uuid;
BEGIN
  INSERT INTO tenants (id, name, slug, legal_name, website, status, lifecycle_stage, billing_email)
  VALUES (${q(tid)}::uuid, ${q(tenant.name)}, 'immobileyes', ${q(tenant.legalName)}, ${q(tenant.website)}, 'active', ${q(tenant.lifecycleStage)}, ${q(tenant.billingEmail)})
  ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO tid FROM tenants WHERE slug = 'immobileyes';
  IF tid IS DISTINCT FROM ${q(String(tenant.id))}::uuid THEN
    RAISE NOTICE 'immobileyes exists with a different id — skipping the proposal seed';
    RETURN;
  END IF;

  INSERT INTO users (id, email, name, role, tenant_id, password_hash, temp_password, is_active)
  VALUES (${q(uid)}::uuid, ${q(admin.email)}, ${q(admin.name)}, 'tenant_admin', tid, ${q(admin.passwordHash)}, false, true)
  ON CONFLICT (email) DO NOTHING;
  SELECT id INTO uid FROM users WHERE email = ${q(String(admin.email))};
  IF uid IS DISTINCT FROM ${q(String(admin.id))}::uuid THEN
    RAISE NOTICE 'admin@immobileyes.test exists with a different id — skipping the proposal seed';
    RETURN;
  END IF;

  INSERT INTO user_memberships (user_id, tenant_id, role, status, source)
  VALUES (uid, tid, 'tenant_admin', 'active', 'home')
  ON CONFLICT (user_id, tenant_id) DO NOTHING;
`);

if (profile) {
  const arr = (v: unknown) => (Array.isArray(v) && v.length ? `ARRAY[${v.map((x) => q(x)).join(',')}]::text[]` : `'{}'::text[]`);
  lines.push(`  INSERT INTO tenant_profiles (tenant_id, naics_codes, keywords, target_agencies, set_aside_types, research_areas, company_summary, technology_focus, agency_priorities)
  VALUES (tid, ${arr(profile.naicsCodes)}, ${arr(profile.keywords)}, ${arr(profile.targetAgencies)}, ${arr(profile.setAsideTypes)}, ${arr(profile.researchAreas)}, ${q(profile.companySummary)}, ${q(profile.technologyFocus)}, ${arr(profile.agencyPriorities)})
  ON CONFLICT (tenant_id) DO NOTHING;
`);
}

for (const c of cocoons) {
  lines.push(`  INSERT INTO document_cocoons (id, tenant_id, name, program_type, scope, structure, source, created_at)
  VALUES (${q(String(c.id))}::uuid, tid, ${q(c.name)}, ${q(c.programType)}, ${q(c.scope)}, ${qj(c.structure)}, ${q(c.source)}, ${q(c.createdAt)}::timestamptz)
  ON CONFLICT (id) DO NOTHING;
`);
}

for (const a of atoms) {
  lines.push(`  INSERT INTO library_atoms (id, tenant_id, grain, title, content, canvas_nodes, summary, word_count, char_count, member_summary, status, confidence, outcome, outcome_score, usage_count, source, cocoon_id, origin_proposal_id, origin_section_id, owner_user_id, visibility, created_at, updated_at, creator_kind, created_by, source_anchor, vault_id)
  VALUES (${q(String(a.id))}::uuid, tid, ${q(a.grain)}, ${q(a.title)}, ${q(a.content)}, ${qj(a.canvasNodes)}, ${q(a.summary)}, ${qn(a.wordCount)}, ${qn(a.charCount)}, ${qj(a.memberSummary)}, ${q(a.status)}, ${qn(a.confidence)}, ${q(a.outcome)}, ${qn(a.outcomeScore)}, ${qn(a.usageCount)}, ${q(a.source)}, ${q(String(a.cocoonId))}::uuid, ${a.originProposalId ? `${q(String(a.originProposalId))}::uuid` : 'NULL'}, ${a.originSectionId ? `${q(String(a.originSectionId))}::uuid` : 'NULL'}, ${a.ownerUserId ? `${q(String(a.ownerUserId))}::uuid` : 'NULL'}, ${q(a.visibility)}, ${q(a.createdAt)}::timestamptz, ${q(a.updatedAt)}::timestamptz, ${q(a.creatorKind)}, ${a.createdBy ? 'uid' : 'NULL'}, ${qj(a.sourceAnchor)}, ${a.vaultId ? `${q(String(a.vaultId))}::uuid` : 'NULL'})
  ON CONFLICT (id) DO NOTHING;
`);
}

for (const t of tags) {
  lines.push(`  INSERT INTO atom_tags (atom_id, dimension, value, is_other, tag_source, confirmed)
  VALUES (${q(String(t.atomId))}::uuid, ${q(t.dimension)}, ${q(t.value)}, ${qb(t.isOther)}, ${q(t.tagSource)}, ${qb(t.confirmed)})
  ON CONFLICT (atom_id, dimension, value) DO NOTHING;
`);
}

lines.push(`  RAISE NOTICE 'Immobileyes proposal seed: % cocoons, % atoms, % tags', ${cocoons.length}, ${atoms.length}, ${tags.length};
END
${TAG};
`);

writeFileSync(OUT, lines.join('\n'));
console.log(`wrote ${OUT} — ${cocoons.length} cocoons, ${atoms.length} atoms, ${tags.length} tags, ${(lines.join('\n').length / 1024).toFixed(0)} KB`);
await sql.end();
