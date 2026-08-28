/**
 * Where the model lives is answered in ONE file.
 *
 * ── THE DEFECT THIS EXISTS FOR ───────────────────────────────────────────────────────────────
 * Six places in the frontend call Claude. Four use `@anthropic-ai/sdk`, which reads
 * `ANTHROPIC_BASE_URL` from the environment by itself; two used a raw `fetch` and had to do it
 * themselves. Only one of the two did. `lib/tools/source-scout.ts` wrote the host as a literal,
 * so the HITL source scout reached past the emulator to the real API — with a placeholder key,
 * failing alone, while every other AI-gated flow in the product ran end to end under `EMULATE=1`.
 *
 * That is not a style question. `EMULATE=1` exists so an AI flow is drivable with no live key
 * (docs/AI_FLOWS_PROOF.md), and a call site that ignores it opts out of the one mechanism that
 * makes the whole class testable.
 *
 * ── WHY A TEXT ASSERTION AND NOT A BEHAVIOURAL ONE ───────────────────────────────────────────
 * A behavioural test would have to make a request, and a test that reaches the network is a test
 * that fails for reasons unrelated to the thing it guards. The property worth holding is
 * structural and can be read off the tree: the literal host appears in `lib/ai/endpoint.ts` and
 * nowhere else, so there is exactly one place that can be wrong.
 *
 * The SDK call sites pass this without changing, because they never name the host at all — which
 * is the point: they were never the ones at risk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { anthropicKey, anthropicMessagesUrl } from '@/lib/ai/endpoint';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SEAM = 'lib/ai/endpoint.ts';
const HOST = /api\.anthropic\.com/;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue;
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e)) out.push(path.relative(ROOT, p));
    }
  };
  for (const d of ['lib', 'app']) walk(path.join(ROOT, d));
  return out;
}

describe('the Anthropic endpoint has one source of truth', () => {
  it('names the host in lib/ai/endpoint.ts and nowhere else under lib/ or app/', () => {
    const offenders = sourceFiles().filter((f) => {
      if (f === SEAM) return false;
      const text = readFileSync(path.join(ROOT, f), 'utf8');
      // Comments are stripped first. `lib/vision.ts` mentions the host in prose explaining that
      // it is in NO_PROXY, and a documentation sentence is not a second endpoint — this repo
      // writes its reasoning at the site, so a text search that reads prose as code finds the
      // most "defects" exactly where the most care was taken.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');
      return HOST.test(code);
    });
    expect(offenders).toEqual([]);
  });

  it('the seam itself resolves ANTHROPIC_BASE_URL, so EMULATE=1 reaches every raw-fetch caller', () => {
    const before = process.env.ANTHROPIC_BASE_URL;
    try {
      process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:8787/';
      // A STATICALLY imported module, deliberately: reading the variable at CALL time is the
      // property being tested. A seam that captured it at import would pass a test that
      // re-imported per case and still be immune to the switch in a long-lived server process.
      expect(anthropicMessagesUrl()).toBe('http://127.0.0.1:8787/v1/messages');
      delete process.env.ANTHROPIC_BASE_URL;
      expect(anthropicMessagesUrl()).toBe('https://api.anthropic.com/v1/messages');
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = before;
    }
  });

  it('treats the sandbox placeholder key as no key, as every call site already assumed', () => {
    const before = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.ANTHROPIC_API_KEY = 'sk-noop';
      expect(anthropicKey()).toBeNull();
      process.env.ANTHROPIC_API_KEY = 'sk-ant-real';
      expect(anthropicKey()).toBe('sk-ant-real');
      delete process.env.ANTHROPIC_API_KEY;
      expect(anthropicKey()).toBeNull();
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = before;
    }
  });
});
