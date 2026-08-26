/**
 * LaTeX → HTML for the subset that appears in engineering proposals.
 *
 * WHY THIS EXISTS. The `equation` node emitted its source string escaped into the page, so a
 * technical volume printed
 *     f_{28} = \bar{f} + \sum_{k=1}^{K} q_k (\mathbf{x} - \bar{\mathbf{x}})^{\top} \mathbf{w}_k
 * where the formula should be. Found by rendering a real volume to page images and looking at it;
 * the ruler, the export gate and the node-vocabulary probe all passed it. A proposal that prints
 * markup where the maths goes is not one you can submit, which makes this the one rendering defect
 * in the set that actually blocks a bid.
 *
 * The markup carried a `data-latex` attribute, so the original intent was clearly a client-side
 * typesetter. Nothing ever consumed it, and nothing could: the PDF is written by a headless
 * Chromium with no such library loaded.
 *
 * WHY NOT KATEX. It is the right answer for arbitrary maths and it is a real dependency decision —
 * a bundle to load inside the PDF renderer, a CSP question, and a font payload. That decision is
 * worth making deliberately rather than as a side effect of fixing a proposal. This covers what
 * proposals actually contain — subscripts, superscripts, fractions, sums with limits, Greek,
 * accents, bold vectors, comparison and unit operators — with no dependency at all, and is
 * structured so swapping in a real typesetter later replaces one function.
 *
 * THE RULE THAT MATTERS: an expression this cannot render FAITHFULLY is returned as source, marked
 * as unconverted. A renderer that silently produces plausible-looking maths saying something
 * different from what the author wrote is far worse than one that shows the source and admits it —
 * in a document where a number is a commitment, a wrong formula is a wrong promise.
 */

/** Single-token LaTeX commands that map cleanly onto a Unicode character. */
const SYMBOLS: Record<string, string> = {
  // Greek — lower
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  // Greek — upper
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
  Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // Relations and operators
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', propto: '∝',
  infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', in: '∈', notin: '∉',
  subset: '⊂', supset: '⊃', cup: '∪', cap: '∩', emptyset: '∅',
  rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒', leftrightarrow: '↔',
  top: '⊤', bot: '⊥', ldots: '…', cdots: '⋯', prime: '′', deg: '°',
  // Big operators — rendered inline; limits are attached as sub/sup by the parser
  sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮',
};

/** Commands that take one braced argument and wrap it. */
const WRAPPERS: Record<string, (inner: string) => string> = {
  mathbf: (x) => `<b>${x}</b>`,
  mathrm: (x) => `<span style="font-style:normal">${x}</span>`,
  text: (x) => `<span style="font-style:normal">${x}</span>`,
  mathit: (x) => `<i>${x}</i>`,
  bar: (x) => `<span style="border-top:1px solid currentColor;padding:0 1px">${x}</span>`,
  overline: (x) => `<span style="border-top:1px solid currentColor;padding:0 1px">${x}</span>`,
  hat: (x) => `<span style="position:relative">${x}<span style="position:absolute;left:0;right:0;top:-0.75em;text-align:center;font-size:0.8em">^</span></span>`,
  vec: (x) => `<span style="position:relative">${x}<span style="position:absolute;left:0;right:0;top:-0.7em;text-align:center;font-size:0.7em">→</span></span>`,
  sqrt: (x) => `<span>√<span style="border-top:1px solid currentColor;padding:0 2px">${x}</span></span>`,
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Read a `{...}` group starting at `i` (which must point at the `{`). Returns the body and the index after `}`. */
function readGroup(src: string, i: number): { body: string; next: number } | null {
  if (src[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return { body: src.slice(i + 1, j), next: j + 1 };
    }
  }
  return null;                                   // unbalanced — the caller gives up honestly
}

/** One argument: a braced group, a single command, or a single character. */
function readArg(src: string, i: number): { body: string; next: number } | null {
  while (src[i] === ' ') i++;
  if (i >= src.length) return null;
  if (src[i] === '{') return readGroup(src, i);
  if (src[i] === '\\') {
    const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
    if (m) return { body: m[0], next: i + m[0].length };
  }
  return { body: src[i], next: i + 1 };
}

export interface LatexRender {
  html: string;
  /** False when anything in the source could not be rendered faithfully. */
  complete: boolean;
}

/**
 * Convert a LaTeX expression to inline HTML.
 *
 * Returns `complete: false` the moment it meets something it does not understand, and the caller
 * is expected to fall back to showing the source. It does NOT guess.
 */
export function latexToHtml(src: string): LatexRender {
  let out = '';
  let complete = true;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
      if (!m) {
        // An escaped literal like \{ or \, — the common spacing ones are dropped, the rest bail.
        const next = src[i + 1];
        if (next === ',' || next === ';' || next === '!' || next === ' ') { out += ' '; i += 2; continue; }
        if (next === '{' || next === '}' || next === '%' || next === '$' || next === '_') {
          out += esc(next); i += 2; continue;
        }
        complete = false; i++; continue;
      }
      const name = m[1];
      i += m[0].length;

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const num = readArg(src, i); if (!num) { complete = false; break; }
        const den = readArg(src, num.next); if (!den) { complete = false; break; }
        const n = latexToHtml(num.body); const d = latexToHtml(den.body);
        complete = complete && n.complete && d.complete;
        out += '<span style="display:inline-block;vertical-align:middle;text-align:center">'
          + `<span style="display:block;border-bottom:1px solid currentColor;padding:0 3px">${n.html}</span>`
          + `<span style="display:block;padding:0 3px">${d.html}</span></span>`;
        i = den.next; continue;
      }
      if (WRAPPERS[name]) {
        const arg = readArg(src, i); if (!arg) { complete = false; break; }
        const inner = latexToHtml(arg.body);
        complete = complete && inner.complete;
        out += WRAPPERS[name](inner.html);
        i = arg.next; continue;
      }
      if (SYMBOLS[name]) { out += SYMBOLS[name]; continue; }
      if (name === 'left' || name === 'right') continue;      // sizing hints; the glyph follows
      complete = false;                                        // an unknown command — do not guess
      continue;
    }

    if (ch === '_' || ch === '^') {
      const arg = readArg(src, i + 1);
      if (!arg) { complete = false; i++; continue; }
      const inner = latexToHtml(arg.body);
      complete = complete && inner.complete;
      out += ch === '_' ? `<sub>${inner.html}</sub>` : `<sup>${inner.html}</sup>`;
      i = arg.next; continue;
    }

    if (ch === '{' ) { const g = readGroup(src, i); if (!g) { complete = false; break; }
      const inner = latexToHtml(g.body); complete = complete && inner.complete;
      out += inner.html; i = g.next; continue; }
    if (ch === '}') { complete = false; i++; continue; }

    out += esc(ch);
    i++;
  }

  return { html: out, complete };
}
