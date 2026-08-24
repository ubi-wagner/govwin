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
  TextBoxContent, BlockquoteContent, EquationContent, VideoContent,
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

/**
 * The two ends of the stack, either side of the default 5 that canvas-renderer and canvas-html
 * both use when `z` is absent. Kept well clear of it so repeated "bring to front" on different
 * nodes does not collide, and so an untouched node keeps landing between them.
 */
const Z_TOP = 900;
const Z_BOTTOM = 1;

const label = 'text-[10px] text-gray-400 block mb-1';
const field = 'w-full text-xs border rounded px-1.5 py-1';
const H3 = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-4">{children}</h3>
);

/** A 0..1 opacity slider with a % readout. */
function Opacity({ value, onChange, title, control }: { value?: number; onChange: (v: number | undefined) => void; title: string; control: string }) {
  const pct = Math.round((value ?? 1) * 100);
  return (
    <div>
      <label className={label}>{title} <span className="text-gray-400 tabular-nums">{pct}%</span></label>
      <input data-control={control} type="range" min={0} max={100} step={5} value={pct}
        onChange={(e) => { const v = parseInt(e.target.value) / 100; onChange(v >= 1 ? undefined : v); }}
        className="w-full h-1.5 accent-blue-600" />
    </div>
  );
}

/** Compact editor for a chart's data — categories + one row per series (name + comma-
 *  separated numbers), with add/remove. Keeps ChartContent.categories/series in sync so a
 *  chart node is no longer insert-and-freeze (it exports as a native chart with real data). */
