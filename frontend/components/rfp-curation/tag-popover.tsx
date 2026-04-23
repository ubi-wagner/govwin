'use client';

/**
 * Tag-as-variable popover — appears when the admin selects text in
 * the PDF viewer. Shows a searchable list of existing compliance
 * variables + an "Add new variable" inline form. On select/create,
 * fires `onTag` with the variable name + the selected text as the
 * source excerpt. The parent calls compliance.save_variable_value
 * to persist and write the HITL memory.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

interface Variable {
  name: string;
  label: string;
  category: string;
}

export interface TagAction {
  variableName: string;
  variableLabel: string;
  sourceExcerpt: string;
  pageNumber: number;
  isNew: boolean;
}

interface Props {
  selectedText: string;
  pageNumber: number;
  /** Position relative to the PDF container. */
  position: { top: number; left: number };
  /** Full variable catalog loaded from compliance.list_variables. */
  variables: Variable[];
  onTag: (action: TagAction) => void;
  onClose: () => void;
}

export function TagPopover({
  selectedText,
  pageNumber,
  position,
  variables,
  onTag,
  onClose,
}: Props) {
  const [search, setSearch] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState('format');
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!search.trim()) return variables;
    const q = search.toLowerCase();
    return variables.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.label.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q),
    );
  }, [variables, search]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, Variable[]>();
    for (const v of filtered) {
      const arr = map.get(v.category) ?? [];
      arr.push(v);
      map.set(v.category, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const handleSelectVariable = (v: Variable) => {
    onTag({
      variableName: v.name,
      variableLabel: v.label,
      sourceExcerpt: selectedText,
      pageNumber,
      isNew: false,
    });
  };

  const handleCreateNew = () => {
    if (!newName.trim() || !newLabel.trim()) return;
    const name = newName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    onTag({
      variableName: name,
      variableLabel: newLabel.trim(),
      sourceExcerpt: selectedText,
      pageNumber,
      isNew: true,
    });
  };

  const excerpt =
    selectedText.length > 120
      ? selectedText.slice(0, 117) + '...'
      : selectedText;

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 w-80 bg-white border border-gray-200 rounded-lg shadow-xl"
      style={{
        top: `${position.top + 8}px`,
        left: `${Math.max(0, position.left - 100)}px`,
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b bg-gray-50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Tag as Compliance Variable</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xs"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500 italic truncate">&ldquo;{excerpt}&rdquo;</p>
        <p className="text-xs text-gray-400">Page {pageNumber}</p>
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b">
        <input
          type="text"
          placeholder="Search variables..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          className="w-full text-sm border border-gray-200 rounded px-2.5 py-1.5 focus:border-blue-500 outline-none"
        />
      </div>

      {/* Variable list */}
      <div className="max-h-60 overflow-y-auto">
        {grouped.length === 0 && !showNewForm && (
          <div className="px-4 py-3 text-sm text-gray-400">No matching variables.</div>
        )}
        {grouped.map(([category, vars]) => (
          <div key={category}>
            <div className="px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0">
              {category}
            </div>
            {vars.map((v) => (
              <button
                key={v.name}
                onClick={() => handleSelectVariable(v)}
                className="w-full text-left px-4 py-2 text-sm hover:bg-blue-50 hover:text-blue-800 flex items-center gap-2"
              >
                <span className="font-mono text-xs text-gray-400 w-40 truncate">
                  {v.name}
                </span>
                <span className="text-gray-700 truncate">{v.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Add new variable */}
      <div className="border-t px-4 py-3">
        {showNewForm ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="variable_name"
                className="text-xs border rounded px-2 py-1.5 font-mono"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="text-xs border rounded px-2 py-1.5"
              >
                <option value="format">Format</option>
                <option value="content">Content</option>
                <option value="eligibility">Eligibility</option>
                <option value="cost">Cost</option>
                <option value="evaluation">Evaluation</option>
                <option value="compliance">Compliance</option>
                <option value="other">Other</option>
              </select>
            </div>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Human-readable label"
              className="w-full text-xs border rounded px-2 py-1.5"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleCreateNew}
                disabled={!newName.trim() || !newLabel.trim()}
                className="px-3 py-1 bg-blue-600 text-white text-xs rounded disabled:opacity-50"
              >
                Create & Tag
              </button>
              <button
                onClick={() => setShowNewForm(false)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowNewForm(true)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            + Add new variable
          </button>
        )}
      </div>
    </div>
  );
}
