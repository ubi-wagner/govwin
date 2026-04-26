'use client';

/**
 * AI Revision Panel — inline prompting for revising canvas nodes.
 *
 * When a user selects a node and wants to change it, this panel
 * provides quick-action buttons + a custom prompt input. Each action
 * calls the proposal.draft_section tool with the current node content
 * + the instruction, and replaces the node content with the result.
 *
 * This is the "easy-bake-oven" for individual atoms — select a
 * paragraph, click "Make shorter" or type a custom instruction,
 * and the AI revises it in place with full provenance tracking.
 */

import { useState } from 'react';
import type { CanvasNode, TextBlockContent } from '@/lib/types/canvas-document';
import { getNodeText } from '@/lib/types/canvas-document';
import { useTool } from '@/lib/hooks/use-tool';

interface Props {
  node: CanvasNode;
  proposalId: string;
  onRevised: (newContent: CanvasNode['content']) => void;
}

const QUICK_ACTIONS = [
  { label: 'Regenerate', instruction: 'Rewrite this section from scratch with the same intent but different wording.' },
  { label: 'Make shorter', instruction: 'Shorten this text by 30% while keeping all key points. Be more concise.' },
  { label: 'Make longer', instruction: 'Expand this text with more detail, examples, and supporting evidence.' },
  { label: 'More specific', instruction: 'Make this more specific and technical. Add concrete details, metrics, and methodology.' },
  { label: 'Simpler language', instruction: 'Rewrite using simpler, clearer language. Avoid jargon. Make it accessible to non-specialists.' },
  { label: 'Stronger opening', instruction: 'Rewrite with a stronger, more compelling opening sentence that grabs the reviewer\'s attention.' },
  { label: 'Add metrics', instruction: 'Add quantitative metrics, percentages, and measurable outcomes where possible.' },
  { label: 'Fix compliance', instruction: 'Ensure this text strictly adheres to the RFP requirements. Remove any content that doesn\'t directly address the evaluation criteria.' },
];

export function AIRevisionPanel({ node, proposalId, onRevised }: Props) {
  const { invoke, loading, error } = useTool();
  const [customPrompt, setCustomPrompt] = useState('');
  const [lastAction, setLastAction] = useState<string | null>(null);

  const currentText = getNodeText(node);

  async function handleRevise(instruction: string, actionLabel: string) {
    setLastAction(actionLabel);
    try {
      const result = await invoke<{ nodes: CanvasNode[] }>('proposal.draft_section', {
        proposalId,
        sectionTitle: actionLabel,
        instruction: `REVISE the following existing text:\n\n"${currentText}"\n\nInstruction: ${instruction}`,
        pageLimit: 1,
      });

      if (result.nodes && result.nodes.length > 0) {
        // Use the first node's content as the replacement
        const newContent = result.nodes[0].content;
        if (newContent) {
          onRevised(newContent);
        }
      }
    } catch {
      // error displayed via useTool
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        AI Revision
      </h3>

      {/* Quick action buttons */}
      <div className="grid grid-cols-2 gap-1.5">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            onClick={() => handleRevise(action.instruction, action.label)}
            disabled={loading || !currentText}
            className={`px-2 py-1.5 text-xs text-left rounded border transition-colors ${
              lastAction === action.label && loading
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'hover:bg-gray-50 border-gray-200 text-gray-700'
            } disabled:opacity-40`}
          >
            {lastAction === action.label && loading ? 'Revising...' : action.label}
          </button>
        ))}
      </div>

      {/* Custom prompt */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">Custom instruction</label>
        <div className="flex gap-1">
          <input
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Focus on TRL advancement..."
            disabled={loading || !currentText}
            className="flex-1 text-xs border rounded px-2 py-1.5 disabled:opacity-40"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customPrompt.trim()) {
                handleRevise(customPrompt.trim(), 'Custom');
                setCustomPrompt('');
              }
            }}
          />
          <button
            onClick={() => {
              if (customPrompt.trim()) {
                handleRevise(customPrompt.trim(), 'Custom');
                setCustomPrompt('');
              }
            }}
            disabled={loading || !customPrompt.trim() || !currentText}
            className="px-2 py-1.5 text-xs bg-indigo-600 text-white rounded disabled:opacity-40"
          >
            Go
          </button>
        </div>
      </div>

      {/* Library replacement — searches library for matching atoms,
          then asks Claude to rewrite using them */}
      <button
        onClick={async () => {
          setLastAction('From Library');
          try {
            // Search library using current text as query
            const searchResult = await invoke<{
              atoms: Array<{ id: string; content: string; category: string; tags?: string[] }>;
            }>('library.search_atoms', {
              query: currentText.slice(0, 200),
              limit: 5,
            });
            const atoms = searchResult.atoms ?? [];

            if (atoms.length === 0) {
              // No library content found — tell the user
              await handleRevise(
                'No matching library atoms found. Rewrite this section using best-practice government proposal language.',
                'From Library'
              );
              return;
            }

            // Feed library atoms to the draft tool
            const atomContext = atoms.map((a) =>
              `[Library atom | category: ${a.category}]\n${a.content}`
            ).join('\n\n---\n\n');

            await handleRevise(
              `Replace this text using the following proven content from the customer's library. Adapt the language to fit the current section context:\n\n${atomContext}`,
              'From Library'
            );
          } catch {
            // Fall back to generic instruction
            await handleRevise(
              'Replace this text with the most relevant content from the customer\'s library. Preserve the section structure but use proven language from previous winning proposals.',
              'From Library'
            );
          }
        }}
        disabled={loading || !currentText}
        className="w-full px-2 py-1.5 text-xs text-left rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
      >
        {lastAction === 'From Library' && loading ? 'Searching library...' : 'Replace with library content'}
      </button>

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Current node preview */}
      {currentText && (
        <div className="mt-2">
          <span className="text-[10px] text-gray-400">Current content ({currentText.length} chars):</span>
          <p className="text-xs text-gray-500 mt-1 line-clamp-3 italic">
            {currentText.slice(0, 200)}{currentText.length > 200 ? '...' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
