import { describe, it, expect } from 'vitest';
import { splitMarkdownSections } from '@/lib/library/markdown-sections';

// The markdown splitter is the one pure piece of the house-library dogfood; the
// full createAtom→listAtoms path is proven against the DB. Lock the parser here.
describe('splitMarkdownSections', () => {
  it('splits by #/##/### headings, one section each', () => {
    const md = '# Title\nintro line\n\n## A\nbody a\n\n### B\nbody b';
    const s = splitMarkdownSections(md, 'Doc');
    expect(s.map((x) => x.title)).toEqual(['Title', 'A', 'B']);
    expect(s[1].body).toBe('body a');
    expect(s[2].body).toBe('body b');
  });

  it('folds text before the first heading into a doc-titled intro', () => {
    const s = splitMarkdownSections('preamble text\nmore\n\n## First\nx', 'My Doc');
    expect(s[0].title).toBe('My Doc');
    expect(s[0].body).toBe('preamble text\nmore');
    expect(s[1].title).toBe('First');
  });

  it('strips markdown chars from headings and caps length', () => {
    const [s] = splitMarkdownSections('## **Bold** `code` heading', 'D');
    expect(s.title).toBe('Bold code heading');
  });

  it('drops empty sections and trims bodies', () => {
    const s = splitMarkdownSections('## Only heading\n\n\n## Next\n  body  \n', 'D');
    expect(s.map((x) => x.title)).toEqual(['Only heading', 'Next']);
    expect(s[0].body).toBe('');
    expect(s[1].body).toBe('body');
  });

  it('handles a doc with no headings as a single intro section', () => {
    const s = splitMarkdownSections('just some prose\nacross lines', 'Fallback');
    expect(s).toHaveLength(1);
    expect(s[0].title).toBe('Fallback');
    expect(s[0].body).toBe('just some prose\nacross lines');
  });
});
