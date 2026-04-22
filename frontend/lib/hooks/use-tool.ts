'use client';

/**
 * Client-side hook for invoking registered tools via the generic
 * `/api/tools/[name]` adapter.
 *
 * Every button click in the admin curation UI goes through this hook,
 * which means every action is automatically dual-use: the same
 * POST endpoint that the UI calls is callable by agents, automation
 * rules, CLI scripts, or any HTTP client with a valid session.
 *
 * Usage:
 *   const { invoke, loading, error } = useTool();
 *   const result = await invoke('solicitation.claim', { solicitationId });
 */

import { useState, useCallback } from 'react';

interface ToolResponse<T = unknown> {
  data?: T;
  error?: string;
  code?: string;
  details?: unknown;
}

export function useTool() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoke = useCallback(
    async <T = unknown>(toolName: string, input: unknown): Promise<T> => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`/api/tools/${toolName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input }),
        });
        const json = (await resp.json()) as ToolResponse<T>;
        if (!resp.ok || json.error) {
          const msg = json.error ?? `tool ${toolName} failed (HTTP ${resp.status})`;
          setError(msg);
          throw new Error(msg);
        }
        return json.data as T;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { invoke, loading, error, clearError: () => setError(null) };
}
