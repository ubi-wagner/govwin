import { describe, it, expect } from 'vitest';
import { parseSlideTables } from '@/lib/import/pptx-reader';

/**
 * PPTX decks carry their data/cost tables in <p:graphicFrame><a:tbl>, NOT in the <p:sp> text
 * shapes the reader used to scan — so tables were dropped on ingest. parseSlideTables pulls
 * them out into headers + rows that become a real table node (and thus a reusable atom).
 */

const cell = (t: string) => `<a:tc><a:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody></a:tc>`;
const row = (...cells: string[]) => `<a:tr h="370840">${cells.map(cell).join('')}</a:tr>`;
const slideWithTable = `<p:sld><p:cSld><p:spTree>
  <p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
    <a:tbl>
      ${row('Cost Element', 'Amount')}
      ${row('Direct Labor', '$59,200')}
      ${row('Materials &amp; Supplies', '$12,400')}
    </a:tbl>
  </a:graphicData></a:graphic></p:graphicFrame>
</p:spTree></p:cSld></p:sld>`;

describe('parseSlideTables (pptx tables → table nodes)', () => {
  it('extracts a slide table into headers + rows, decoding XML entities', () => {
    const tables = parseSlideTables(slideWithTable);
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(['Cost Element', 'Amount']);
    expect(tables[0].rows).toEqual([
      ['Direct Labor', '$59,200'],
      ['Materials & Supplies', '$12,400'],
    ]);
  });

  it('returns [] when the slide has no table', () => {
    expect(parseSlideTables('<p:sld><p:sp><a:t>Just some body text</a:t></p:sp></p:sld>')).toEqual([]);
  });

  it('handles two tables on one slide', () => {
    expect(parseSlideTables(slideWithTable + slideWithTable)).toHaveLength(2);
  });
});
