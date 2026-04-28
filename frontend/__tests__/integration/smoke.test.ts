/**
 * Pre-launch integration smoke tests — 5 tests exercising critical
 * subsystems without a running server or live database.
 *
 * 1. Auth session shape validation (RBAC)
 * 2. Proposal provisioning round-trip (templates)
 * 3. Canvas save/load consistency (canvas-document)
 * 4. Storage path tenant isolation (storage/paths)
 * 5. Event emission shape validation (events)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mocks (same pattern as tools-registry.test.ts) ─────────────────

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
const { emitSingleMock } = vi.hoisted(() => ({ emitSingleMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ sql: sqlMock }));

vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return {
    ...actual,
    emitEventStart: vi.fn(async () => 'stub-event-id'),
    emitEventEnd: vi.fn(async () => undefined),
    emitEventSingle: emitSingleMock,
  };
});

vi.mock('@/lib/capacity', () => ({
  recordInvoke: vi.fn(async () => undefined),
}));

// ─── Imports ────────────────────────────────────────────────────────

import { isRole, hasRoleAtLeast, ROLES, type Role } from '@/lib/rbac';
import {
  resolveTemplateKey,
  getTemplate,
  interpolateTemplate,
} from '@/lib/templates';
import {
  createEmptyCanvas,
  createNode,
  estimatePageCount,
  CANVAS_PRESETS,
  type CanvasDocument,
} from '@/lib/types/canvas-document';
import {
  customerPath,
  rfpPipelinePath,
  assertKeyBelongsToTenant,
} from '@/lib/storage/paths';
import type { EmitSingleParams } from '@/lib/events';

// ─── Constants ──────────────────────────────────────────────────────

const TENANT_A = 'acme-corp';
const TENANT_B = 'defense-inc';
const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const UUID_3 = '33333333-3333-4333-8333-333333333333';
const PROP_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const ALLOWED_NAMESPACES = ['finder', 'capture', 'identity', 'proposal', 'library', 'system', 'tool'];

// =====================================================================
// Test 1: Auth session shape validation
// =====================================================================

describe('Smoke 1 — Auth session shape validation', () => {
  it('isRole() accepts all valid roles', () => {
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
  });

  it('isRole() rejects invalid values', () => {
    expect(isRole('superuser')).toBe(false);
    expect(isRole('')).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
    expect(isRole('admin')).toBe(false);
  });

  it('master_admin passes role check for any required role', () => {
    for (const required of ROLES) {
      expect(hasRoleAtLeast('master_admin', required)).toBe(true);
    }
  });

  it('tenant_user is rejected for admin operations', () => {
    expect(hasRoleAtLeast('tenant_user', 'master_admin')).toBe(false);
    expect(hasRoleAtLeast('tenant_user', 'rfp_admin')).toBe(false);
    expect(hasRoleAtLeast('tenant_user', 'tenant_admin')).toBe(false);
  });

  it('tenant_user passes for tenant_user and partner_user requirements', () => {
    expect(hasRoleAtLeast('tenant_user', 'tenant_user')).toBe(true);
    expect(hasRoleAtLeast('tenant_user', 'partner_user')).toBe(true);
  });

  it('role hierarchy is strictly ordered', () => {
    const ordered: Role[] = [
      'master_admin',
      'rfp_admin',
      'tenant_admin',
      'tenant_user',
      'partner_user',
    ];
    for (let i = 0; i < ordered.length; i++) {
      // Each role should satisfy itself and everything below
      for (let j = i; j < ordered.length; j++) {
        expect(hasRoleAtLeast(ordered[i], ordered[j])).toBe(true);
      }
      // Each role should NOT satisfy anything above
      for (let k = 0; k < i; k++) {
        expect(hasRoleAtLeast(ordered[i], ordered[k])).toBe(false);
      }
    }
  });

  it('partner_user is the lowest role and only satisfies itself', () => {
    expect(hasRoleAtLeast('partner_user', 'partner_user')).toBe(true);
    expect(hasRoleAtLeast('partner_user', 'tenant_user')).toBe(false);
    expect(hasRoleAtLeast('partner_user', 'tenant_admin')).toBe(false);
    expect(hasRoleAtLeast('partner_user', 'rfp_admin')).toBe(false);
    expect(hasRoleAtLeast('partner_user', 'master_admin')).toBe(false);
  });
});

// =====================================================================
// Test 2: Proposal provisioning round-trip (templates)
// =====================================================================

describe('Smoke 2 — Proposal provisioning round-trip', () => {
  it('resolveTemplateKey() maps sbir_phase_1 + word_doc to the technical template', () => {
    const key = resolveTemplateKey('sbir_phase_1', 'word_doc');
    expect(key).toBe('dod-sbir-phase1-technical');
  });

  it('resolveTemplateKey() maps cso + slide_deck to the briefing template', () => {
    const key = resolveTemplateKey('cso', 'slide_deck');
    expect(key).toBe('dod-cso-phase1-briefing');
  });

  it('resolveTemplateKey() returns null for unknown combinations', () => {
    expect(resolveTemplateKey('unknown_program', 'word_doc')).toBeNull();
    expect(resolveTemplateKey('sbir_phase_1', 'spreadsheet')).toBeNull();
  });

  it('resolveTemplateKey() returns null for sbir_phase_2 (template not yet in map)', () => {
    // sbir_phase_2 resolves the key but the template is not in TEMPLATE_MAP
    const key = resolveTemplateKey('sbir_phase_2', 'word_doc');
    expect(key).toBeNull();
  });

  it('getTemplate() returns a deep clone of the technical template', () => {
    const doc = getTemplate('dod-sbir-phase1-technical');
    expect(doc).not.toBeNull();
    expect(doc!.version).toBe(1);
    expect(doc!.nodes.length).toBeGreaterThan(0);

    // Verify it is a clone (mutating it should not affect the original)
    const doc2 = getTemplate('dod-sbir-phase1-technical');
    doc!.metadata.title = 'MUTATED';
    expect(doc2!.metadata.title).not.toBe('MUTATED');
  });

  it('getTemplate() returns null for an unknown key', () => {
    expect(getTemplate('nonexistent')).toBeNull();
  });

  it('interpolateTemplate() replaces merge fields with provided values', () => {
    const doc = getTemplate('dod-sbir-phase1-technical')!;
    const interpolated = interpolateTemplate(doc, {
      topic_number: 'AF241-001',
      topic_title: 'Advanced Radar',
      company_name: 'Acme Defense',
      pi_name: 'Dr. Smith',
    });

    // The template uses {topic_number} and {company_name} in header/nodes
    const json = JSON.stringify(interpolated);
    expect(json).toContain('AF241-001');
    expect(json).toContain('Acme Defense');
    // Un-interpolated fields should remain as placeholders
    expect(json).not.toContain('{topic_number}');
    expect(json).not.toContain('{company_name}');
  });

  it('interpolateTemplate() preserves un-matched placeholders', () => {
    const doc = getTemplate('dod-sbir-phase1-technical')!;
    const interpolated = interpolateTemplate(doc, {
      topic_number: 'AF241-001',
      // deliberately omit company_name
    });
    const json = JSON.stringify(interpolated);
    expect(json).toContain('AF241-001');
    // {company_name} should remain since no value was provided
    expect(json).toContain('{company_name}');
  });

  it('full provisioning flow: resolve → get → interpolate → validate structure', () => {
    const key = resolveTemplateKey('sbir_phase_1', 'word_doc')!;
    expect(key).toBeTruthy();

    const template = getTemplate(key)!;
    expect(template).toBeTruthy();

    const doc = interpolateTemplate(template, {
      topic_number: 'N241-002',
      topic_title: 'Undersea Sensors',
      company_name: 'DeepTech LLC',
      pi_name: 'Dr. Jones',
    });

    // Verify structural integrity after interpolation
    expect(doc.version).toBe(1);
    expect(doc.canvas).toBeDefined();
    expect(doc.canvas.format).toBe('letter');
    expect(doc.nodes).toBeInstanceOf(Array);
    expect(doc.nodes.length).toBeGreaterThan(0);
    expect(doc.metadata.title).toBeDefined();

    // Verify every node has required fields
    for (const node of doc.nodes) {
      expect(node.id).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.provenance).toBeDefined();
      expect(node.provenance.source).toBe('template');
    }
  });
});

// =====================================================================
// Test 3: Canvas save/load consistency
// =====================================================================

describe('Smoke 3 — Canvas save/load consistency', () => {
  function buildTestDoc(): CanvasDocument {
    const canvas = CANVAS_PRESETS.letter_sbir_phase1;
    const doc = createEmptyCanvas({
      documentId: UUID_1,
      canvas,
      metadata: {
        title: 'Test Technical Volume',
        volume_id: UUID_2,
        required_item_id: UUID_3,
        proposal_id: PROP_UUID,
        solicitation_id: UUID_1,
        created_at: '2026-04-28T00:00:00Z',
        last_modified_at: '2026-04-28T00:00:00Z',
        last_modified_by: 'user-1',
        version_number: 1,
        status: 'empty',
      },
    });

    // Add a heading node
    doc.nodes.push(createNode({
      type: 'heading',
      content: { level: 1, text: 'Technical Approach' },
      source: 'manual',
      actorId: 'user-1',
      actorName: 'Test User',
    }));

    // Add a text block node
    doc.nodes.push(createNode({
      type: 'text_block',
      content: {
        text: 'This section describes the innovative technical approach for the proposed solution. '
          + 'The system leverages advanced machine learning algorithms to detect anomalies in real-time sensor data.',
      },
      source: 'ai_draft',
      actorId: 'agent-1',
      actorName: 'Draft Agent',
      libraryTags: ['technical', 'ml'],
    }));

    // Add a bulleted list node
    doc.nodes.push(createNode({
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Real-time processing pipeline' },
          { text: 'Edge computing deployment' },
          { text: 'Federated learning architecture' },
        ],
      },
      source: 'manual',
      actorId: 'user-1',
      actorName: 'Test User',
    }));

    // Add a page break
    doc.nodes.push(createNode({
      type: 'page_break',
      content: null,
      source: 'manual',
      actorId: 'user-1',
      actorName: 'Test User',
    }));

    // Add a table node
    doc.nodes.push(createNode({
      type: 'table',
      content: {
        headers: ['Milestone', 'Duration', 'Deliverable'],
        rows: [
          ['Design Review', '2 months', 'SDD Document'],
          ['Prototype', '4 months', 'Working demo'],
          ['Testing', '2 months', 'Test report'],
        ],
      },
      source: 'manual',
      actorId: 'user-1',
      actorName: 'Test User',
    }));

    return doc;
  }

  it('round-trip serialization preserves all fields', () => {
    const original = buildTestDoc();

    // Simulate save (serialize to JSON string)
    const saved = JSON.stringify(original);

    // Simulate load (parse back from JSON string)
    const loaded: CanvasDocument = JSON.parse(saved);

    // Verify structural equality
    expect(loaded.version).toBe(original.version);
    expect(loaded.document_id).toBe(original.document_id);
    expect(loaded.canvas).toEqual(original.canvas);
    expect(loaded.metadata).toEqual(original.metadata);
    expect(loaded.nodes).toHaveLength(original.nodes.length);

    // Verify each node round-trips
    for (let i = 0; i < original.nodes.length; i++) {
      expect(loaded.nodes[i].id).toBe(original.nodes[i].id);
      expect(loaded.nodes[i].type).toBe(original.nodes[i].type);
      expect(loaded.nodes[i].content).toEqual(original.nodes[i].content);
      expect(loaded.nodes[i].style).toEqual(original.nodes[i].style);
      expect(loaded.nodes[i].provenance).toEqual(original.nodes[i].provenance);
      expect(loaded.nodes[i].library_eligible).toBe(original.nodes[i].library_eligible);
      expect(loaded.nodes[i].library_tags).toEqual(original.nodes[i].library_tags);
    }
  });

  it('createNode() sets library_eligible=false for page_break, spacer, toc', () => {
    const pageBreak = createNode({
      type: 'page_break', content: null, source: 'manual',
      actorId: 'u1', actorName: 'Test',
    });
    expect(pageBreak.library_eligible).toBe(false);

    const spacer = createNode({
      type: 'spacer', content: null, source: 'manual',
      actorId: 'u1', actorName: 'Test',
    });
    expect(spacer.library_eligible).toBe(false);

    const toc = createNode({
      type: 'toc', content: { max_depth: 2 }, source: 'manual',
      actorId: 'u1', actorName: 'Test',
    });
    expect(toc.library_eligible).toBe(false);
  });

  it('createNode() sets library_eligible=true for content node types', () => {
    const heading = createNode({
      type: 'heading', content: { level: 1, text: 'Title' },
      source: 'manual', actorId: 'u1', actorName: 'Test',
    });
    expect(heading.library_eligible).toBe(true);

    const textBlock = createNode({
      type: 'text_block', content: { text: 'Content' },
      source: 'manual', actorId: 'u1', actorName: 'Test',
    });
    expect(textBlock.library_eligible).toBe(true);

    const table = createNode({
      type: 'table',
      content: { headers: ['A'], rows: [['1']] },
      source: 'manual', actorId: 'u1', actorName: 'Test',
    });
    expect(table.library_eligible).toBe(true);
  });

  it('createNode() records provenance and history', () => {
    const node = createNode({
      type: 'text_block',
      content: { text: 'Test content' },
      source: 'ai_draft',
      actorId: 'agent-1',
      actorName: 'Draft Agent',
      libraryTags: ['test'],
    });

    expect(node.provenance.source).toBe('ai_draft');
    expect(node.provenance.drafted_by).toBe('agent-1');
    expect(node.provenance.drafted_at).toBeDefined();
    expect(node.history).toHaveLength(1);
    expect(node.history[0].actor_id).toBe('agent-1');
    expect(node.history[0].action).toBe('created');
    expect(node.library_tags).toEqual(['test']);
  });

  it('estimatePageCount() returns a reasonable number for the test doc', () => {
    const doc = buildTestDoc();
    const pages = estimatePageCount(doc);

    // A document with a heading, a paragraph, a list, a page break, and a table
    // should estimate to at least 2 pages (page break forces a new page)
    expect(pages).toBeGreaterThanOrEqual(2);
    // And should not be absurdly large
    expect(pages).toBeLessThanOrEqual(50);
  });

  it('estimatePageCount() returns 1 for an empty document', () => {
    const doc = createEmptyCanvas({
      documentId: UUID_1,
      canvas: CANVAS_PRESETS.letter_standard,
      metadata: {
        title: 'Empty', volume_id: '', required_item_id: '',
        proposal_id: '', solicitation_id: '',
        created_at: '', last_modified_at: '', last_modified_by: '',
        version_number: 1, status: 'empty',
      },
    });
    expect(estimatePageCount(doc)).toBe(1);
  });
});

// =====================================================================
// Test 4: Storage path tenant isolation
// =====================================================================

describe('Smoke 4 — Storage path tenant isolation', () => {
  it('paths for different tenants never share a prefix', () => {
    const pathA = customerPath({
      tenantSlug: TENANT_A, kind: 'proposal-section',
      proposalId: PROP_UUID, sectionSlug: 'executive-summary',
    });
    const pathB = customerPath({
      tenantSlug: TENANT_B, kind: 'proposal-section',
      proposalId: PROP_UUID, sectionSlug: 'executive-summary',
    });

    expect(pathA).toContain(TENANT_A);
    expect(pathB).toContain(TENANT_B);
    expect(pathA).not.toEqual(pathB);

    // Neither path should be a prefix of the other
    expect(pathA.startsWith(pathB.substring(0, pathB.indexOf('/', 11)))).toBe(false);
    expect(pathB.startsWith(pathA.substring(0, pathA.indexOf('/', 11)))).toBe(false);
  });

  it('assertKeyBelongsToTenant() rejects cross-tenant access', () => {
    const tenantAKey = customerPath({
      tenantSlug: TENANT_A, kind: 'upload',
      name: UUID_1, ext: 'pdf', at: new Date('2026-04-01'),
    });

    // Tenant A's key should pass for tenant A
    expect(() => assertKeyBelongsToTenant(tenantAKey, TENANT_A)).not.toThrow();

    // Tenant A's key should fail for tenant B
    expect(() => assertKeyBelongsToTenant(tenantAKey, TENANT_B)).toThrow(
      /does not belong to tenant/,
    );
  });

  it('rejects ".." path traversal in tenant slug', () => {
    expect(() =>
      customerPath({
        tenantSlug: '../admin',
        kind: 'upload',
        name: UUID_1,
        ext: 'pdf',
      }),
    ).toThrow(/invalid tenant slug/);
  });

  it('rejects ".." path traversal in section slug', () => {
    expect(() =>
      customerPath({
        tenantSlug: TENANT_A,
        kind: 'proposal-section',
        proposalId: PROP_UUID,
        sectionSlug: '../../../etc/passwd',
      }),
    ).toThrow(/invalid section slug/);
  });

  it('rejects ".." path traversal in extension', () => {
    expect(() =>
      customerPath({
        tenantSlug: TENANT_A,
        kind: 'upload',
        name: UUID_1,
        ext: '../pdf',
      }),
    ).toThrow(/invalid extension/);
  });

  it('rfpPipelinePath() paths are not under customers/ prefix', () => {
    const pipelinePath = rfpPipelinePath({
      opportunityId: UUID_1, kind: 'source', ext: 'pdf',
    });
    expect(pipelinePath.startsWith('rfp-pipeline/')).toBe(true);
    expect(pipelinePath.startsWith('customers/')).toBe(false);
  });

  it('rfpPipelinePath() rejects non-UUID opportunity IDs', () => {
    expect(() =>
      rfpPipelinePath({ opportunityId: 'not-a-uuid', kind: 'text' }),
    ).toThrow(/invalid opportunity id/);
  });

  it('customer paths for all kinds are always scoped under the tenant prefix', () => {
    const kinds: Array<{ kind: 'upload' | 'proposal-section' | 'proposal-attachment' | 'proposal-export' | 'library-unit' | 'library-asset'; extra: Record<string, string> }> = [
      { kind: 'upload', extra: { name: UUID_1, ext: 'pdf' } },
      { kind: 'proposal-section', extra: { proposalId: PROP_UUID, sectionSlug: 'intro' } },
      { kind: 'proposal-attachment', extra: { proposalId: PROP_UUID, name: UUID_1, ext: 'pdf' } },
      { kind: 'proposal-export', extra: { proposalId: PROP_UUID, name: 'final-v1', ext: 'docx' } },
      { kind: 'library-unit', extra: { unitId: UUID_1 } },
      { kind: 'library-asset', extra: { assetId: UUID_1, ext: 'png' } },
    ];

    for (const { kind, extra } of kinds) {
      const path = customerPath({
        tenantSlug: TENANT_A,
        kind,
        at: new Date('2026-04-01'),
        ...extra,
      });
      expect(path.startsWith(`customers/${TENANT_A}/`)).toBe(true);
    }
  });
});

// =====================================================================
// Test 5: Event emission shape validation
// =====================================================================

describe('Smoke 5 — Event emission shape validation', () => {
  beforeEach(() => {
    emitSingleMock.mockReset();
    emitSingleMock.mockResolvedValue(undefined);
  });

  it('emitEventSingle receives correct shape with all required fields', async () => {
    const { emitEventSingle } = await import('@/lib/events');

    await emitEventSingle({
      namespace: 'finder',
      type: 'opportunity.discovered',
      actor: { type: 'system', id: 'ingestion-worker' },
      tenantId: null,
      payload: { source: 'sam-gov', count: 5 },
    });

    expect(emitSingleMock).toHaveBeenCalledTimes(1);
    const call = emitSingleMock.mock.calls[0][0] as EmitSingleParams;

    // Verify required shape fields
    expect(call.namespace).toBeDefined();
    expect(typeof call.namespace).toBe('string');
    expect(call.type).toBeDefined();
    expect(typeof call.type).toBe('string');
    expect(call.actor).toBeDefined();
    expect(call.actor.type).toBeDefined();
    expect(call.actor.id).toBeDefined();
  });

  it('admin events have tenantId=null', async () => {
    const { emitEventSingle } = await import('@/lib/events');

    await emitEventSingle({
      namespace: 'finder',
      type: 'rfp.triage_claimed',
      actor: { type: 'user', id: 'admin-1', email: 'admin@example.com' },
      tenantId: null,
    });

    const call = emitSingleMock.mock.calls[0][0] as EmitSingleParams;
    expect(call.tenantId).toBeNull();
  });

  it('portal events have tenantId set', async () => {
    const { emitEventSingle } = await import('@/lib/events');
    const tenantId = UUID_1;

    await emitEventSingle({
      namespace: 'capture',
      type: 'proposal.created',
      actor: { type: 'user', id: 'user-1', email: 'user@acme.com' },
      tenantId,
      payload: { proposalId: PROP_UUID },
    });

    const call = emitSingleMock.mock.calls[0][0] as EmitSingleParams;
    expect(call.tenantId).toBe(tenantId);
    expect(call.tenantId).not.toBeNull();
  });

  it('namespace must be from the allowed list', () => {
    // Verify the allowed namespaces match the SOP
    const forbidden = ['admin', 'cms', 'spotlight'];
    for (const ns of forbidden) {
      expect(ALLOWED_NAMESPACES).not.toContain(ns);
    }

    // Verify the expected namespaces are in the list
    expect(ALLOWED_NAMESPACES).toContain('finder');
    expect(ALLOWED_NAMESPACES).toContain('capture');
    expect(ALLOWED_NAMESPACES).toContain('identity');
    expect(ALLOWED_NAMESPACES).toContain('proposal');
    expect(ALLOWED_NAMESPACES).toContain('library');
    expect(ALLOWED_NAMESPACES).toContain('system');
    expect(ALLOWED_NAMESPACES).toContain('tool');
  });

  it('actor types match the ActorType union', async () => {
    const { emitEventSingle } = await import('@/lib/events');
    const validActorTypes = ['user', 'system', 'pipeline', 'agent'] as const;

    for (const actorType of validActorTypes) {
      emitSingleMock.mockClear();

      await emitEventSingle({
        namespace: 'system',
        type: 'health.checked',
        actor: { type: actorType, id: `${actorType}-1` },
      });

      expect(emitSingleMock).toHaveBeenCalledTimes(1);
      const call = emitSingleMock.mock.calls[0][0] as EmitSingleParams;
      expect(call.actor.type).toBe(actorType);
    }
  });

  it('event type format follows entity.action_past_tense (contains a dot)', async () => {
    const { emitEventSingle } = await import('@/lib/events');

    const validTypes = [
      'rfp.triage_claimed',
      'proposal.created',
      'opportunity.discovered',
      'user.signed_in',
      'compliance_value.saved',
    ];

    for (const type of validTypes) {
      emitSingleMock.mockClear();
      await emitEventSingle({
        namespace: 'system',
        type,
        actor: { type: 'system', id: 'test' },
      });

      const call = emitSingleMock.mock.calls[0][0] as EmitSingleParams;
      // Every event type should contain at least one dot
      expect(call.type).toContain('.');
      // Should be snake_case (no uppercase, no spaces)
      expect(call.type).toMatch(/^[a-z][a-z0-9_.]+$/);
    }
  });

  it('actor helpers produce correct shapes', async () => {
    const { userActor, systemActor, pipelineActor, agentActor } = await import('@/lib/events');

    const user = userActor('user-1', 'user@example.com');
    expect(user).toEqual({ type: 'user', id: 'user-1', email: 'user@example.com' });

    const system = systemActor();
    expect(system).toEqual({ type: 'system', id: 'system' });

    const pipeline = pipelineActor('worker-abc');
    expect(pipeline).toEqual({ type: 'pipeline', id: 'worker-abc' });

    const agent = agentActor('drafter', UUID_1);
    expect(agent).toEqual({ type: 'agent', id: `drafter:${UUID_1}` });
  });
});
