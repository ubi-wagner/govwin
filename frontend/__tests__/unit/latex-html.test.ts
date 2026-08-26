/**
 * LaTeX → HTML, and the rule that matters more than coverage: never guess.
 *
 * The defect this fixes printed `\sum_{k=1}^{K}` into a technical volume where the formula
 * belonged. The obvious failure mode of the fix is worse than the defect: a converter that quietly
 * drops a command it does not understand renders a formula that LOOKS right and says something
 * different. In a proposal a number is a commitment, so a wrong formula is a wrong promise.
 *
 * Hence `complete`. Every test below that feeds it something unsupported asserts it comes back
 * false, so the caller falls back to showing the source.
 */
import { describe, it, expect } from 'vitest';
import { latexToHtml } from '@/lib/export/latex-html';

describe('renders the constructs proposals actually contain', () => {
  it('subscripts and superscripts', () => {
    const r = latexToHtml('f_{28}^{2}');
    expect(r.complete).toBe(true);
    expect(r.html).toBe('f<sub>28</sub><sup>2</sup>');
  });

  it('a single-character argument needs no braces', () => {
    expect(latexToHtml('x_i').html).toBe('x<sub>i</sub>');
  });

  it('Greek letters and relations become the characters, not the commands', () => {
    const r = latexToHtml('\\sigma \\leq \\mu \\times 2');
    expect(r.complete).toBe(true);
    expect(r.html).toContain('σ');
    expect(r.html).toContain('≤');
    expect(r.html).toContain('×');
    expect(r.html).not.toContain('\\');
  });

  it('a sum with limits — the exact construct that shipped as source', () => {
    const r = latexToHtml('\\sum_{k=1}^{K} q_k');
    expect(r.complete).toBe(true);
    expect(r.html).toContain('∑');
    expect(r.html).toContain('<sub>k=1</sub>');
    expect(r.html).toContain('<sup>K</sup>');
  });

  it('fractions render as a stacked numerator over a denominator', () => {
    const r = latexToHtml('\\frac{a+1}{b}');
    expect(r.complete).toBe(true);
    expect(r.html).toContain('border-bottom');
    expect(r.html).toContain('a+1');
    expect(r.html).toContain('b');
  });

  it('bold vectors and bars nest correctly', () => {
    const r = latexToHtml('\\bar{\\mathbf{x}}');
    expect(r.complete).toBe(true);
    expect(r.html).toContain('<b>x</b>');
    expect(r.html).toContain('border-top');
  });

  it('the whole expression from the volume', () => {
    const r = latexToHtml('f_{28} = \\bar{f} + \\sum_{k=1}^{K} q_k (\\mathbf{x} - \\bar{\\mathbf{x}})^{\\top} \\mathbf{w}_k');
    expect(r.complete).toBe(true);
    expect(r.html).not.toContain('\\');
    expect(r.html).toContain('∑');
    expect(r.html).toContain('⊤');
  });

  it('escapes HTML so an expression cannot inject markup', () => {
    const r = latexToHtml('a < b > c & d');
    expect(r.html).toContain('&lt;');
    expect(r.html).toContain('&gt;');
    expect(r.html).toContain('&amp;');
  });
});

describe('REFUSES rather than guesses — the property that makes it safe to ship', () => {
  it('an unknown command marks the render incomplete', () => {
    const r = latexToHtml('\\begin{matrix} a \\end{matrix}');
    expect(r.complete).toBe(false);
  });

  it('an unbalanced brace marks it incomplete rather than truncating silently', () => {
    expect(latexToHtml('\\frac{a}{b').complete).toBe(false);
  });

  it('a stray closing brace is incomplete', () => {
    expect(latexToHtml('a}b').complete).toBe(false);
  });

  it('an integral with an unsupported differential still reports what it could not do', () => {
    // \int is known; \mathrm{d} is known; \notacommand is not — one unknown is enough.
    expect(latexToHtml('\\int_0^1 \\notacommand{x}').complete).toBe(false);
  });

  it('incompleteness propagates OUT of a nested group — the subtle case', () => {
    // If this returned true, a bad subexpression would render as confident, wrong maths inside an
    // otherwise fine formula, which is the exact failure this flag exists to prevent.
    const r = latexToHtml('\\frac{\\unknownthing}{b}');
    expect(r.complete).toBe(false);
  });
});
