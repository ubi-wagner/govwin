'use client';

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowGraph — a dependency-free, SSR-safe visualization of a workflow DAG.
//
// It draws two things with the same component:
//   • the DESIGNED flow of a template (nodes coloured by step kind), and
//   • a LIVE instance (the same nodes, coloured by run status: done / running /
//     failed / paused / pending), so an admin can watch a workflow move.
//
// Layout is a deterministic layered (Sugiyama-lite) placement computed purely
// from the edge set — no DOM measurement, no animation library, no graph dep.
// Every node's (x,y) is a function of its layer (longest forward-path depth) and
// its index within that layer, so the render is identical on server and client.
// Edges are SVG cubic béziers behind absolutely-positioned node cards.
// ─────────────────────────────────────────────────────────────────────────────

export type StepKind =
  | 'TRIGGER'
  | 'ACTION'
  | 'AI_INVOKE'
  | 'API_CALL'
  | 'TODO'
  | 'HITL_WAIT'
  | 'NOTIFY'
  | 'CONDITION'
  | 'END';

export type StepRunStatus =
  | 'done'
  | 'running'
  | 'failed'
  | 'paused'
  | 'pending'
  | 'skipped'
  | null
  | undefined;

export interface GraphNode {
  id: string;
  label: string;
  kind: StepKind;
  /** present only in the live-instance view; drives status colouring */
  status?: StepRunStatus;
  /** small secondary line: an agent archetype, a timing, a role, etc. */
  sublabel?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** 'flow' = normal depends_on; 'compensation' = on_failure/on_timeout (dashed) */
  type?: 'flow' | 'compensation';
}

// ── Visual language ──────────────────────────────────────────────────────────

const KIND_STYLE: Record<StepKind, { bg: string; border: string; text: string; badge: string }> = {
  TRIGGER:   { bg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-700', badge: 'trigger' },
  ACTION:    { bg: 'bg-slate-50',  border: 'border-slate-300',  text: 'text-slate-700',  badge: 'action' },
  AI_INVOKE: { bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-700', badge: 'agent' },
  API_CALL:  { bg: 'bg-cyan-50',   border: 'border-cyan-300',   text: 'text-cyan-700',   badge: 'api' },
  TODO:      { bg: 'bg-amber-50',  border: 'border-amber-300',  text: 'text-amber-800',  badge: 'human' },
  HITL_WAIT: { bg: 'bg-amber-50',  border: 'border-amber-300',  text: 'text-amber-800',  badge: 'wait' },
  NOTIFY:    { bg: 'bg-blue-50',   border: 'border-blue-300',   text: 'text-blue-700',   badge: 'notify' },
  CONDITION: { bg: 'bg-teal-50',   border: 'border-teal-300',   text: 'text-teal-700',   badge: 'branch' },
  END:       { bg: 'bg-green-50',  border: 'border-green-400',  text: 'text-green-700',  badge: 'end' },
};

const STATUS_STYLE: Record<NonNullable<StepRunStatus>, { ring: string; dot: string; edge: string }> = {
  done:    { ring: 'ring-2 ring-green-400',  dot: 'bg-green-500',  edge: '#22c55e' },
  running: { ring: 'ring-2 ring-blue-400',   dot: 'bg-blue-500',   edge: '#3b82f6' },
  failed:  { ring: 'ring-2 ring-red-400',    dot: 'bg-red-500',    edge: '#ef4444' },
  paused:  { ring: 'ring-2 ring-yellow-400', dot: 'bg-yellow-500', edge: '#eab308' },
  pending: { ring: 'ring-1 ring-gray-200',   dot: 'bg-gray-300',   edge: '#d1d5db' },
  skipped: { ring: 'ring-1 ring-gray-200',   dot: 'bg-gray-300',   edge: '#d1d5db' },
};

// ── Layout ───────────────────────────────────────────────────────────────────

interface Placed extends GraphNode {
  x: number;
  y: number;
  layer: number;
}

interface Layout {
  nodes: Placed[];
  edges: (GraphEdge & { x1: number; y1: number; x2: number; y2: number; back: boolean })[];
  width: number;
  height: number;
}

function computeLayout(nodes: GraphNode[], edges: GraphEdge[], dims: { w: number; h: number; hgap: number; vgap: number }): Layout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Forward edges only (compensation edges must not influence layering).
  const forward = edges.filter((e) => e.type !== 'compensation' && byId.has(e.from) && byId.has(e.to));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of forward) {
    outgoing.get(e.from)!.push(e.to);
    incoming.get(e.to)!.push(e.from);
  }

  // Longest-path layering. Memoized DFS; a `seen` guard makes a stray cycle safe
  // (it degrades gracefully rather than looping forever).
  const layerOf = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const cached = layerOf.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard (shapes are DAGs; belt-and-braces)
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const d = parents.length === 0 ? 0 : Math.max(...parents.map((p) => depth(p) + 1));
    visiting.delete(id);
    layerOf.set(id, d);
    return d;
  };
  for (const n of nodes) depth(n.id);

  // Group by layer, preserving input order within a layer.
  const maxLayer = Math.max(0, ...nodes.map((n) => layerOf.get(n.id) ?? 0));
  const layers: GraphNode[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of nodes) layers[layerOf.get(n.id) ?? 0].push(n);

  const colW = dims.w + dims.hgap;
  const rowH = dims.h + dims.vgap;
  const maxRowWidth = Math.max(...layers.map((l) => l.length * dims.w + Math.max(0, l.length - 1) * dims.hgap));
  const PAD = 8;

  const placed: Placed[] = [];
  const pos = new Map<string, { x: number; y: number }>();
  layers.forEach((layerNodes, layer) => {
    const rowWidth = layerNodes.length * dims.w + Math.max(0, layerNodes.length - 1) * dims.hgap;
    const startX = PAD + (maxRowWidth - rowWidth) / 2;
    layerNodes.forEach((n, i) => {
      const x = startX + i * colW;
      const y = PAD + layer * rowH;
      pos.set(n.id, { x, y });
      placed.push({ ...n, x, y, layer });
    });
  });

  const laidEdges = edges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => {
      const a = pos.get(e.from)!;
      const b = pos.get(e.to)!;
      const back = e.type === 'compensation';
      return {
        ...e,
        x1: a.x + dims.w / 2,
        y1: a.y + dims.h,
        x2: b.x + dims.w / 2,
        y2: b.y,
        back,
      };
    });

  return {
    nodes: placed,
    edges: laidEdges,
    width: maxRowWidth + PAD * 2,
    height: PAD * 2 + (maxLayer + 1) * rowH - dims.vgap,
  };
}

