'use client';

/**
 * NodeFormatControls — the canvas editor's context-aware "ribbon" drawer.
 *
 * Given the selected node, it shows exactly the format groups that node supports
 * (see lib/canvas/format-controls.ts): the run-styling extras (underline /
 * strikethrough / highlight), the Shape-Format group (fill+opacity · border
 * color/width/style/radius · opacity · rotation · shadow), the Arrange group
 * (free x/y/w/h placement + text wrap — content boxes that DON'T snap to the
 * margins), and the one element-specific control (shape kind · callout variant ·
 * chart type · divider line style · code language · signature label). It drives
 * the editor's node.style / node.content / node.position updaters, so undo/redo/
 * save all apply. Purely additive to the existing text-format block.
 */
import type {
  CanvasNode, NodeStyle, NodePosition, ShapeContent, CalloutContent,
  ChartContent, DividerContent, CodeBlockContent, SignatureContent,
} from '@/lib/types/canvas-document';
import {
  formatCapabilities, SHAPE_KINDS, CALLOUT_VARIANTS, CHART_TYPES, LINE_STYLES, BORDER_STYLES, WRAP_MODES,
} from '@/lib/canvas/format-controls';

interface Props {
  node: CanvasNode;
  onStyle: (patch: Partial<NodeStyle>) => void;
  onContent: (content: CanvasNode['content']) => void;
  onPosition: (patch: Partial<NodePosition>) => void;
  readOnly?: boolean;
}

const label = 'text-[10px] text-gray-400 block mb-1';
const field = 'w-full text-xs border rounded px-1.5 py-1';
const H3 = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-4">{children}</h3>
);

/** A 0..1 opacity slider with a % readout. */
function Opacity({ value, onChange, title }: { value?: number; onChange: (v: number | undefined) => void; title: string }) {
  const pct = Math.round((value ?? 1) * 100);
  return (
    <div>
      <label className={label}>{title} <span className="text-gray-400 tabular-nums">{pct}%</span></label>
      <input type="range" min={0} max={100} step={5} value={pct}
        onChange={(e) => { const v = parseInt(e.target.value) / 100; onChange(v >= 1 ? undefined : v); }}
        className="w-full h-1.5 accent-blue-600" />
    </div>
  );
}

