/**
 * THE EXTRACTOR'S JOB IS PRECISION, AND THIS TESTS FOR THE NOISE.
 *
 * A permissive document extractor is worse than none: every link it wrongly keeps gets fetched,
 * hashed, stored and offered to a curator as a document belonging to this opportunity. So the
 * cases below are weighted towards what must NOT come back — the privacy policy, the Acrobat
 * download, the mailto — because those are what turn a harvest queue into something nobody reads.
 *
 * The page fragments are shaped like real agency pages: attribute order varies, labels carry
 * nested markup and entities, and several links carry no extension at all.
 */
import { describe, it, expect } from 'vitest';
import { extractDocumentLinks, documentFilename } from '@/lib/harvest/extract-links';

const PAGE = 'https://www.example.gov/opportunities/AF251-D001';

describe('extractDocumentLinks — what counts as a document', () => {
  it('keeps a link whose extension says it is a document', () => {
    const html = `<a href="/files/AF251-D001-topics.pdf">Topics</a>`;
    const out = extractDocumentLinks(html, PAGE);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://www.example.gov/files/AF251-D001-topics.pdf');
    expect(out[0].reason).toBe('extension');
  });

  it('keeps an extensionless link when the LABEL says it is the solicitation', () => {
    const html = `<a class="btn" href="/download?id=99&amp;v=2">Download the full solicitation</a>`;
    const out = extractDocumentLinks(html, PAGE);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('link-text');
  });

  // ── the noise, which is the point ──────────────────────────────────────────────────────────
  it('drops site chrome — the privacy policy is not an attachment', () => {
    const html = `
      <a href="/privacy">Privacy Policy</a>
      <a href="/accessibility">Accessibility</a>
      <a href="/foia">FOIA</a>
      <a href="https://www.usa.gov/">USA.gov</a>
      <a href="/contact">Contact us</a>`;
    expect(extractDocumentLinks(html, PAGE)).toEqual([]);
  });

  it('drops a plain "Download" link, because "Download Acrobat Reader" is one', () => {
    const html = `<a href="https://get.adobe.com/reader/">Download</a>`;
    expect(extractDocumentLinks(html, PAGE)).toEqual([]);
  });

  it('drops mailto, javascript and data URLs outright', () => {
    const html = `
      <a href="mailto:sbir@example.gov">Email the solicitation manager</a>
      <a href="javascript:void(0)">Open the attachment</a>
      <a href="data:text/plain;base64,aGk=">amendment</a>`;
    expect(extractDocumentLinks(html, PAGE)).toEqual([]);
  });

  it('KEEPS a real document that happens to live under a chrome path', () => {
    // The chrome rule must not outrank the extension: `/help/attachment-A.pdf` is a document.
    const html = `<a href="/help/attachment-A.pdf">Attachment A</a>`;
    const out = extractDocumentLinks(html, PAGE);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('extension');
  });

  it('de-duplicates by URL and preserves page order', () => {
    const html = `
      <a href="/a.pdf">First</a>
      <a href="/b.docx">Second</a>
      <a href="/a.pdf">First again, lower down</a>`;
    const out = extractDocumentLinks(html, PAGE);
    expect(out.map((l) => l.url)).toEqual([
      'https://www.example.gov/a.pdf',
      'https://www.example.gov/b.docx',
    ]);
  });

  it('survives the markup real pages actually have', () => {
    const html = `
      <a  target='_blank'   href='/files/Amendment%201.pdf'  rel="noopener">
        <span class="icon"></span> Amendment&nbsp;1 &amp; errata
      </a>`;
    const out = extractDocumentLinks(html, PAGE);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Amendment 1 & errata');
  });

  /**
   * ── THE REGRESSION (found by drive-document-harvest on its first run) ──────────────────────
   * `&amp;` is the CORRECT encoding for `&` in an attribute, so this markup is ordinary rather
   * than exotic — and the extractor was handing the fetcher a query string with a parameter
   * literally named `amp;rev`. Every such link would have 404'd or fetched the wrong document,
   * and the failure would have looked like the agency's rather than ours.
   */
  it('decodes entity escapes in the HREF, not just in the label', () => {
    const html = `<a href="/download?doc=qa&amp;rev=3">Full solicitation</a>`;
    const out = extractDocumentLinks(html, PAGE);
    expect(out[0].url).toBe('https://www.example.gov/download?doc=qa&rev=3');
    expect(out[0].url).not.toContain('amp;');
  });

  it('resolves relative, root-relative and absolute hrefs against the page', () => {
    const html = `
      <a href="attach.pdf">rel</a>
      <a href="/root.pdf">root</a>
      <a href="https://other.example.gov/x.pdf">absolute</a>`;
    expect(extractDocumentLinks(html, PAGE).map((l) => l.url)).toEqual([
      'https://www.example.gov/opportunities/attach.pdf',
      'https://www.example.gov/root.pdf',
      'https://other.example.gov/x.pdf',
    ]);
  });
});

describe('documentFilename — what the server called it', () => {
  it('prefers Content-Disposition over the URL', () => {
    expect(documentFilename({
      contentDisposition: 'attachment; filename="AF251-D001 Topics.pdf"',
      url: 'https://www.example.gov/download?id=99',
    })).toBe('AF251-D001 Topics.pdf');
  });

  it('reads the RFC 5987 form', () => {
    expect(documentFilename({
      contentDisposition: "attachment; filename*=UTF-8''Amendment%201.pdf",
      url: 'https://www.example.gov/d',
    })).toBe('Amendment 1.pdf');
  });

  it('falls back to the URL, then to the link text, then to a constant', () => {
    expect(documentFilename({ url: 'https://www.example.gov/files/sow.docx' })).toBe('sow.docx');
    expect(documentFilename({ url: 'https://www.example.gov/', linkText: 'Statement of Work' }))
      .toBe('Statement of Work');
    expect(documentFilename({ url: 'https://www.example.gov/' })).toBe('document');
  });

  /**
   * The one that matters: this name reaches object storage. A server is free to answer anything.
   */
  it('returns a NAME and never a path, however the server answers', () => {
    expect(documentFilename({
      contentDisposition: 'attachment; filename="../../etc/passwd"',
      url: 'https://www.example.gov/d',
    })).toBe('etcpasswd');

    expect(documentFilename({
      contentDisposition: 'attachment; filename="/absolute/evil.pdf"',
      url: 'https://www.example.gov/d',
    })).toBe('absoluteevil.pdf');

    const nul = documentFilename({
      contentDisposition: 'attachment; filename="bad\u0000name.pdf"',
      url: 'https://www.example.gov/d',
    });
    expect(nul).toBe('badname.pdf');
    expect(nul).not.toContain('\u0000');
  });
});
