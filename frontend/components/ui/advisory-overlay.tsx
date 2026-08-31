'use client';

/**
 * AdvisoryOverlay — the shared "advisory agent output as an overlay" affordance.
 *
 * Advisory agent output (a manager's coordination plan, a reviewer's findings) must read as content
 * laid OVER the workspace, not as native furniture blended into it. This mirrors the canvas overlay
 * language (components/canvas/canvas-overlays.tsx + the `.cv-ov` dotted layers): a distinct,
 * summonable, dismissible layer with a dotted accent, agent attribution, and an explicit "advisory —
 * never advances anything" contract. Presentational + reusable; the caller fetches + supplies the body.
 *
 * Off by default (summon chip) → summoned overlay. Read-only advisory posture throughout.
 */
import { useState, type ReactNode } from 'react';
import { fmtDateTime } from '@/lib/fmt';

export interface AdvisoryOverlayProps {
  /** Overlay title, e.g. "Ingest coordination plan". */
  title: string;
  /** The producing agent, shown as attribution, e.g. "rfp_ingest_manager". */
  agent: string;
  /** Accent hex — defaults to the overlay-language indigo (#6d5ef0). */
  accent?: string;
  /** Body — the structured advisory content (rendered inside the overlay). */
  children: ReactNode;
  /** Re-fetch handler + spinner state (the plan lands async). */
  onRefresh?: () => void;
  busy?: boolean;
  /** ISO timestamp the output was generated. */
  generatedAt?: string | null;
  /** Start summoned (open) rather than collapsed to the chip. Default true (the caller only mounts
   *  it once there's real content, so open-first matches "an advisory just landed"). */
  defaultOpen?: boolean;
  /** Collapsed-chip label; defaults to `Advisory: {title}`. */
  summonLabel?: string;
}

/**
 * Renders advisory agent output in the overlay visual language. When collapsed, shows a summon chip;
 * when open, a dotted-accent overlay card set apart from the workspace, with the agent attribution,
 * a refresh, and a dismiss (collapse) control. The advisory contract line is always shown.
 */
export function AdvisoryOverlay({
  title, agent, accent = '#6d5ef0', children, onRefresh, busy, generatedAt, defaultOpen = true, summonLabel,
}: AdvisoryOverlayProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (!open) {
    // Summon chip — the overlay is "off"; a dotted-accent chip re-summons it (mirrors CanvasOverlayBar).
    return (
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-dashed px-3 py-1 text-xs font-medium transition-colors hover:bg-gray-50"
          style={{ borderColor: accent, color: accent }}
          title="Re-open the advisory overlay"
        >
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
          {summonLabel ?? `Advisory: ${title}`}
        </button>
      </div>
    );
  }

  return (
    // Laid-over treatment: dotted accent border + a soft ring, visually distinct from the solid-bordered
    // native cards around it. Accent drives the left rail + dot so it reads as one overlay layer.
    <div
      className="mb-4 rounded-lg border border-dashed bg-white px-4 py-3 shadow-sm"
      style={{ borderColor: accent, boxShadow: `inset 3px 0 0 0 ${accent}` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: accent }}>Advisory overlay</span>
          <span className="text-sm font-semibold text-gray-900 truncate">{title}</span>
          <span className="text-[11px] text-gray-400 truncate">{agent}</span>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button onClick={onRefresh} disabled={busy} className="text-xs hover:underline disabled:opacity-50" style={{ color: accent }}>
              {busy ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
          <button onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-700" title="Dismiss the overlay (summon it again from the chip)">Dismiss ✕</button>
        </div>
      </div>

      <div className="mt-2">{children}</div>

      <p className="mt-3 text-[11px] text-gray-400">
        {generatedAt ? `Generated ${fmtDateTime(generatedAt)} — ` : ''}advisory; it never advances a gate — you decide what runs.
      </p>
    </div>
  );
}

/** A verb chip in the ActOnSelection language — used for recommended agent actions inside the overlay. */
export function OverlayVerb({ label, accent = '#6d5ef0', title }: { label: string; accent?: string; title?: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{ borderColor: accent, color: accent }}
      title={title}
    >
      {label}
    </span>
  );
}
