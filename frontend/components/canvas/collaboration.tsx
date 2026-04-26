'use client';

/**
 * Change tracking + collaborative annotation components for the
 * canvas editor. These render inline with the canvas content to show:
 *
 *   - Per-node change indicators (who edited last, when)
 *   - Color-coded actor attribution (each collaborator gets a color)
 *   - Inline comments with resolve/unresolve
 *   - Version diff visualization (inserted/deleted text)
 */

import { useState } from 'react';
import type { NodeEdit } from '@/lib/types/canvas-document';

// ─── Actor color assignment ─────────────────────────────────────────

const ACTOR_COLORS = [
  { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-700', dot: 'bg-blue-500' },
  { bg: 'bg-green-100', border: 'border-green-300', text: 'text-green-700', dot: 'bg-green-500' },
  { bg: 'bg-purple-100', border: 'border-purple-300', text: 'text-purple-700', dot: 'bg-purple-500' },
  { bg: 'bg-orange-100', border: 'border-orange-300', text: 'text-orange-700', dot: 'bg-orange-500' },
  { bg: 'bg-pink-100', border: 'border-pink-300', text: 'text-pink-700', dot: 'bg-pink-500' },
  { bg: 'bg-teal-100', border: 'border-teal-300', text: 'text-teal-700', dot: 'bg-teal-500' },
];

const actorColorMap = new Map<string, (typeof ACTOR_COLORS)[0]>();
let nextColorIdx = 0;

export function getActorColor(actorId: string) {
  if (!actorColorMap.has(actorId)) {
    actorColorMap.set(actorId, ACTOR_COLORS[nextColorIdx % ACTOR_COLORS.length]);
    nextColorIdx++;
  }
  return actorColorMap.get(actorId)!;
}

// ─── Change Indicator (shown on each node) ──────────────────────────

interface ChangeIndicatorProps {
  history: NodeEdit[];
  compact?: boolean;
}

export function ChangeIndicator({ history, compact = true }: ChangeIndicatorProps) {
  if (history.length === 0) return null;

  const lastEdit = history[history.length - 1];
  const color = getActorColor(lastEdit.actor_id);

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1 text-[9px] ${color.text}`} title={`${lastEdit.actor_name} ${lastEdit.action} at ${new Date(lastEdit.timestamp).toLocaleString()}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
        <span>{lastEdit.actor_name?.split(' ')[0]}</span>
      </div>
    );
  }

  return (
    <div className={`text-xs p-1.5 rounded ${color.bg} ${color.border} border`}>
      <span className="font-medium">{lastEdit.actor_name}</span>
      <span className="text-gray-500"> {lastEdit.action}</span>
      <span className="text-gray-400 ml-1">
        {new Date(lastEdit.timestamp).toLocaleTimeString()}
      </span>
    </div>
  );
}

// ─── Node Comment Thread ────────────────────────────────────────────

interface NodeComment {
  id: string;
  actor_id: string;
  actor_name: string;
  text: string;
  timestamp: string;
  resolved?: boolean;
  resolved_by?: string;
}

interface CommentThreadProps {
  comments: NodeComment[];
  onAddComment: (text: string) => void;
  onResolve: (commentId: string) => void;
}

export function CommentThread({ comments, onAddComment, onResolve }: CommentThreadProps) {
  const [newComment, setNewComment] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const active = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);

  return (
    <div className="space-y-2">
      {active.map((c) => {
        const color = getActorColor(c.actor_id);
        return (
          <div key={c.id} className={`p-2 rounded border ${color.bg} ${color.border}`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-medium ${color.text}`}>{c.actor_name}</span>
              <span className="text-[10px] text-gray-400">{new Date(c.timestamp).toLocaleString()}</span>
            </div>
            <p className="text-xs text-gray-700 mt-1">{c.text}</p>
            <button
              onClick={() => onResolve(c.id)}
              className="text-[10px] text-gray-400 hover:text-green-600 mt-1"
            >
              Resolve
            </button>
          </div>
        );
      })}

      {resolved.length > 0 && (
        <button
          onClick={() => setShowResolved(!showResolved)}
          className="text-[10px] text-gray-400 hover:text-gray-600"
        >
          {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
        </button>
      )}
      {showResolved && resolved.map((c) => (
        <div key={c.id} className="p-2 rounded border border-gray-200 bg-gray-50 opacity-60">
          <span className="text-xs text-gray-500">{c.actor_name}: {c.text}</span>
          <span className="text-[10px] text-green-600 ml-2">resolved</span>
        </div>
      ))}

      <div className="flex gap-1">
        <input
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add comment..."
          className="flex-1 text-xs border rounded px-2 py-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newComment.trim()) {
              onAddComment(newComment.trim());
              setNewComment('');
            }
          }}
        />
        <button
          onClick={() => {
            if (newComment.trim()) {
              onAddComment(newComment.trim());
              setNewComment('');
            }
          }}
          className="text-xs px-2 py-1 bg-blue-600 text-white rounded"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Version Diff Visualization ─────────────────────────────────────

interface DiffViewProps {
  previous: string;
  current: string;
  actorName: string;
}

export function DiffView({ previous, current, actorName }: DiffViewProps) {
  // Simple word-level diff for inline display
  const prevWords = previous.split(/\s+/);
  const currWords = current.split(/\s+/);

  const segments: Array<{ text: string; type: 'same' | 'added' | 'removed' }> = [];

  // LCS-based diff (simplified)
  let pi = 0;
  let ci = 0;
  while (pi < prevWords.length || ci < currWords.length) {
    if (pi < prevWords.length && ci < currWords.length && prevWords[pi] === currWords[ci]) {
      segments.push({ text: prevWords[pi], type: 'same' });
      pi++; ci++;
    } else if (ci < currWords.length && (pi >= prevWords.length || !prevWords.slice(pi).includes(currWords[ci]))) {
      segments.push({ text: currWords[ci], type: 'added' });
      ci++;
    } else {
      segments.push({ text: prevWords[pi], type: 'removed' });
      pi++;
    }
  }

  return (
    <div className="text-xs p-2 bg-gray-50 rounded border border-gray-200">
      <div className="text-[10px] text-gray-400 mb-1">Changes by {actorName}:</div>
      <p className="leading-relaxed">
        {segments.map((seg, i) => (
          <span
            key={i}
            className={
              seg.type === 'added' ? 'bg-green-200 text-green-900 px-0.5 rounded' :
              seg.type === 'removed' ? 'bg-red-200 text-red-900 line-through px-0.5 rounded' :
              ''
            }
          >
            {seg.text}{' '}
          </span>
        ))}
      </p>
    </div>
  );
}

// ─── Watermark Overlay ──────────────────────────────────────────────

interface WatermarkProps {
  text: string;
  color?: string;
  opacity?: number;
}

export function WatermarkOverlay({ text, color = '#e0e0e0', opacity = 0.15 }: WatermarkProps) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden"
      style={{ zIndex: 1 }}
    >
      <div
        style={{
          fontSize: '120px',
          fontWeight: 900,
          color,
          opacity,
          transform: 'rotate(-35deg)',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          letterSpacing: '0.1em',
        }}
      >
        {text}
      </div>
    </div>
  );
}

/** Map document status to watermark text. Returns null for final docs. */
export function statusToWatermark(status: string): string | null {
  switch (status) {
    case 'empty': return 'EMPTY';
    case 'ai_drafted': return 'AI DRAFT';
    case 'in_progress': return 'DRAFT';
    case 'review': return 'FOR REVIEW';
    case 'accepted': return null;
    default: return null;
  }
}
