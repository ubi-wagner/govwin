'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Highlight from '@tiptap/extension-highlight'

interface SectionEditorProps {
  sectionId: string
  proposalId: string
  tenantSlug: string
  initialContent: string
  sectionTitle: string
  instructions: string | null
  pageLimit: number | null
  status: string
  onSave: (content: string) => Promise<void>
  onStatusChange?: (newStatus: string) => void
  readOnly?: boolean
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  empty: 'bg-gray-100 text-gray-700',
  ai_populated: 'bg-blue-100 text-blue-700',
  user_edited: 'bg-green-100 text-green-700',
  approved: 'bg-emerald-100 text-emerald-700',
  locked: 'bg-purple-100 text-purple-700',
  needs_revision: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
  empty: 'Empty',
  ai_populated: 'AI Populated',
  user_edited: 'User Edited',
  approved: 'Approved',
  locked: 'Locked',
  needs_revision: 'Needs Revision',
}

const CHARS_PER_PAGE = 3000
const AUTOSAVE_DELAY_MS = 2000

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export function SectionEditor({
  sectionId,
  proposalId,
  tenantSlug,
  initialContent,
  sectionTitle,
  instructions,
  pageLimit,
  status,
  onSave,
  onStatusChange,
  readOnly = false,
}: SectionEditorProps) {
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [instructionsExpanded, setInstructionsExpanded] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isEditable = !readOnly && status !== 'locked' && status !== 'approved'

  const handleSave = useCallback(
    async (html: string) => {
      setSaveState('saving')
      try {
        await onSave(html)
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    },
    [onSave]
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Placeholder.configure({
        placeholder: 'Start writing your section content here...',
      }),
      Highlight,
    ],
    content: initialContent,
    editable: isEditable,
    onUpdate({ editor: ed }) {
      const text = ed.getText()
      setWordCount(countWords(text))
      setCharCount(text.length)

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = setTimeout(() => {
        handleSave(ed.getHTML())
      }, AUTOSAVE_DELAY_MS)
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-sm sm:prose max-w-none min-h-[400px] p-4 focus:outline-none',
      },
    },
  })

  // Update editable state when props change
  useEffect(() => {
    if (editor) {
      editor.setEditable(isEditable)
    }
  }, [editor, isEditable])

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  // Update counts on initial load
  useEffect(() => {
    if (editor) {
      const text = editor.getText()
      setWordCount(countWords(text))
      setCharCount(text.length)
    }
  }, [editor])

  if (!editor) {
    return null
  }

  const estimatedPages = charCount / CHARS_PER_PAGE
  const isOverPageLimit = pageLimit !== null && estimatedPages > pageLimit
  const isNearPageLimit =
    pageLimit !== null && !isOverPageLimit && estimatedPages > pageLimit * 0.85

  const badgeClasses = STATUS_BADGE_CLASSES[status] ?? STATUS_BADGE_CLASSES.empty
  const statusLabel = STATUS_LABELS[status] ?? status

  function handleMarkAsEdited() {
    onStatusChange?.('user_edited')
  }

  function handleSubmitForReview() {
    const html = editor?.getHTML()
    if (html) {
      handleSave(html)
    }
  }

  function handleApprove() {
    onStatusChange?.('approved')
  }

  return (
    <div className="flex flex-col border border-gray-200 rounded-lg overflow-hidden">
      {/* RFP Instructions Panel */}
      {instructions && (
        <div className="bg-amber-50 border-b border-amber-200">
          <button
            type="button"
            onClick={() => setInstructionsExpanded((prev) => !prev)}
            className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
          >
            <span className="flex items-center gap-2">
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
                />
              </svg>
              RFP Instructions
            </span>
            <svg
              className={`h-4 w-4 transition-transform ${instructionsExpanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {instructionsExpanded && (
            <div className="px-4 pb-3 text-sm text-amber-900 whitespace-pre-wrap">
              {instructions}
            </div>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 bg-gray-50 border-b border-gray-200 px-2 py-1.5">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          disabled={!isEditable}
          title="Bold"
        >
          <span className="font-bold text-sm">B</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          disabled={!isEditable}
          title="Italic"
        >
          <span className="italic text-sm">I</span>
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          disabled={!isEditable}
          title="Heading 2"
        >
          <span className="text-sm font-semibold">H2</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          disabled={!isEditable}
          title="Heading 3"
        >
          <span className="text-sm font-semibold">H3</span>
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          disabled={!isEditable}
          title="Bullet List"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          disabled={!isEditable}
          title="Ordered List"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.242 5.992h12m-12 6.003h12m-12 5.999h12M4.117 7.495v-3.75H2.99m1.125 3.75H2.99m1.125 0H4.99m-1.872 8.254c.233-.586.913-1.254 1.377-1.254.575 0 1.008.378 1.008.95 0 .572-.433 1.126-1.379 2.054H2.99v.375h3.124" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          disabled={!isEditable}
          title="Blockquote"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!isEditable || !editor.can().undo()}
          title="Undo"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!isEditable || !editor.can().redo()}
          title="Redo"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
          </svg>
        </ToolbarButton>

        {/* Save indicator */}
        <div className="ml-auto flex items-center gap-2 text-xs">
          {saveState === 'saving' && (
            <span className="text-gray-500 flex items-center gap-1">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving...
            </span>
          )}
          {saveState === 'saved' && (
            <span className="text-green-600 flex items-center gap-1">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Saved
            </span>
          )}
          {saveState === 'error' && (
            <span className="text-red-600">Save failed</span>
          )}
        </div>
      </div>

      {/* Editor Content */}
      <div className="bg-white">
        <EditorContent editor={editor} />
      </div>

      {/* Word / Character / Page Count Bar */}
      <div className="flex items-center gap-4 border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">
        <span>{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}</span>
        <span>{charCount.toLocaleString()} {charCount === 1 ? 'character' : 'characters'}</span>
        <span
          className={
            isOverPageLimit
              ? 'text-red-600 font-semibold'
              : isNearPageLimit
                ? 'text-amber-600 font-medium'
                : ''
          }
        >
          ~{estimatedPages.toFixed(1)} {estimatedPages === 1 ? 'page' : 'pages'}
          {pageLimit !== null && ` / ${pageLimit}`}
        </span>
        {isOverPageLimit && (
          <span className="text-red-600 font-semibold">Over page limit</span>
        )}
      </div>

      {/* Status Bar */}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 bg-gray-50 px-4 py-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClasses}`}
        >
          {statusLabel}
        </span>

        {isEditable && (
          <div className="ml-auto flex items-center gap-2">
            {status === 'ai_populated' && (
              <button
                type="button"
                onClick={handleMarkAsEdited}
                className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 transition-colors"
              >
                Mark as Edited
              </button>
            )}
            {status === 'user_edited' && (
              <>
                <button
                  type="button"
                  onClick={handleSubmitForReview}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  Submit for Review
                </button>
                <button
                  type="button"
                  onClick={handleApprove}
                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
                >
                  Approve
                </button>
              </>
            )}
            {status === 'needs_revision' && (
              <button
                type="button"
                onClick={handleMarkAsEdited}
                className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 transition-colors"
              >
                Mark as Edited
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Toolbar sub-components                                            */
/* ------------------------------------------------------------------ */

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
        active
          ? 'bg-gray-200 text-gray-900'
          : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return <div className="mx-1 h-5 w-px bg-gray-300" />
}