function ChartDataEditor({ chart, onContent }: { chart: ChartContent; onContent: (c: CanvasNode['content']) => void }) {
  const cats = chart.categories ?? [];
  const series = chart.series ?? [];
  const set = (patch: Partial<ChartContent>) => onContent({ ...chart, ...patch } as ChartContent);
  const nums = (s: string) => s.split(',').map((x) => parseFloat(x.trim())).map((n) => (Number.isFinite(n) ? n : 0));
  return (
    <div className="mt-2">
      <label className="text-[10px] text-gray-400 block mb-1">Categories (comma-separated)</label>
      <input
        value={cats.join(', ')}
        onChange={(e) => set({ categories: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
        className="w-full text-xs border rounded px-1.5 py-1" placeholder="Q1, Q2, Q3" />
      <label className="text-[10px] text-gray-400 block mb-1 mt-2">Series</label>
      <div className="space-y-1">
        {series.map((s, i) => (
          <div key={i} className="flex items-center gap-1">
            <input value={s.name ?? ''} onChange={(e) => { const ns = [...series]; ns[i] = { ...s, name: e.target.value }; set({ series: ns }); }}
              className="text-xs border rounded px-1.5 py-1 w-20 shrink-0" placeholder="Name" />
            <input value={(s.data ?? []).join(', ')} onChange={(e) => { const ns = [...series]; ns[i] = { ...s, data: nums(e.target.value) }; set({ series: ns }); }}
              className="text-xs border rounded px-1.5 py-1 flex-1" placeholder="3, 7, 5" />
            <button onClick={() => set({ series: series.filter((_, j) => j !== i) })} className="text-rose-500 text-xs px-1" title="Remove series">×</button>
          </div>
        ))}
      </div>
      <button onClick={() => set({ series: [...series, { name: `Series ${series.length + 1}`, data: cats.map(() => 0) }] })}
        className="mt-1 text-[11px] text-blue-600 hover:underline">+ Add series</button>
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
            <button data-control="underline" onClick={() => onStyle({ underline: !s.underline })} className={`${toggle} underline ${s.underline ? on : off}`} title="Underline">U</button>
            <button data-control="strikethrough" onClick={() => onStyle({ strikethrough: !s.strikethrough })} className={`${toggle} line-through ${s.strikethrough ? on : off}`} title="Strikethrough">S</button>
            <label className="ml-1 flex items-center gap-1 text-[10px] text-gray-500" title="Highlight">
              <span aria-hidden>🖍</span>
              <input data-control="highlight" type="color" value={s.highlight || '#FFFF00'} onChange={(e) => onStyle({ highlight: e.target.value })} className="h-6 w-6 rounded border cursor-pointer p-0" />
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
                <input data-control="fill" type="color" value={s.fill?.color || '#DCE6F1'} onChange={(e) => onStyle({ fill: { ...s.fill, color: e.target.value } })} className="h-6 w-6 rounded border cursor-pointer p-0" />
                {s.fill?.color && <button onClick={() => onStyle({ fill: undefined })} className="text-[10px] text-rose-500 hover:underline">none</button>}
              </div>
            </div>
            <div>
              <label className={label}>Border</label>
              <div className="flex items-center gap-1">
                <input data-control="border" type="color" value={s.border?.color || '#334155'} onChange={(e) => onStyle({ border: { ...s.border, color: e.target.value } })} className="h-6 w-6 rounded border cursor-pointer p-0" />
                {s.border && <button onClick={() => onStyle({ border: undefined })} className="text-[10px] text-rose-500 hover:underline">none</button>}
              </div>
            </div>
          </div>
          {s.fill && <div className="mb-2"><Opacity control="fill-opacity" title="Fill opacity" value={s.fill.opacity} onChange={(v) => onStyle({ fill: { ...s.fill, opacity: v } })} /></div>}
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
          <div className="mb-2"><Opacity control="opacity" title="Opacity" value={s.opacity} onChange={(v) => onStyle({ opacity: v })} /></div>
          <div className="grid grid-cols-2 gap-2 items-end">
            <div>
              <label className={label}>Rotation°</label>
              <input data-control="rotation" type="number" min={-180} max={180} step={5} value={s.rotation ?? ''} placeholder="0"
                onChange={(e) => onStyle({ rotation: e.target.value ? parseInt(e.target.value) : undefined })} className={field} />
            </div>
            <button data-control="shadow" onClick={() => onStyle({ shadow: !s.shadow })} className={`${toggle} ${s.shadow ? on : off}`}>Shadow {s.shadow ? '✓' : ''}</button>
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
                <input data-control={`pos-${k}`} type="number" min={0} max={30} step={0.25} value={p[k] ?? ''} placeholder="auto"
                  onChange={(e) => onPosition({ [k]: e.target.value ? parseFloat(e.target.value) : undefined })} className={field} />
              </div>
            ))}
          </div>
          <div>
            <label className={label}>Text wrap</label>
            <select data-control="wrap" value={p.wrap ?? 'inline'} onChange={(e) => onPosition({ wrap: e.target.value as NonNullable<NodePosition['wrap']> })} className={field}>
              {WRAP_MODES.map((w) => <option key={w} value={w}>{w === 'inline' ? 'In line with text' : w === 'float' ? 'Float (wrap text)' : w === 'front' ? 'In front of text' : 'Behind text'}</option>)}
            </select>
          </div>

          {/* ── LAYERING ──────────────────────────────────────────────────────────────────────
              `position.z` has always existed in the model and has always been honoured by the
              editor and the HTML/PDF path — with no way for a person to set it. The only way to
              change stacking was to reorder the document, which is the wrong lever: on a dense
              slide the order things are READ in and the order they are DRAWN in are different
              intentions.

              Named the way the two applications people arrive from name them, because this is
              precisely where a familiar verb is worth more than an accurate one: "bring to front"
              rather than "increase z-index".

              Z_TOP/Z_BOTTOM sit either side of the default 5 used by canvas-renderer and
              canvas-html, so a node that has never been touched keeps landing in the middle. */}
          <label className={label}>Layer</label>
          <div className="flex flex-wrap items-center gap-1">
            <button
              data-control="layer-front"
              onClick={() => onPosition({ z: Z_TOP, wrap: p.wrap === 'behind' ? 'front' : p.wrap })}
              disabled={readOnly}
              className={`${toggle} ${off}`}
              title="Bring to front"
            >⬆ Front</button>
            <button
              data-control="layer-back"
              onClick={() => onPosition({ z: Z_BOTTOM })}
              disabled={readOnly}
              className={`${toggle} ${off}`}
              title="Send to back"
            >⬇ Back</button>
            <button
              data-control="layer-behind"
              onClick={() => onPosition({ wrap: 'behind', z: Z_BOTTOM })}
              disabled={readOnly}
              className={`${toggle} ${p.wrap === 'behind' ? on : off}`}
              title="Send behind text"
            >Behind text</button>
            {(p.z !== undefined || p.wrap === 'behind') && (
              <button
                data-control="layer-reset"
                onClick={() => onPosition({ z: undefined, wrap: p.wrap === 'behind' ? 'inline' : p.wrap })}
                disabled={readOnly}
                className="text-[10px] text-rose-500 hover:underline ml-1"
              >reset</button>
            )}
            <span className="ml-1 text-[10px] text-gray-400 tabular-nums">
              {p.wrap === 'behind' ? 'behind' : `z ${p.z ?? 5}`}
            </span>
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
          <label className={`${label} mt-2`}>Text</label>
          <textarea value={(c as CalloutContent).text ?? ''} onChange={(e) => onContent({ ...(c as CalloutContent), text: e.target.value } as CalloutContent)} className={`${field} min-h-[60px]`} placeholder="Callout body" />
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
          <ChartDataEditor chart={c as ChartContent} onContent={onContent} />
        </>
      )}
      {caps.element === 'textbox' && (
        <>
          <H3>Text box</H3>
          <label className={label}>Text</label>
          <textarea value={(c as TextBoxContent).text ?? ''} onChange={(e) => onContent({ ...(c as TextBoxContent), text: e.target.value } as TextBoxContent)} className={`${field} min-h-[70px]`} placeholder="Box text" />
        </>
      )}
      {caps.element === 'blockquote' && (
        <>
          <H3>Quote</H3>
          <label className={label}>Text</label>
          <textarea value={(c as BlockquoteContent).text ?? ''} onChange={(e) => onContent({ ...(c as BlockquoteContent), text: e.target.value } as BlockquoteContent)} className={`${field} min-h-[60px]`} placeholder="Quoted text" />
          <label className={`${label} mt-2`}>Citation</label>
          <input value={(c as BlockquoteContent).cite ?? ''} onChange={(e) => onContent({ ...(c as BlockquoteContent), cite: e.target.value } as BlockquoteContent)} className={field} placeholder="— Source" />
        </>
      )}
      {caps.element === 'equation' && (
        <>
          <H3>Equation</H3>
          <label className={label}>LaTeX</label>
          <textarea value={(c as EquationContent).latex ?? ''} onChange={(e) => onContent({ ...(c as EquationContent), latex: e.target.value } as EquationContent)} className={`${field} min-h-[50px] font-mono`} placeholder="E = mc^2" />
          <label className="mt-2 flex items-center gap-2 text-[10px] text-gray-500">
            <input type="checkbox" checked={(c as EquationContent).display ?? true} onChange={(e) => onContent({ ...(c as EquationContent), display: e.target.checked } as EquationContent)} />
            Display (block) mode
          </label>
        </>
      )}
      {caps.element === 'video' && (
        <>
          <H3>Video</H3>
          <label className={label}>URL</label>
          <input value={(c as VideoContent).url ?? ''} onChange={(e) => onContent({ ...(c as VideoContent), url: e.target.value } as VideoContent)} className={field} placeholder="https://…" />
          <label className={`${label} mt-2`}>Caption</label>
          <input value={(c as VideoContent).caption ?? ''} onChange={(e) => onContent({ ...(c as VideoContent), caption: e.target.value } as VideoContent)} className={field} />
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
          <label className={`${label} mt-2`}>Code</label>
          <textarea value={(c as CodeBlockContent).code ?? ''} onChange={(e) => onContent({ ...(c as CodeBlockContent), code: e.target.value } as CodeBlockContent)} className={`${field} min-h-[80px] font-mono`} placeholder="// code" spellCheck={false} />
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
