/**
 * Tool registry tests — verifies the enforcement chain without a
 * live database by stubbing the events emitter + capacity recorder.
 *
 * Covers:
 *   - register() name/namespace invariants
 *   - duplicate registration rejection
 *   - get() and list() behavior
 *   - invoke() order: lookup → role check → tenant scope check →
 *     input parse → start event → handler → end event + metric
 *   - error translation: ToolNotFoundError, ToolAuthorizationError,
 *     ToolValidationError, unknown errors wrapped in ToolExecutionError
 *   - AppError subclasses thrown from the handler pass through
 *
 * Per docs/TOOL_CONVENTIONS.md §"Registry" — these are the exact
 * invariants the framework promises, so the tests should stay
 * green as an executable contract.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { z } from 'zod';

// Mock the DB-touching modules BEFORE importing anything that uses them.
// This keeps the test hermetic — no PG, no network, no slow tests.
vi.mock('@/lib/db', () => ({
  sql: vi.fn(),
}));

vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return {
    ...actual,
    emitEventStart: vi.fn(async () => 'stub-event-id'),
    emitEventEnd: vi.fn(async () => undefined),
    emitEventSingle: vi.fn(async () => undefined),
  };
});

vi.mock('@/lib/capacity', () => ({
  recordInvoke: vi.fn(async () => undefined),
}));

// Now import the registry. The side-effect of importing lib/tools/index.ts
// would register the real memory-search / memory-write tools; we want
// isolation for these tests, so import from registry/base directly.
import { defineTool, type ToolContext } from '@/lib/tools/base';
import {
  __resetForTest,
  get,
  invoke,
  list,
  register,
} from '@/lib/tools/registry';
import {
  ToolAuthorizationError,
  ToolExecutionError,
  ToolNotFoundError,
  ToolValidationError,
} from '@/lib/tools/errors';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';

const testLog = createLogger('tools');

function buildCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    actor: {
      type: 'user',
      id: 'user-1',
      email: 'user@example.com',
      role: 'tenant_user',
    },
    tenantId: '550e8400-e29b-41d4-a716-446655440000',
    requestId: 'req_test',
    log: testLog,
    ...overrides,
  };
}

describe('register()', () => {
  beforeEach(() => {
    __resetForTest();
  });

  it('registers a tool and makes it retrievable via get()', () => {
    const tool = defineTool({
      name: 'test.noop',
      namespace: 'test',
      description: 'noop',
      inputSchema: z.object({}),
      tenantScoped: false,
      async handler() {
        return { ok: true };
      },
    });
    register(tool);
    expect(get('test.noop')).toBe(tool);
  });

  it('rejects duplicate tool names', () => {
    const tool = defineTool({
      name: 'test.dup',
      namespace: 'test',
      description: 'dup',
      inputSchema: z.object({}),
      tenantScoped: false,
      async handler() {
        return {};
      },
    });
    register(tool);
    expect(() => register(tool)).toThrow(/duplicate tool name/);
  });

  it('rejects tools whose name does not match namespace', () => {
    const tool = defineTool({
      name: 'wrong.prefix',
      namespace: 'expected',
      description: 'mismatch',
      inputSchema: z.object({}),
      tenantScoped: false,
      async handler() {
        return {};
      },
    });
    expect(() => register(tool)).toThrow(/does not match namespace/);
  });
});

describe('list()', () => {
  beforeEach(() => {
    __resetForTest();
  });

  it('returns all registered tools', () => {
    const a = defineTool({
      name: 'test.a',
      namespace: 'test',
      description: 'a',
      inputSchema: z.object({}),
      tenantScoped: false,
      async handler() {
        return {};
      },
    });
    const b = defineTool({
      name: 'test.b',
      namespace: 'test',
      description: 'b',
      inputSchema: z.object({}),
      tenantScoped: false,
      async handler() {
        return {};
      },
    });
    register(a);
    register(b);
    const all = list();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.name).sort()).toEqual(['test.a', 'test.b']);
  });
});

describe('invoke() — enforcement chain', () => {
  beforeEach(() => {
    __resetForTest();
    vi.clearAllMocks();
  });

  it('throws ToolNotFoundError when name is not registered', async () => {
    await expect(invoke('missing.tool', {}, buildCtx())).rejects.toBeInstanceOf(
      ToolNotFoundError,
    );
  });

  it('throws ToolAuthorizationError when actor role is below requiredRole', async () => {
    register(
      defineTool({
        name: 'test.admin_only',
        namespace: 'test',
        description: 'admins only',
        inputSchema: z.object({}),
        requiredRole: 'master_admin',
        tenantScoped: false,
        async handler() {
          return {};
        },
      }),
    );
    await expect(
      invoke('test.admin_only', {}, buildCtx({ actor: { type: 'user', id: 'u', role: 'tenant_user' } })),
    ).rejects.toBeInstanceOf(ToolAuthorizationError);
  });

  it('allows master_admin past any requiredRole', async () => {
    register(
      defineTool({
        name: 'test.admin_only2',
        namespace: 'test',
        description: 'admins only',
        inputSchema: z.object({}),
        requiredRole: 'rfp_admin',
        tenantScoped: false,
        async handler() {
          return { ok: true };
        },
      }),
    );
    const result = await invoke<{ ok: true }>(
      'test.admin_only2',
      {},
      buildCtx({ actor: { type: 'user', id: 'u', role: 'master_admin' } }),
    );
    expect(result.ok).toBe(true);
  });

  it('throws ToolValidationError when tenantScoped tool has null tenantId', async () => {
    register(
      defineTool({
        name: 'test.tenant_scoped',
        namespace: 'test',
        description: 'tenant scoped',
        inputSchema: z.object({}),
        tenantScoped: true,
        async handler() {
          return {};
        },
      }),
    );
    await expect(
      invoke('test.tenant_scoped', {}, buildCtx({ tenantId: null })),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });

  it('throws ToolValidationError when input fails the schema', async () => {
    register(
      defineTool({
        name: 'test.strict_input',
        namespace: 'test',
        description: 'strict',
        inputSchema: z.object({ count: z.number().int().positive() }),
        tenantScoped: false,
        async handler(input) {
          return { doubled: input.count * 2 };
        },
      }),
    );
    await expect(
      invoke('test.strict_input', { count: -1 }, buildCtx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });

  it('wraps unknown errors from the handler in ToolExecutionError', async () => {
    register(
      defineTool({
        name: 'test.blows_up',
        namespace: 'test',
        description: 'throws',
        inputSchema: z.object({}),
        tenantScoped: false,
        async handler() {
          throw new Error('something broke');
        },
      }),
    );
    await expect(invoke('test.blows_up', {}, buildCtx())).rejects.toBeInstanceOf(
      ToolExecutionError,
    );
  });

  it('lets AppError subclasses thrown by the handler propagate as-is', async () => {
    register(
      defineTool({
        name: 'test.not_found',
        namespace: 'test',
        description: 'throws NotFoundError',
        inputSchema: z.object({}),
        tenantScoped: false,
        async handler() {
          throw new NotFoundError('resource x');
        },
      }),
    );
    await expect(invoke('test.not_found', {}, buildCtx())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('lets ForbiddenError thrown by the handler propagate as-is', async () => {
    register(
      defineTool({
        name: 'test.forbidden',
        namespace: 'test',
        description: 'throws ForbiddenError',
        inputSchema: z.object({}),
        tenantScoped: false,
        async handler() {
          throw new ForbiddenError('no');
        },
      }),
    );
    await expect(invoke('test.forbidden', {}, buildCtx())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('returns the handler result on success', async () => {
    register(
      defineTool({
        name: 'test.success',
        namespace: 'test',
        description: 'ok',
        inputSchema: z.object({ n: z.number() }),
        tenantScoped: false,
        async handler(input) {
          return { doubled: input.n * 2 };
        },
      }),
    );
    const result = await invoke<{ doubled: number }>('test.success', { n: 21 }, buildCtx());
    expect(result.doubled).toBe(42);
  });
});

describe('invoke() — audit + metrics integration', () => {
  beforeEach(() => {
    __resetForTest();
    vi.clearAllMocks();
  });

  it('emits start + end events and records metrics on success', async () => {
    const events = await import('@/lib/events');
    const capacity = await import('@/lib/capacity');

    register(
      defineTool({
        name: 'test.audit_success',
        namespace: 'test',
        description: 'ok',
        inputSchema: z.object({}),
        tenantScoped: false,
        async handler() {
          return { ok: true };
        },
      }),
    );

    await invoke('test.audit_success', {}, buildCtx());

    expect(events.emitEventStart).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'tool',
        type: 'invoke.start',
      }),
    );
    expect(events.emitEventEnd).toHaveBeenCalled();
    expect(capacity.recordInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'test.audit_success',
        toolNamespace: 'test',
        success: true,
      }),
    );
  });

  it('emits end event and records metric with success=false on handler error', async () => {
    const events = await import('@/lib/events');
    const capacity = await import('@/lib/capacity');

    register(
      defineTool({
        name: 'test.audit_error',
        namespace: 'test',
        description: 'throws',
        inputSchema: z.object({}),
        tenantScoped: false,
        async handler() {
          throw new Error('handler boom');
        },
      }),
    );

    await expect(invoke('test.audit_error', {}, buildCtx())).rejects.toBeDefined();

    expect(events.emitEventEnd).toHaveBeenCalled();
    expect(capacity.recordInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'test.audit_error',
        success: false,
      }),
    );
  });
});