export function NodeFormatControls({ node, onStyle, onContent, onPosition, readOnly }: Props) {
  if (readOnly) return null;
  const caps = formatCapabilities(node.type);
  const s = node.style ?? {};
  const p = node.position ?? {};
  const c = (node.content ?? {}) as unknown;

  const toggle = 'px-3 py-1 text-xs border rounded';
  const on = 'bg-blue-100 border-blue-300 text-blue-700';
  const off = 'border-gray-200 text-gray-600 hover:bg-gray-50';

  return (
    <div>
      {/* ── Run styling extras (B/I/color live in the Text block above) ── */}
      {caps.text && (
        <>
          <H3>Emphasis</H3>
          <div className="flex flex-wrap items-center gap-1">
            <button onClick={() => onStyle({ underline: !s.underline })} className={`${toggle} underline ${s.underline ? on : off}`} title="Underline">U</button>
            <button onClick={() => onStyle({ strikethrough: !s.strikethrough })} className={`${toggle} line-through ${s.strikethrough ? on : off}`} title="Strikethrough">S</button>
            <label className="ml-1 flex items-center gap-1 text-[10px] text-gray-500" title="Highlight">
              <span aria-hidden>🖍</span>
              <input type="color" value={s.highlight || '#FFFF00'} onChange={(e) => onStyle({ highlight: e.target.value })} className="h-6 w-6 rounded border cursor-pointer p-0" />
              {s.highlight && <button onClick={() => onStyle({ highlight: undefined })} className="text-rose-500 hover:underline">clear</button>}
            </label>
          </div>
        </>
      )}

      {/* ── Shape Format: fill / border / effects ── */}
      {caps.box && (
        <>
          <H3>Fill &amp; border</H3>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className={label}>Fill</label>
              <div className="flex items-center gap-1">
                <input type="color" value={s.fill?.color || '#DCE6F1'} onChange={(e) => onStyle({ fill: { ...s.fill, color: e.target.value } })} className="h-6 w-6 rounded border cursor-pointer p-0" />
                {s.fill?.color && <button onClick={() => onStyle({ fill: undefined })} className="text-[10px] text-rose-500 hover:underline">none</button>}
              </div>
            </div>
            <div>
              <label className={label}>Border</label>
              <div className="flex items-center gap-1">
                <input type="color" value={s.border?.color || '#334155'} onChange={(e) => onStyle({ border: { ...s.border, color: e.target.value } })} className="h-6 w-6 rounded border cursor-pointer p-0" />
                {s.border && <button onClick={() => onStyle({ border: undefined })} className="text-[10px] text-rose-500 hover:underline">none</button>}
              </div>
            </div>
          </div>
          {s.fill && <div className="mb-2"><Opacity title="Fill opacity" value={s.fill.opacity} onChange={(v) => onStyle({ fill: { ...s.fill, opacity: v } })} /></div>}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div>
              <label className={label}>Width</label>
              <input type="number" min={0} max={12} step={0.5} value={s.border?.width ?? ''} placeholder="1"
                onChange={(e) => onStyle({ border: { ...s.border, width: e.target.value ? parseFloat(e.target.value) : undefined } })} className={field} />
            </div>
            <div>
              <label className={label}>Style</label>
              <select value={s.border?.style ?? 'solid'} onChange={(e) => onStyle({ border: { ...s.border, style: e.target.value as NonNullable<NodeStyle['border']>['style'] } })} className={field}>
                {BORDER_STYLES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Radius</label>
              <input type="number" min={0} max={40} step={1} value={s.border?.radius ?? ''} placeholder="0"
                onChange={(e) => onStyle({ border: { ...s.border, radius: e.target.value ? parseInt(e.target.value) : undefined } })} className={field} />
            </div>
          </div>
          <H3>Effects</H3>
          <div className="mb-2"><Opacity title="Opacity" value={s.opacity} onChange={(v) => onStyle({ opacity: v })} /></div>
          <div className="grid grid-cols-2 gap-2 items-end">
            <div>
              <label className={label}>Rotation°</label>
              <input type="number" min={-180} max={180} step={5} value={s.rotation ?? ''} placeholder="0"
                onChange={(e) => onStyle({ rotation: e.target.value ? parseInt(e.target.value) : undefined })} className={field} />
            </div>
            <button onClick={() => onStyle({ shadow: !s.shadow })} className={`${toggle} ${s.shadow ? on : off}`}>Shadow {s.shadow ? '✓' : ''}</button>
          </div>
        </>
      )}

      {/* ── Arrange: free placement (does NOT snap to margins) ── */}
      {caps.arrange && (
        <>
          <H3>Arrange</H3>
          <div className="grid grid-cols-2 gap-2 mb-2">
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <div key={k}>
                <label className={label}>{k.toUpperCase()} (in)</label>
                <input type="number" min={0} max={30} step={0.25} value={p[k] ?? ''} placeholder="auto"
                  onChange={(e) => onPosition({ [k]: e.target.value ? parseFloat(e.target.value) : undefined })} className={field} />
              </div>
            ))}
          </div>
          <div>
            <label className={label}>Text wrap</label>
            <select value={p.wrap ?? 'inline'} onChange={(e) => onPosition({ wrap: e.target.value as NonNullable<NodePosition['wrap']> })} className={field}>
              {WRAP_MODES.map((w) => <option key={w} value={w}>{w === 'inline' ? 'In line with text' : w === 'float' ? 'Float (wrap text)' : w === 'front' ? 'In front of text' : 'Behind text'}</option>)}
            </select>
          </div>
        </>
      )}

      {/* ── Element: the one type-specific control ── */}
      {caps.element === 'shape' && (
        <>
          <H3>Shape</H3>
          <div className="flex flex-wrap gap-1">
            {SHAPE_KINDS.map((k) => (
              <button key={k.value} title={k.label}
                onClick={() => onContent({ ...(c as ShapeContent), shape: k.value } as ShapeContent)}
                className={`h-8 w-8 text-sm border rounded ${(c as ShapeContent).shape === k.value ? on : off}`}>{k.glyph}</button>
            ))}
          </div>
          <label className={`${label} mt-2`}>Text in shape</label>
          <input value={(c as ShapeContent).text ?? ''} onChange={(e) => onContent({ ...(c as ShapeContent), text: e.target.value } as ShapeContent)} className={field} placeholder="(optional)" />
        </>
      )}
      {caps.element === 'callout' && (
        <>
          <H3>Callout</H3>
          <label className={label}>Variant</label>
          <select value={(c as CalloutContent).variant ?? 'info'} onChange={(e) => onContent({ ...(c as CalloutContent), variant: e.target.value as CalloutContent['variant'] } as CalloutContent)} className={field}>
            {CALLOUT_VARIANTS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <label className={`${label} mt-2`}>Title</label>
          <input value={(c as CalloutContent).title ?? ''} onChange={(e) => onContent({ ...(c as CalloutContent), title: e.target.value } as CalloutContent)} className={field} />
        </>
      )}
      {caps.element === 'chart' && (
        <>
          <H3>Chart</H3>
          <label className={label}>Type</label>
          <select value={(c as ChartContent).chart_type ?? 'bar'} onChange={(e) => onContent({ ...(c as ChartContent), chart_type: e.target.value as ChartContent['chart_type'] } as ChartContent)} className={field}>
            {CHART_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className={`${label} mt-2`}>Title</label>
          <input value={(c as ChartContent).title ?? ''} onChange={(e) => onContent({ ...(c as ChartContent), title: e.target.value } as ChartContent)} className={field} />
        </>
      )}
      {caps.element === 'divider' && (
        <>
          <H3>Divider</H3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label}>Style</label>
              <select value={(c as DividerContent).line_style ?? 'solid'} onChange={(e) => onContent({ ...(c as DividerContent), line_style: e.target.value as DividerContent['line_style'] } as DividerContent)} className={field}>
                {LINE_STYLES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Thickness</label>
              <input type="number" min={1} max={8} step={1} value={(c as DividerContent).thickness ?? ''} placeholder="1"
                onChange={(e) => onContent({ ...(c as DividerContent), thickness: e.target.value ? parseInt(e.target.value) : undefined } as DividerContent)} className={field} />
            </div>
          </div>
        </>
      )}
      {caps.element === 'code' && (
        <>
          <H3>Code</H3>
          <label className={label}>Language</label>
          <input value={(c as CodeBlockContent).language ?? ''} onChange={(e) => onContent({ ...(c as CodeBlockContent), language: e.target.value } as CodeBlockContent)} className={field} placeholder="e.g. python" />
        </>
      )}
      {caps.element === 'signature' && (
        <>
          <H3>Signature</H3>
          <label className={label}>Label</label>
          <input value={(c as SignatureContent).label ?? ''} onChange={(e) => onContent({ ...(c as SignatureContent), label: e.target.value } as SignatureContent)} className={field} placeholder="Authorized Representative" />
        </>
      )}
    </div>
  );
}