function edgePath(e: { x1: number; y1: number; x2: number; y2: number; back: boolean }, nodeW: number): string {
  if (e.back) {
    // Compensation edge (on_failure/on_timeout) — bow out to the right so it
    // reads as an exception path distinct from the normal downward flow.
    const bow = Math.max(e.x1, e.x2) + nodeW * 0.6;
    return `M ${e.x1} ${e.y1} C ${bow} ${e.y1}, ${bow} ${e.y2}, ${e.x2} ${e.y2}`;
  }
  const midY = (e.y1 + e.y2) / 2;
  return `M ${e.x1} ${e.y1} C ${e.x1} ${midY}, ${e.x2} ${midY}, ${e.x2} ${e.y2}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function WorkflowGraph({
  nodes,
  edges,
  compact = false,
  live = false,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** smaller cards, no sublabels — for the template gallery */
  compact?: boolean;
  /** true when status colouring should dominate (instance view) */
  live?: boolean;
}) {
  if (nodes.length === 0) {
    return <div className="text-xs text-gray-400 p-4 text-center">No steps to display.</div>;
  }

  const dims = compact
    ? { w: 148, h: 40, hgap: 20, vgap: 30 }
    : { w: 194, h: 56, hgap: 30, vgap: 40 };
  const layout = computeLayout(nodes, edges, dims);

  return (
    <div className="overflow-x-auto">
      <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
        {/* Edge layer */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={layout.width}
          height={layout.height}
          aria-hidden
        >
          <defs>
            <marker id="wf-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#9ca3af" />
            </marker>
          </defs>
          {layout.edges.map((e, i) => {
            const fromNode = layout.nodes.find((n) => n.id === e.from);
            const stroke =
              live && fromNode?.status && STATUS_STYLE[fromNode.status]
                ? STATUS_STYLE[fromNode.status].edge
                : e.back
                  ? '#f87171'
                  : '#cbd5e1';
            return (
              <path
                key={`${e.from}-${e.to}-${i}`}
                d={edgePath(e, dims.w)}
                fill="none"
                stroke={stroke}
                strokeWidth={e.back ? 1.5 : 2}
                strokeDasharray={e.back ? '4 3' : undefined}
                markerEnd="url(#wf-arrow)"
                opacity={e.back ? 0.8 : 1}
              />
            );
          })}
        </svg>

        {/* Node layer */}
        {layout.nodes.map((n) => {
          const kind = KIND_STYLE[n.kind];
          const status = live && n.status ? STATUS_STYLE[n.status] : null;
          const dim = live && (n.status === 'pending' || n.status == null);
          return (
            <div
              key={n.id}
              className={`absolute rounded-lg border ${kind.border} ${kind.bg} shadow-sm ${status?.ring ?? ''} ${
                dim ? 'opacity-60' : ''
              } flex flex-col justify-center px-2.5`}
              style={{ left: n.x, top: n.y, width: dims.w, height: dims.h }}
              title={n.sublabel ? `${n.label} — ${n.sublabel}` : n.label}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {status && (
                  <span
                    className={`inline-flex h-2 w-2 rounded-full flex-shrink-0 ${status.dot} ${
                      n.status === 'running' ? 'animate-pulse' : ''
                    }`}
                    aria-hidden
                  />
                )}
                <span className={`truncate font-medium ${compact ? 'text-xs' : 'text-sm'} ${kind.text}`}>
                  {n.label}
                </span>
              </div>
              {!compact && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-[10px] uppercase tracking-wide font-semibold ${kind.text} opacity-70`}>
                    {kind.badge}
                  </span>
                  {n.sublabel && <span className="text-[10px] text-gray-500 truncate">· {n.sublabel}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A compact legend the parent can drop next to any graph.
export function WorkflowGraphLegend({ live = false }: { live?: boolean }) {
  const items: [string, string][] = live
    ? [
        ['bg-green-500', 'done'],
        ['bg-blue-500', 'running'],
        ['bg-yellow-500', 'paused'],
        ['bg-red-500', 'failed'],
        ['bg-gray-300', 'pending'],
      ]
    : [
        ['bg-indigo-300', 'trigger'],
        ['bg-slate-300', 'action'],
        ['bg-purple-300', 'agent'],
        ['bg-amber-300', 'human gate'],
        ['bg-blue-300', 'notify'],
        ['bg-teal-300', 'branch'],
        ['bg-green-400', 'end'],
      ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${c}`} />
          {l}
        </span>
      ))}
    </div>
  );
}
