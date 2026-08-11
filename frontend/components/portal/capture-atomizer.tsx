'use client';
/**
 * Capture → annotate → atomize (the "Capture" tab). Grab a frame from any window/tab/screen
 * with getDisplayMedia (browser-permission-gated), box it into regions, tag each region with
 * the same vocabulary as the Atomize tab, then commit — each region becomes a DRAFT image
 * atom in the library (anchored to a reference of the whole frame, optionally grouped into a
 * section). ONE-WAY: nothing but the crops you send ever leaves your screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// Type-only handles onto pdfjs (erased at compile). The RUNTIME is self-hosted from /public and
// loaded via a webpackIgnore native import (see loadPdfFile) — webpack's ESM interop chokes on
// pdfjs-dist's pdf.mjs ("Object.defineProperty called on non-object"), so we bypass the bundler.
type PdfjsModule = typeof import('pdfjs-dist');
type PdfDoc = Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>;

const CURATED: Record<string, string[]> = {
  vol: ['technical', 'cost', 'past_performance', 'key_personnel', 'management', 'commercialization'],
  kind: ['figure', 'table', 'bio', 'narrative', 'metric', 'diagram'],
  party_role: ['prime', 'partner', 'customer', 'competitor'],
  access: ['private', 'shared', 'admin_only'],
};
interface Box { id: string; x: number; y: number; w: number; h: number; title: string; tags: { dimension: string; value: string }[] }

export function CaptureAtomizer({ tenantSlug }: { tenantSlug: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // Offscreen full-res frame — the single source of the pixels, whatever put them there
  // (a screen grab OR an uploaded image OR a rendered PDF page). The visible overlay canvas
  // is only mounted once hasFrame, so drawing straight to it (as the old capture did) hit a
  // null ref; we draw here and blit to the overlay on mount.
  const frameRef = useRef<HTMLCanvasElement | null>(null);
  const getFrame = () => { if (!frameRef.current) frameRef.current = document.createElement('canvas'); return frameRef.current; };
  const [hasFrame, setHasFrame] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  // A loaded PDF stays resident so page nav re-renders another page into the frame without re-parsing.
  const pdfDocRef = useRef<PdfDoc | null>(null);
  const [pdfPages, setPdfPages] = useState(0);
  const [pdfPage, setPdfPage] = useState(1);
  // Bumped on every new frame drawn to the offscreen canvas. The blit effect keys off it so a new
  // frame with the SAME dimensions (e.g. PDF page 1→2, or recapturing at the same size) still re-blits.
  const [frameVersion, setFrameVersion] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [note, setNote] = useState('');
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ── Capture a frame from the screen/window/tab ─────────────────────────────
  const capture = useCallback(async () => {
    setErr(null); setMsg(null);
    try {
      const md = navigator.mediaDevices as MediaDevices | undefined;
      if (!md?.getDisplayMedia) { setErr('Screen capture is not available in this browser.'); return; }
      const stream = await md.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 250)); // let a frame paint
      const w = video.videoWidth || 1280, h = video.videoHeight || 720;
      const canvas = getFrame();
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);
      stream.getTracks().forEach((t) => t.stop()); // release immediately — one-way, no lingering access
      pdfDocRef.current = null; setPdfPages(0); setPdfPage(1);
      setDims({ w, h }); setBoxes([]); setHasFrame(true); setFrameVersion((v) => v + 1);
    } catch (e) {
      setErr(e instanceof Error && e.name === 'NotAllowedError' ? 'Capture cancelled.' : 'Could not capture the screen.');
    }
  }, []);

  // ── Load an uploaded IMAGE as the frame (the box-on-upload path) ────────────
  const loadImageFile = useCallback((file: File) => {
    setErr(null); setMsg(null);
    if (!file.type.startsWith('image/')) { setErr('Pick an image file (PNG, JPG, WebP).'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 1280, h = img.naturalHeight || 720;
      const canvas = getFrame();
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      pdfDocRef.current = null; setPdfPages(0); setPdfPage(1);
      setDims({ w, h }); setBoxes([]); setHasFrame(true); setFrameVersion((v) => v + 1);
    };
    img.onerror = () => { URL.revokeObjectURL(url); setErr('Could not read that image.'); };
    img.src = url;
  }, []);

  // ── Load an uploaded PDF, render one page as the frame (scanned tables / figure-heavy docs) ──
  const renderPdfPage = useCallback(async (doc: PdfDoc, n: number) => {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // Render crisp (~1600px wide, capped 2.5×) so boxed crops are legible, not blurry.
    const scale = Math.min(2.5, Math.max(1, 1600 / base.width));
    const viewport = page.getViewport({ scale });
    const canvas = getFrame();
    canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise; // white bg — PDFs are transparent
    setDims({ w: canvas.width, h: canvas.height }); setBoxes([]); setHasFrame(true); setFrameVersion((v) => v + 1);
  }, []);

  const loadPdfFile = useCallback(async (file: File) => {
    setErr(null); setMsg(null);
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setErr('Pick a PDF file.'); return; }
    setBusy(true);
    try {
      // Load pdfjs from /public via a NATIVE dynamic import (webpackIgnore) — the browser fetches
      // the ES module directly, bypassing webpack's ESM interop, which throws "Object.defineProperty
      // called on non-object" on pdfjs-dist's pdf.mjs. The /pdfjs build + worker are the same version.
      // Non-literal specifier so TS doesn't try to resolve the /public URL as a module path.
      const pdfjsUrl = '/pdfjs/pdf.min.mjs';
      const pdfjs = (await import(/* webpackIgnore: true */ pdfjsUrl)) as PdfjsModule;
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjs.getDocument({
        data,
        cMapUrl: '/pdfjs/cmaps/', cMapPacked: true,      // self-hosted — legible CJK/encoded text in crops
        standardFontDataUrl: '/pdfjs/standard_fonts/',   // self-hosted — legible non-embedded standard fonts
      }).promise;
      pdfDocRef.current = doc; setPdfPages(doc.numPages); setPdfPage(1);
      await renderPdfPage(doc, 1);
    } catch (e) {
      console.error('[capture] PDF render failed', e);
      setErr(`Could not read that PDF — ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally { setBusy(false); }
  }, [renderPdfPage]);

  // Navigate pages — each page is its own frame, so boxes reset (they are page-local coordinates).
  const goPdfPage = useCallback(async (n: number) => {
    const doc = pdfDocRef.current; if (!doc || busy) return;
    const clamped = Math.min(doc.numPages, Math.max(1, n));
    setBusy(true);
    try { setPdfPage(clamped); await renderPdfPage(doc, clamped); }
    catch { setErr('Could not render that page.'); }
    finally { setBusy(false); }
  }, [busy, renderPdfPage]);

  // Blit the offscreen frame onto the visible overlay canvas. Keyed on frameVersion (not just dims)
  // so a same-size new frame — PDF page 1→2, or recapturing at the same resolution — still repaints.
  useEffect(() => {
    const src = frameRef.current, dst = canvasRef.current;
    if (hasFrame && src && dst) { dst.width = dims.w; dst.height = dims.h; dst.getContext('2d')?.drawImage(src, 0, 0); }
  }, [hasFrame, frameVersion, dims.w, dims.h]);

  // ── BOX-2: let the machine draw the boxes ──────────────────────────────────
  // Ask the vision-gated proposer for regions and PRE-POPULATE them as boxes. Advisory: they're
  // ordinary editable boxes — the human adjusts/removes and confirms before Atomize writes anything.
  const suggest = useCallback(async () => {
    if (!hasFrame || busy) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/atoms/propose-regions`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ width: dims.w, height: dims.h }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Could not propose regions');
      const proposed: Array<{ x: number; y: number; w: number; h: number; title: string; kind: string }> = json.data?.regions ?? [];
      if (proposed.length === 0) { setMsg('No regions suggested for this frame.'); return; }
      const added: Box[] = proposed.map((r, i) => ({
        id: `box_ai_${i}_${Math.round(r.x)}_${Math.round(r.y)}`,
        x: r.x, y: r.y, w: r.w, h: r.h, title: r.title,
        tags: r.kind ? [{ dimension: 'kind', value: r.kind }] : [],
      }));
      setBoxes((b) => [...b.filter((x) => x.id !== '__draft'), ...added]);
      setActive(added[0]?.id ?? null);
      setMsg(`Suggested ${added.length} region(s) — review, adjust, then Atomize.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not propose regions');
    } finally { setBusy(false); }
  }, [hasFrame, busy, dims.w, dims.h, tenantSlug]);

  // ── Box drawing on the frozen frame ────────────────────────────────────────
  const toCanvasCoords = (e: React.MouseEvent) => {
    const el = overlayRef.current!; const r = el.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * dims.w, y: ((e.clientY - r.top) / r.height) * dims.h };
  };
  const onDown = (e: React.MouseEvent) => { if (!hasFrame) return; setDrag(toCanvasCoords(e)); };
  const onMove = (e: React.MouseEvent) => {
    if (!drag) return;
    const p = toCanvasCoords(e);
    setBoxes((b) => {
      const others = b.filter((x) => x.id !== '__draft');
      const x = Math.min(drag.x, p.x), y = Math.min(drag.y, p.y), w = Math.abs(p.x - drag.x), h = Math.abs(p.y - drag.y);
      return [...others, { id: '__draft', x, y, w, h, title: '', tags: [] }];
    });
  };
  const onUp = () => {
    setDrag(null);
    setBoxes((b) => b.map((x) => x.id === '__draft'
      ? (x.w > 12 && x.h > 12 ? { ...x, id: `box_${Math.round(x.x)}_${Math.round(x.y)}_${x.w | 0}` } : x)
      : x).filter((x) => x.id !== '__draft' || false));
    // promote the freshly-drawn draft (if big enough) and select it
    setBoxes((b) => { const last = b[b.length - 1]; if (last) setActive(last.id); return b; });
  };

  const patch = (id: string, up: Partial<Box>) => setBoxes((b) => b.map((x) => (x.id === id ? { ...x, ...up } : x)));
  const remove = (id: string) => setBoxes((b) => b.filter((x) => x.id !== id));
  const addTag = (id: string, dimension: string, value: string) => {
    if (!value.trim()) return;
    setBoxes((b) => b.map((x) => x.id === id
      ? (x.tags.some((t) => t.dimension === dimension && t.value === value) ? x : { ...x, tags: [...x.tags, { dimension, value: value.trim() }] })
      : x));
  };

  // ── Crop each box client-side → commit to /atoms/capture ───────────────────
  const cropBlob = (box: Box): Promise<Blob> => new Promise((resolve, reject) => {
    const src = getFrame(); // full-res offscreen frame, in the same coord space as the boxes
    const c = document.createElement('canvas'); c.width = Math.max(1, box.w | 0); c.height = Math.max(1, box.h | 0);
    c.getContext('2d')!.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
    c.toBlob((bl) => (bl ? resolve(bl) : reject(new Error('crop failed'))), 'image/png');
  });
  const fullBlob = (): Promise<Blob> => new Promise((resolve, reject) =>
    getFrame().toBlob((bl) => (bl ? resolve(bl) : reject(new Error('frame failed'))), 'image/png'));

  const commit = useCallback(async () => {
    const real = boxes.filter((b) => b.id !== '__draft' && b.w > 12 && b.h > 12);
    if (real.length === 0) { setErr('Draw at least one box on the capture first.'); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('full', await fullBlob(), 'frame.png');
      for (let i = 0; i < real.length; i++) fd.append(`region_${i}`, await cropBlob(real[i]), `region_${i}.png`);
      fd.append('regions', JSON.stringify(real.map((b) => ({ title: b.title, tags: b.tags }))));
      if (sourceUrl.trim()) fd.append('sourceUrl', sourceUrl.trim());
      if (note.trim()) fd.append('note', note.trim());
      if (groupName.trim()) fd.append('groupName', groupName.trim());
      const res = await fetch(`/api/portal/${tenantSlug}/atoms/capture`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Capture failed');
      setMsg(`Atomized ${json.data.atoms} region(s) into draft atoms${json.data.groupId ? ' + a section' : ''}. Review in Library.`);
      setBoxes([]); setHasFrame(false); setGroupName('');
      pdfDocRef.current = null; setPdfPages(0); setPdfPage(1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Capture failed');
    } finally { setBusy(false); }
  }, [boxes, sourceUrl, note, groupName, tenantSlug]);

  const realBoxes = boxes.filter((b) => b.id !== '__draft');

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        <b>Capture from your screen — or box an uploaded image or PDF page</b> (a slide exported as PNG, a
        figure, a scanned table — anything the parser can&apos;t pull from a file&apos;s XML). Grab a
        window/tab/screen, drop an image, or open a PDF and page to the figure, box the parts worth
        keeping, tag them, and each becomes a draft library atom.
        <b> One-way:</b> only the crops you send leave your screen — no account link, no lingering access.
      </div>

      {!hasFrame ? (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={capture} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            ▣ Capture from screen
          </button>
          <label className="rounded-md border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 cursor-pointer">
            ▣ Box an uploaded image
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) loadImageFile(f); e.currentTarget.value = ''; }} />
          </label>
          <label className={`rounded-md border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 ${busy ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
            {busy ? 'Rendering…' : '▣ Box a PDF page'}
            <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) loadPdfFile(f); e.currentTarget.value = ''; }} />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
          {/* ── the frozen frame + box overlay ── */}
          <div>
            <div ref={overlayRef} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
              className="relative w-full cursor-crosshair overflow-hidden rounded-lg border border-slate-300 bg-slate-100 select-none"
              style={{ aspectRatio: `${dims.w} / ${dims.h}` }}>
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
              {boxes.map((b) => (
                <div key={b.id} onClick={(e) => { e.stopPropagation(); setActive(b.id); }}
                  className={`absolute border-2 ${active === b.id ? 'border-amber-500 bg-amber-400/20' : 'border-blue-500 bg-blue-400/10'}`}
                  style={{ left: `${(b.x / dims.w) * 100}%`, top: `${(b.y / dims.h) * 100}%`, width: `${(b.w / dims.w) * 100}%`, height: `${(b.h / dims.h) * 100}%` }} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>Drag to box a region · {realBoxes.length} region(s)</span>
              <button onClick={suggest} disabled={busy}
                className="rounded bg-violet-600 px-2 py-0.5 font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                title="Let the machine propose figure/table regions to confirm">
                {busy ? 'Suggesting…' : '✨ Suggest regions'}
              </button>
              {pdfPages > 1 && (
                <span className="flex items-center gap-1.5">
                  <button onClick={() => goPdfPage(pdfPage - 1)} disabled={busy || pdfPage <= 1}
                    className="rounded border border-slate-300 px-1.5 leading-5 hover:bg-slate-100 disabled:opacity-40">‹</button>
                  <span className="tabular-nums">page {pdfPage} / {pdfPages}</span>
                  <button onClick={() => goPdfPage(pdfPage + 1)} disabled={busy || pdfPage >= pdfPages}
                    className="rounded border border-slate-300 px-1.5 leading-5 hover:bg-slate-100 disabled:opacity-40">›</button>
                </span>
              )}
              <button onClick={capture} className="text-blue-600 hover:underline">Recapture</button>
              <button onClick={() => { setHasFrame(false); setBoxes([]); pdfDocRef.current = null; setPdfPages(0); setPdfPage(1); }} className="text-slate-500 hover:underline">Discard</button>
            </div>
          </div>

          {/* ── annotate + tag + commit ── */}
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Provenance (the “FROM”)</div>
              <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Source URL (e.g. the Google Doc link)"
                className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (what is this?)"
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
            </div>

            <div className="space-y-2">
              {realBoxes.length === 0 && <div className="text-sm text-slate-400">Box a region on the capture to tag it.</div>}
              {realBoxes.map((b, i) => (
                <div key={b.id} onClick={() => setActive(b.id)}
                  className={`rounded-lg border p-2 ${active === b.id ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-slate-700 px-1.5 text-xs font-bold text-white">{i + 1}</span>
                    <input value={b.title} onChange={(e) => patch(b.id, { title: e.target.value })} placeholder={`Region ${i + 1} title`}
                      className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
                    <button onClick={() => remove(b.id)} className="text-xs text-rose-500 hover:underline">remove</button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {b.tags.map((t, ti) => (
                      <span key={ti} className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">{t.dimension}:{t.value}
                        <button onClick={() => patch(b.id, { tags: b.tags.filter((_, x) => x !== ti) })} className="ml-1 text-blue-400">×</button>
                      </span>
                    ))}
                  </div>
                  {active === b.id && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {Object.entries(CURATED).map(([dim, vals]) => (
                        <select key={dim} defaultValue="" onChange={(e) => { addTag(b.id, dim, e.target.value); e.currentTarget.value = ''; }}
                          className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-600">
                          <option value="">+ {dim}</option>
                          {vals.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Section name (optional — group the regions)"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
            <button onClick={commit} disabled={busy || realBoxes.length === 0}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? 'Atomizing…' : `Atomize ${realBoxes.length} region(s) → library`}
            </button>
          </div>
        </div>
      )}

      {msg && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div>}
      {err && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
    </div>
  );
}
