/**
 * Typed task completers (W-M/J3). A task's `params.kind` selects how it is
 * completed in the queue: a plain review (approve/dismiss), an upload (go do it,
 * then mark done), a form (fill the spec'd fields), or an acknowledge (read the
 * note and accept — the most atomic completion, used by the broadcast workflow).
 * Pure selection + spec parsing so the rendering component stays declarative and
 * this stays testable.
 */
export type CompleterKind = 'review' | 'upload' | 'form' | 'acknowledge';

export interface FormField {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'number';
  required?: boolean;
}

/**
 * Which completer to render. An explicit `params.kind` always wins; otherwise
 * fall back to the task's workflow default (passed in by the caller from
 * `resolveTaskWorkflow(taskType).completer`) so a ToDo completes the way its
 * defined workflow prescribes — never an unmatched loose task. `fallback`
 * defaults to 'review' for callers that don't resolve a workflow.
 */
export function taskCompleterKind(
  params: Record<string, unknown> | null | undefined,
  fallback: CompleterKind = 'review',
): CompleterKind {
  const kind = params && typeof params === 'object' ? (params as { kind?: unknown }).kind : undefined;
  if (kind === 'upload' || kind === 'form' || kind === 'acknowledge' || kind === 'review') return kind;
  return fallback;
}

/** Form fields from `params.spec.fields`, defensively parsed (bad entries dropped). */
export function formFields(params: Record<string, unknown> | null | undefined): FormField[] {
  const spec = params && typeof params === 'object' ? (params as { spec?: unknown }).spec : undefined;
  const raw = spec && typeof spec === 'object' ? (spec as { fields?: unknown }).fields : undefined;
  if (!Array.isArray(raw)) return [];
  const out: FormField[] = [];
  for (const f of raw) {
    if (f && typeof f === 'object' && typeof (f as FormField).name === 'string' && (f as FormField).name.trim()) {
      const ff = f as FormField;
      out.push({
        name: ff.name,
        label: typeof ff.label === 'string' && ff.label.trim() ? ff.label : ff.name,
        type: ff.type === 'textarea' || ff.type === 'number' ? ff.type : 'text',
        required: ff.required === true,
      });
    }
  }
  return out;
}

/** The CTA target for an upload task — the entity's workspace (where upload lives). */
export function uploadHref(
  tenantSlug: string,
  entityType: string | null,
  entityId: string | null,
): string | null {
  if (entityType === 'proposal' && entityId) return `/portal/${tenantSlug}/proposals/${entityId}`;
  return null;
}
