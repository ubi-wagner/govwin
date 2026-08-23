#!/usr/bin/env node
/**
 * Emulated Claude — an Anthropic Messages API (`POST /v1/messages`) compatible endpoint that lets ME
 * (Claude, this session) stand in as the model the agents + AI routes call, so the AI-gated paths run
 * END-TO-END in the sandbox with no live key. Prod (Railway) has the real ANTHROPIC_API_KEY and runs the
 * IDENTICAL wiring with live drafting; this closes the sandbox's only real AI gap (the wiring / tool-loop /
 * guardrail / landing / human-review UX), which is exactly what a live key can't be used to prove here.
 *
 * Zero product-code change: both services read ANTHROPIC_BASE_URL (frontend parse-solicitation.ts:64;
 * the @anthropic-ai/sdk + python AsyncAnthropic honor it). Most call sites gate on ANTHROPIC_API_KEY
 * PRESENCE (only parse-solicitation.ts + vision.ts treat 'sk-noop' as OFF); the 'emulated-claude' value
 * below passes every gate.
 * Point them here (ANTHROPIC_BASE_URL=http://127.0.0.1:8787, ANTHROPIC_API_KEY=emulated-claude) and every
 * real invoke path lands on this server. Non-streaming only (all callers use messages.create).
 *
 * Deterministic (reproducible tests) + every request/response is appended to <LOG> for the "both sides"
 * review the user asked for. Responses come from a RESPONDERS registry keyed off the tools/system in the
 * request; a generic fallback covers anything not yet special-cased.
 *
 *   node emulated-claude.mjs           # PORT=8787 LOG=./emulated-claude.log.jsonl
 */
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const PORT = Number(process.env.PORT || 8787);
const LOG = process.env.LOG || new URL('./emulated-claude.log.jsonl', import.meta.url).pathname;

let seq = 0;
const nowIso = () => new Date().toISOString();
const log = (rec) => { try { appendFileSync(LOG, JSON.stringify(rec) + '\n'); } catch { /* non-fatal */ } };

// ── Response helpers (valid Anthropic Messages shapes) ──────────────────────────────────────────────
const textMsg = (model, text, stop = 'end_turn') => ({
  id: `msg_emu_${++seq}`, type: 'message', role: 'assistant', model,
  content: [{ type: 'text', text }], stop_reason: stop, stop_sequence: null,
  usage: { input_tokens: 64, output_tokens: Math.max(1, Math.ceil(text.length / 4)) },
});
const toolUseMsg = (model, name, input) => ({
  id: `msg_emu_${++seq}`, type: 'message', role: 'assistant', model,
  content: [{ type: 'tool_use', id: `toolu_emu_${seq}`, name, input }],
  stop_reason: 'tool_use', stop_sequence: null,
  usage: { input_tokens: 96, output_tokens: 48 },
});

// Did the client already hand us a tool_result? (⇒ we're in the 2nd+ turn of a tool loop → finish.)
const hasToolResult = (req) =>
  (req.messages || []).some((m) => Array.isArray(m.content) && m.content.some((b) => b?.type === 'tool_result'));
const toolNames = (req) => (req.tools || []).map((t) => t.name);
const systemText = (req) => (typeof req.system === 'string' ? req.system : (req.system || []).map((s) => s.text || '').join('\n'));
const lastUserText = (req) => {
  const u = [...(req.messages || [])].reverse().find((m) => m.role === 'user');
  if (!u) return '';
  return typeof u.content === 'string' ? u.content : (u.content || []).map((b) => b.text || '').join('\n');
};

// The full request text (system + every message) — where the workflow's real inputs (proposal_id,
// tenant_id, section_id …) live, so tool calls can pass REAL uuids instead of fabricated strings.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function reqText(req) {
  const parts = [systemText(req)];
  for (const m of req.messages || []) {
    if (typeof m.content === 'string') parts.push(m.content);
    else for (const b of m.content || []) parts.push(b.text || (b.content && JSON.stringify(b.content)) || (b.input && JSON.stringify(b.input)) || '');
  }
  return parts.join('\n');
}
// A uuid labelled with this param name anywhere in the request (e.g. `"proposal_id": "bbd6…"`).
function findLabeledUuid(text, name) {
  const m = text.match(new RegExp(name.replace(/[^a-z_]/gi, '') + '["\\s:=)}\\]]{0,8}("?)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'i'));
  return m ? m[2] : null;
}
// Fill a tool's required params from its input_schema. Id-like params get a REAL uuid pulled from the
// request context; other strings get representative content. Specific agents can still be hand-crafted.
function genericToolInput(tool, req) {
  const text = reqText(req);
  const anyUuid = (text.match(UUID_RE) || [])[0] || null;
  const schema = tool?.input_schema || {};
  const props = schema.properties || {};
  const required = new Set(schema.required || Object.keys(props));
  const out = {};
  for (const [k, spec] of Object.entries(props)) {
    if (!required.has(k)) continue;
    const t = spec?.type;
    if (t === 'string') {
      if (/(_id$|^id$|_uuid$)/i.test(k)) out[k] = findLabeledUuid(text, k) || anyUuid || `emu-${k}`;
      else out[k] = spec.enum?.[0] ?? `Emulated ${k} — representative content authored by the emulated model.`;
    } else if (t === 'number' || t === 'integer') out[k] = spec.minimum ?? 1;
    else if (t === 'boolean') out[k] = true;
    else if (t === 'array') out[k] = [];
    else if (t === 'object') out[k] = {};
  }
  return out;
}

const between = (s, tag) => { const m = (s || '').match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`)); return m ? m[1] : ''; };

/**
 * The section's own title, whichever way the caller phrased the ask.
 *
 * Two live shapes, and reading only one of them silently ruined every draft the harness produced:
 *
 *   1. `Draft the "Phase I Technical Objectives" section.`   — the FRONTEND tool's prompt
 *   2. `Draft the proposal section named between the markers below…`  — the PIPELINE archetype,
 *      after its prompt-injection hardening moved the (tenant-editable, untrusted) title inside
 *      a `--- BEGIN USER CONTENT ---` fence.
 *
 * The regex only matched form 1. Against form 2 it fell through to the literal default, so every
 * section of the volume searched the tenant's library for the word "Section", every search
 * returned the same six atoms, and every section of the drafted Technical Volume opened with the
 * same paragraph. The output looked like a retrieval failure and was a title-parsing failure —
 * worth a named helper so the next prompt change breaks loudly instead of quietly.
 */
function sectionTitleFrom(all) {
  const quoted = all.match(/Draft the "([^"]{2,120})" section/i)?.[1];
  if (quoted) return quoted.replace(/\s+/g, ' ').trim();

  const fenced = all.match(
    /section named between the markers below[\s\S]{0,400}?--- BEGIN USER CONTENT ---\s*([\s\S]*?)\s*--- END USER CONTENT ---/i,
  )?.[1];
  const t = (fenced ?? '').replace(/\s+/g, ' ').trim();
  return t && t.length <= 200 ? t : 'Section';
}


// ── Grounded composition helpers ───────────────────────────────────────────────────────────────
//
// The drafter responder below does NOT invent prose. It composes the section from the material the
// PRODUCT put in the prompt — the tenant's own library atoms, the compliance requirements traced to
// this section, the required subsections and the word budget. That keeps the harness honest in both
// directions: when the library is rich the draft is specific, and when it is thin the draft is thin,
// which is a true signal about the product's retrieval rather than a flattering one about the model.
// With a live ANTHROPIC_API_KEY the identical wiring calls Claude instead and this never runs.

const STOP = new Set(('the a an and or of to in for with on at by from is are be as that this it its will shall must may can any all each such other than then them they we our us your you into over under between within without across per via using use used based approach section volume proposal offeror government'
).split(' '));

/** Content words of a string, lowercased, stop-words removed. */
function terms(text) {
  return (text || '').toLowerCase().match(/[a-z][a-z0-9™®+-]{2,}/g)?.filter((w) => !STOP.has(w)) ?? [];
}

/** Split prose into sentences worth reusing (drops headers, page furniture, fragments). */
function sentences(text) {
  return (text || '')
    .replace(/\r/g, ' ')
    .replace(/-{2,}\s*\d+\s+of\s+\d+\s*-{2,}/gi, ' ')   // "-- 3 of 41 --" page marks
    // "p11 · " — the atomizer's page-of-origin prefix. It is provenance, not prose, and it printed
    // on the rendered page ("p11 · Significance of Problem and Opportunity 5 Topic: X23.5"),
    // which reads as an unproofed copy-paste rather than a written proposal.
    .replace(/(^|\s)p\d{1,3}\s*[·•]\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 60 && x.length <= 420)
    .filter((x) => /[a-z]/.test(x) && (x.match(/[A-Za-z]/g)?.length ?? 0) / x.length > 0.6)
    .filter((x) => !/^(page|proposal number|topic number|sbc:|disclaimer|form generated)/i.test(x))
    // Cover-sheet and certification boilerplate. The tenant's library holds whole prior proposals
    // atomized as single documents rather than clean reusable atoms, so a retrieval for a technical
    // section legitimately returns a full proposal — whose opening text is the firm's address, UEI,
    // DUNS, CAGE and SBA certifications. A writer skips that; so does this. (The underlying fix is
    // library GRAIN — atomizing those documents into sections — not a filter here.)
    .filter((x) => !/\b(UEI|DUNS|CAGE|SBA SBC|13 C\.?F\.?R|OFFEROR CERTIFIES|Firm Certificate|Number of employees|www\.[a-z]|Mail Address|Website Address)\b/i.test(x))
    .filter((x) => !/^\s*\d+\.\s/.test(x) || x.length > 140)
    // A sentence carrying ANOTHER solicitation's identifiers. The library holds the company's past
    // proposals, so retrieval legitimately returns text whose header line names the topic and
    // proposal number it was written for — and copying that into the new volume puts a different
    // agency's topic number on this submission. The compliance floor has a `foreign_solicitation`
    // code for exactly this failure; a writer simply would not reuse the sentence.
    .filter((x) => !/\b(?:Topic\s*(?:Number|#)|Proposal\s*(?:Number|#))\s*:?\s*[A-Z0-9]/i.test(x));
}

/** Parse the <library_atoms> block the product builds into { id, category, tags, text } records. */
function parseAtoms(user) {
  const block = between(user, 'library_atoms');
  if (!block) return [];
  const out = [];
  const re = /\[Atom ([^\]|]+)\|\s*category:\s*([^\]|]*?)(?:\|\s*tags:\s*([^\]]*))?\]/g;
  let m; const marks = [];
  while ((m = re.exec(block))) marks.push({ i: m.index, len: m[0].length, id: m[1].trim(), category: (m[2] || '').trim(), tags: (m[3] || '').trim() });
  for (let k = 0; k < marks.length; k++) {
    const start = marks[k].i + marks[k].len;
    const end = k + 1 < marks.length ? marks[k + 1].i : block.length;
    out.push({ ...marks[k], text: block.slice(start, end).trim() });
  }
  return out;
}

/**
 * Rank candidate sentences by overlap with the section's own vocabulary; keep the best, deduped.
 *
 * `floor` is the minimum score to keep. The default 0.4 is a RELEVANCE gate — useful when you want
 * only the strongly on-topic material — but it is brutal in aggregate: a perfectly good 13-word
 * sentence that happens not to repeat the section title scores ~0.33 and is discarded. With a real
 * library that threw away most of what retrieval returned, which is why drafted sections came in
 * at a few hundred characters against a multi-page allowance. Pass floor 0 when you need LENGTH:
 * the sort still puts the most relevant first, you simply stop throwing away the tail.
 */
function rankSentences(pool, focusTerms, limit, floor = 0.4) {
  const focus = new Set(focusTerms);
  const seen = new Set();
  return pool
    .map((s) => {
      const t = terms(s);
      const hits = t.filter((w) => focus.has(w)).length;
      // Prefer sentences carrying concrete evidence — numbers, units, proper nouns.
      const concrete = (s.match(/\b\d[\d,.]*\s*(?:%|W|kW|nm|km|m\b|pages?|days?|months?|\$)/gi)?.length ?? 0)
        + (s.match(/\b[A-Z][A-Za-z]*(?:™|®)/g)?.length ?? 0);
      return { s, score: hits * 2 + concrete * 3 + Math.min(t.length, 40) / 40 };
    })
    .filter((x) => x.score > floor)
    .sort((a, b) => b.score - a.score)
    .filter((x) => {
      const key = x.s.slice(0, 70).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((x) => x.s);
}


/**
 * Pull the human-readable prose out of a tool result, rather than treating its JSON as text.
 *
 * A tool returns structure — {"results":[{"id":…,"title":…,"content":"…"}]} — and stringifying it
 * makes the ranker treat `{"matched": false, "skeleton": []…` as a candidate sentence, which is how
 * a section's opening paragraph became a wall of JSON. Walk the parsed object and keep only string
 * values that read like prose; ignore ids, flags and short labels.
 */
function harvestProse(raw) {
  let v = raw;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try { v = JSON.parse(t); } catch { return [t]; }
    } else {
      return [t];
    }
  }
  const out = [];
  const walk = (node, depth) => {
    if (depth > 6 || node == null) return;
    if (typeof node === 'string') {
      if (node.length >= 60 && /\s/.test(node) && !/^[0-9a-f-]{30,}$/i.test(node)) out.push(node);
      return;
    }
    if (Array.isArray(node)) { node.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof node === 'object') {
      for (const [k, x] of Object.entries(node)) {
        if (/^(id|_id|uuid|type|status|note|matched)$/i.test(k)) continue;
        walk(x, depth + 1);
      }
    }
  };
  walk(v, 0);
  return out;
}


// ─── Canvas primitive exerciser ──────────────────────────────────────────────
//
// WHY THIS EXISTS. The canvas vocabulary is 22 node types (lib/types/canvas-document.ts).
// This emulator used to emit THREE — heading, text_block, bulleted_list — and the shipped
// atom library holds five. So every "AI flows proven end-to-end" run exercised the narrowest
// possible slice of the canvas: the layout, export and compliance machinery for images,
// figures, charts, callouts, page breaks and dividers had never once been driven THROUGH an
// AI flow. A draft that is only prose cannot prove the paginator, the docx/pptx/xlsx writers,
// the image inliner, or `validateCanvasAgainstSpec`'s image and per-section budgets.
//
// So the emulated drafter now emits a realistic MIX. Two rules make it a test instrument
// rather than a random generator:
//
//   1. DETERMINISTIC. Variation comes from a hash of the whole prompt indexed into a fixed
//      schedule — never a random draw. A harness whose output changes run to run cannot be used
//      to decide anything, and the four lenses would report drift that is the instrument rather
//      than the product.
//   2. BUDGET-HONEST. Every primitive is charged against the same word budget as prose, so a
//      figure-heavy section still respects the solicitation's page limit. A drafter that
//      busts the limit to look rich is the exact failure the budget exists to prevent.
//
// Set EMU_PRIMITIVES=lean to fall back to the old prose-only shape (for a regression compare).
const PRIMITIVES_MODE = process.env.EMU_PRIMITIVES || 'rich';

/** Stable 32-bit hash → deterministic per-title variation. */
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * An image node pointing at a REAL library storage key when one was supplied, else a
 * deterministic placeholder key. The point is to drive the image path — inliner, export,
 * compliance image budget — not to invent binary content.
 */
function imageNode(key, alt, n) {
  return {
    type: 'image',
    content: { storage_key: key, alt_text: alt, width: 480, height: 300, caption: `Figure ${n}. ${alt}` },
  };
}
const captionNode = (prefix, n, text) => ({ type: 'caption', content: { prefix, number: n, text } });

/** A small evidence table built from the section's own vocabulary — never fabricated numbers. */
function tableNode(title, rows) {
  return {
    type: 'table',
    content: {
      headers: ['Requirement', 'Where addressed', 'Status'],
      rows: rows.map((r, i) => [r, `${title} ¶${i + 1}`, 'Addressed']),
      border_style: 'single',
    },
  };
}

/** A schedule chart. Gantt exercises the two-series shape the writers special-case. */
function chartNode(title, labels) {
  return {
    type: 'chart',
    content: {
      chart_type: 'gantt',
      title: `${title} — schedule`,
      categories: labels,
      series: [
        { name: 'start', data: labels.map((_, i) => i * 2) },
        { name: 'end', data: labels.map((_, i) => i * 2 + 3) },
      ],
    },
  };
}

const calloutNode = (variant, title, text) => ({ type: 'callout', content: { variant, title, text } });
const quoteNode = (text, cite) => ({ type: 'blockquote', content: { text, cite } });
const dividerNode = () => ({ type: 'divider', content: { thickness: 1, line_style: 'solid' } });
const numberedNode = (items) => ({ type: 'numbered_list', content: { items: items.map((t) => ({ text: t })) } });

/**
 * Which extra primitives THIS section gets — a deterministic rotation, not a hash of one field.
 *
 * The first version keyed off the section TITLE alone and read its bits as flags. Two things were
 * wrong with that, and the second is the one that matters:
 *   · `sectionTitleFrom` legitimately falls back to the literal 'Section' when the product's
 *     prompt shape does not carry a parseable title. Every such section then hashed identically,
 *     so the whole corpus got ONE plan.
 *   · Worse, whichever plan that was became the ONLY plan ever exercised — and the bits of
 *     hash32('Section') happen to clear both `figure` and `table`, so images and tables never
 *     appeared at all. A canvas exerciser that silently stops emitting images is worse than no
 *     exerciser, because it reports eight node types and looks like coverage.
 *
 * So: hash the WHOLE prompt (title + subsections + criteria + the atom text), which varies per
 * real section even when the title does not, and index a fixed SCHEDULE rather than reading bits.
 * The schedule is written so that every primitive appears in it, and the assertion below is the
 * guarantee: walking the whole schedule exercises all six. Coverage is a property of the table,
 * not a hope about hash distribution.
 */
const PRIMITIVE_SCHEDULE = [
  { figure: true,  table: true,  chart: false, callout: true,  quote: false, numbered: false },
  { figure: true,  table: false, chart: true,  callout: false, quote: true,  numbered: true  },
  { figure: false, table: true,  chart: true,  callout: true,  quote: false, numbered: true  },
  { figure: true,  table: true,  chart: true,  callout: true,  quote: true,  numbered: true  },
  { figure: false, table: false, chart: false, callout: true,  quote: true,  numbered: false },
  { figure: true,  table: false, chart: false, callout: false, quote: false, numbered: true  },
];
const LEAN_PLAN = { figure: false, table: false, chart: false, callout: false, quote: false, numbered: false };

function primitivePlanFor(key) {
  if (PRIMITIVES_MODE === 'lean') return LEAN_PLAN;
  return PRIMITIVE_SCHEDULE[hash32(String(key)) % PRIMITIVE_SCHEDULE.length];
}

const wordsIn = (s) => (s.match(/\S+/g) || []).length;

// ── RESPONDER REGISTRY — expand per-agent as flows are wired. First match wins. ─────────────────────
// ── Structured output ────────────────────────────────────────────────────────

/** Did the caller ask for JSON? Matches the phrasing the real prompts use. */
function wantsJson(req) {
  const sys = typeof req.system === 'string' ? req.system : JSON.stringify(req.system ?? '');
  return /respond only with valid json|respond with (?:a single )?json|valid json matching the schema|no markdown fences/i.test(sys);
}

/**
 * Build a response shaped like the schema the prompt declares.
 *
 * Reads the first {...} block out of the system prompt and emits one synthetic element per
 * array-valued key, using the same field names. Shape comes from the PROMPT rather than a
 * per-caller hardcode, so a new JSON-returning prompt is emulated without editing this file.
 *
 * Placeholder values say plainly that they are emulated. A fixture that looks like a real extracted
 * page limit is worse than no fixture — it could be mistaken for something read from a solicitation
 * (docs/INGEST_PROVENANCE.md).
 */
const SLUG_FIELD = /^(key|slug)$|_(key|slug)$/i;

/**
 * The controlled vocabulary a prompt enumerates for itself, if it does.
 *
 * The shredder's section_extraction prompt writes:
 *
 *   Canonical section keys (use EXACTLY these strings, no others):
 *   - cover                   — front matter, ...
 *   - technical_approach      — technical volume requirements, ...
 *
 * Harvesting the list from the prompt keeps the emulator honest for free: change the canonical
 * keys and the harness follows, with nothing here to update.
 */
function enumeratedSlugs(sys) {
  const list = sys.match(/canonical[^\n]*\b(?:keys?|values?|slugs?)\b[^\n]*:\s*\n((?:[ \t]*[-*][ \t]*[a-z0-9][a-z0-9_-]*[^\n]*\n?)+)/i);
  if (!list) return [];
  return [...list[1].matchAll(/^[ \t]*[-*][ \t]*([a-z0-9][a-z0-9_-]*)/gm)].map((m) => m[1]);
}

function emulatedJsonFor(req) {
  const sys = typeof req.system === 'string' ? req.system : '';
  const block = sys.match(/\{[\s\S]{40,2000}\}/);
  if (!block) return { emulated: true, note: 'no schema block found in the system prompt' };

  // A key is STRUCTURE, not content — it gets routed on, matched against, and (in the shredder)
  // used to build an object-storage path. Filling it with the prose placeholder below meant the
  // shredder's artifact write raised `invalid section slug` for every section, runner.py swallowed
  // it as a warning, and the harness silently exercised none of the per-section artifact path
  // while reporting the run a success. Emitting a real slug does not soften the honesty rule in
  // the docstring above: every prose field still says EMULATED, so nothing here can be mistaken
  // for a value read from a solicitation.
  const canonical = enumeratedSlugs(sys);
  const out = {};
  for (const m of block[0].matchAll(/"(\w+)"\s*:\s*\[/g)) {
    const key = m[1];
    const objMatch = block[0].match(new RegExp('"' + key + '"\\s*:\\s*\\[\\s*\\{([\\s\\S]*?)\\}'));
    const fields = objMatch ? [...objMatch[1].matchAll(/"(\w+)"\s*:/g)].map((f) => f[1]) : [];
    if (!fields.length) { out[key] = []; continue; }

    // With a vocabulary in hand, emit one row per value (capped) so a consumer that LOOPS over the
    // rows is actually made to loop. One row cannot tell a working iteration from a broken one.
    const slugs = fields.some((f) => SLUG_FIELD.test(f)) && canonical.length ? canonical.slice(0, 3) : [null];
    out[key] = slugs.map((slug, i) => {
      const row = {};
      for (const f of fields) {
        if (SLUG_FIELD.test(f)) row[f] = slug ?? `emulated_${f.toLowerCase()}`;
        else if (/confidence/i.test(f)) row[f] = 0.5;
        else if (/page|count|number|index/i.test(f)) row[f] = i + 1;
        else row[f] = `EMULATED ${f} — sandbox harness, not a real extraction`;
      }
      return row;
    });
  }
  return Object.keys(out).length ? out : { emulated: true, note: 'schema block had no array fields' };
}

const RESPONDERS = [
  // compliance_reviewer (frontend ai/compliance route) — expects a JSON ARRAY, one entry per compliance
  // variable, text-block-is-the-json (no fences). Since I'm Claude, I return a faithful assessment with
  // real excerpts drawn from the section, a deterministic mix of pass/partial to exercise the UI.
  {
    name: 'compliance_reviewer',
    match: (req) => /compliance reviewer/i.test(systemText(req)),
    respond: (req) => {
      const user = lastUserText(req);
      let vars = [];
      try { vars = JSON.parse(between(user, 'compliance_variables') || '[]'); } catch { vars = []; }
      if (!Array.isArray(vars)) vars = [];
      const section = between(user, 'section_text').replace(/\s+/g, ' ').trim();
      const excerpt = (section.slice(0, 180) || 'Section addresses the stated requirement.').slice(0, 200);
      const arr = vars.map((v, i) => {
        const id = v?.id ?? v?.variable_id ?? v?.variableId ?? String(i);
        const status = (i % 5 === 4) ? 'partial' : 'pass';
        const out = { variable_id: id, status, excerpt };
        if (status !== 'pass') out.suggestion = 'Expand this section to address the requirement explicitly with a measurable commitment.';
        return out;
      });
      return textMsg(req.model, JSON.stringify(arr)); // the route JSON.parses the text block directly
    },
  },
  // color_team_reviewer (pipeline, via the advance/ai-review agent_task_queue) — an ADVERSARIAL
  // review returned as prose in the structure the archetype asks for. It runs a tool loop first
  // (get_eval_criteria, get_compliance_matrix), so the responder answers the tool call once and
  // then writes the review.
  //
  // The findings are DERIVED FROM THE SECTION, not invented: the disqualifier audit is a real scan
  // for the things the archetype names — bracketed template residue, unnamed key personnel,
  // boilerplate with no specific number or name — because those are exactly what a page drafted
  // from a thin library actually contains. A review that always said "looks good" would make the
  // loop prove nothing about the build.
  {
    name: 'color_team_reviewer',
    match: (req) => /color team review/i.test(systemText(req)),
    respond: (req) => {
      // Walk the archetype's own tools once before writing, in the order its prompt names them
      // ("First, use get_eval_criteria and get_compliance_matrix…"). Same pattern as the pipeline
      // drafter: count the tool_result blocks already in the conversation to know where we are.
      const tools = req.tools || [];
      const answered = (req.messages || [])
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .filter((b) => b?.type === 'tool_result').length;
      if (answered < tools.length) {
        const order = ['get_eval_criteria', 'get_compliance_matrix'];
        const ranked = [...tools].sort((a, b) => {
          const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        const next = ranked[answered];
        if (next) return toolUseMsg(req.model, next.name, genericToolInput(next, req));
      }

      // `between` reads XML-ish <tag> pairs; the archetype fences the section with the canonical
      // "--- BEGIN/END USER CONTENT ---" markers instead, so extract those directly. Falling back
      // to the whole request was quoting the SYSTEM PROMPT back as the section's opening line.
      const text = reqText(req);
      const fenced = text.match(/---\s*BEGIN USER CONTENT\s*---([\s\S]*?)---\s*END USER CONTENT\s*---/);
      const section = (fenced ? fenced[1] : '').trim();
      // The archetype writes the title on its own line as `Section: <title>` (color_team_reviewer
      // build_messages). Read that first; the quoted forms are fallbacks for other callers.
      const title = (text.match(/^\s*Section:\s*(.+)$/mi)?.[1]
        ?? text.match(/Review the "([^"]{2,120})" section/i)?.[1]
        ?? 'this section').replace(/\s+/g, ' ').trim().slice(0, 90);
      // No fenced section means the request is not a section review — say so rather than reviewing
      // the prompt.
      if (!section) return textMsg(req.model, 'No section content was provided to review.');

      // (A) placeholder / template residue
      const placeholders = [...new Set(
        (section.match(/\[[^\]\n]{2,60}\]|\{[^}\n]{2,60}\}|\bTBD\b|\bTODO\b/gi) || []).map((m) => m.trim()),
      )].slice(0, 6);
      // (B) unnamed key personnel — a role word with no capitalised name anywhere near it
      const ROLE = /\b(Principal Investigator|Senior Engineer|Research Scientist|Program Manager|Co-Investigator)\b/g;
      const roleHits = section.match(ROLE) || [];
      // Look for a PERSON name with the role titles removed first — "Senior Engineer" and
      // "Research Scientist" both match a naive two-capitalised-words pattern, so leaving them in
      // made every unnamed-personnel section look properly staffed.
      const named = /\b[A-Z][a-z]+\s+(?:[A-Z]\.\s+)?[A-Z][a-z]+\b/.test(section.replace(ROLE, ''));
      const unnamed = roleHits.length > 0 && !named ? [...new Set(roleHits)].slice(0, 4) : [];
      // (C) specificity — a section with no number, no proper noun, is boilerplate
      const hasNumbers = /\d/.test(section);
      const proper = (section.match(/\b[A-Z]{2,}\b|\b[A-Z][a-z]+[A-Z]\w*/g) || []).length;

      const disq = [];
      if (placeholders.length) disq.push(`A. PLACEHOLDER — template residue still present: ${placeholders.map((p) => `"${p}"`).join(', ')}.`);
      else disq.push('A. PLACEHOLDER — none found.');
      if (unnamed.length) disq.push(`B. UNNAMED KEY PERSONNEL — ${unnamed.join(', ')} referenced by role with no named individual.`);
      else disq.push('B. UNNAMED KEY PERSONNEL — none found.');
      if (!hasNumbers || proper < 2) disq.push('C. FORMAT/SPECIFICITY — the text carries no quantified claim or named entity; it would read as boilerplate to an evaluator.');
      else disq.push('C. FORMAT/SPECIFICITY — none found.');

      const capped = placeholders.length || unnamed.length || !hasNumbers || proper < 2;
      const score = capped ? 'Marginal' : (section.length > 2500 ? 'Good' : 'Acceptable');
      const compliance = capped ? 'partially compliant' : 'compliant';

      const words = section.split(/\s+/).filter(Boolean).length;
      const firstSentence = (section.split(/(?<=[.!?])\s/)[0] || '').slice(0, 160);

      return textMsg(req.model, [
        `0. DISQUALIFIER AUDIT`,
        ...disq.map((d) => `   ${d}`),
        ``,
        `1. Overall Score: ${score}`,
        `2. Compliance Status: ${compliance} — the section is present and addresses its heading; ${words} words against the allotted budget.`,
        `3. Strengths`,
        `   • Opens on the requirement rather than on the company: "${firstSentence}"`,
        hasNumbers ? `   • Carries quantified claims an evaluator can check.` : `   • (No quantified claim to cite.)`,
        `4. Weaknesses`,
        capped
          ? `   • The disqualifier hits above must be cleared before this section is scored; each one is something an evaluator reads as an unfinished proposal.`
          : `   • Tighten the transition into the evaluation criteria; the argument is present but the evaluator has to assemble it.`,
        `   • ${title}: state the benefit to the government in the first two sentences, not the mechanism.`,
        `5. Risks`,
        capped ? `   • Placeholder or unnamed-personnel content is a scoring cap, and in a strict review a rejection without evaluation.`
               : `   • Low: no disqualifying content detected in this section.`,
        `6. Priority Recommendations`,
        capped ? `   1. Replace every bracketed placeholder and name every key person.` : `   1. Lead each subsection with the government benefit.`,
        `   2. Add one measurable commitment per claim.`,
      ].join('\n'));
    },
  },
  // visual page review (lib/review/visual-review.ts). The request carries PAGE IMAGES and asks what
  // is visibly wrong with them.
  //
  // This stand-in CANNOT SEE. So it returns an empty finding array — the same answer a real
  // reviewer gives for a clean page — rather than inventing defects, and the surrounding wiring
  // (render → capture → request → parse → report) is exercised end to end, which is what the
  // harness exists to prove. The page-COUNT half of that review is not gated on the model and is
  // fully live here: it measures the rendered document.
  //
  // Saying so out loud matters. A harness that fabricates plausible findings would make the visual
  // review look like it works in the sandbox and hide that the only real reviewer is the keyed one.
  {
    name: 'visual_page_review',
    match: (req) => /You review rendered pages of a government proposal/i.test(systemText(req)),
    respond: (req) => textMsg(req.model, '[]'),
  },
  // section_drafter (frontend proposal.draft_section tool) — the tool sends a system prompt
  // beginning "You are a senior government proposal writer" and JSON.parses the text block as a
  // CanvasNode[] array ([{type, content}], no fences).
  //
  // This composes the section from what the PRODUCT put in the prompt and nothing else: the
  // tenant's own library atoms, the compliance requirements traced to this section, the required
  // subsections, and the hard word budget derived from the page limit. It writes no facts of its
  // own — every sentence of substance is drawn from the customer's material, which is the honest
  // stand-in for a model that has been handed that material. A thin library yields a thin draft,
  // and that is the correct signal about the product's retrieval rather than a flattering one.
  {
    name: 'section_drafter',
    // The FRONTEND tool only. It demands a JSON CanvasNode[] array; the PIPELINE archetype with
    // the same opening phrase wants markdown and runs a tool loop first, and is handled below.
    match: (req) => /senior government proposal writer/i.test(systemText(req))
      && /valid JSON array of CanvasNode/i.test(systemText(req)),
    respond: (req) => {
      const sys = systemText(req);
      const user = lastUserText(req);
      // Same two prompt shapes as the pipeline responder — see sectionTitleFrom.
      const title = sectionTitleFrom(user) !== 'Section' ? sectionTitleFrom(user) : sectionTitleFrom(reqText(req));

      // The budget the product computed from the solicitation's page limit. Respect it — a draft
      // that busts the page limit is the failure the budget exists to prevent.
      const maxWords = Number(sys.match(/DO NOT exceed (\d[\d,]*) words/)?.[1]?.replace(/,/g, '') ?? 0) || 700;
      const targetWords = Number(sys.match(/Aim for about (\d[\d,]*) words/)?.[1]?.replace(/,/g, '') ?? 0)
        || Math.round(maxWords * 0.85);

      // Required subsections + evaluation criteria, as the product listed them.
      // Collect the bullet list that FOLLOWS a heading and STOP at its end. Scanning every later
      // line instead pulls the next list in too — which put the evaluation criteria under
      // "required subsections" and had the draft answering the wrong prompt.
      const listAfter = (heading) => {
        const seg = sys.split(heading)[1];
        if (!seg) return [];
        const out = [];
        for (const raw of seg.split('\n').slice(1)) {
          const l = raw.trim();
          if (l.startsWith('- ')) { out.push(l.slice(2).trim()); continue; }
          if (out.length) break;        // the list has ended
        }
        return out.filter(Boolean);
      };
      const subsections = listAfter('REQUIRED SUBSECTIONS (you must include all of these):');
      const criteria = listAfter('EVALUATION CRITERIA (address each one explicitly):');

      // Compliance requirements traced to THIS section — mandatory ones must be visibly answered.
      const compBlock = between(user, 'compliance_requirements');
      const mandatory = compBlock.split('\n').filter((l) => /^\[MANDATORY\]/.test(l.trim()))
        .map((l) => l.replace(/^\[MANDATORY\]\s*/, '').trim()).filter(Boolean);

      // The customer's own material.
      const atoms = parseAtoms(user);
      const pool = atoms.flatMap((a) => sentences(a.text));
      // Real library storage keys, when the product put any in the atom block. Preferring a real
      // key means the figure path runs against an object that actually exists (S3/local driver →
      // data-URI inlining on export) rather than a synthetic one that only proves the schema.
      const imageKeys = Array.from(new Set(
        (user.match(/[\w./-]+\.(?:png|jpe?g|webp|gif)\b/gi) || []).filter((k) => k.length > 6),
      ));
      const focus = terms([title, ...subsections, ...criteria, ...mandatory].join(' '));

      const nodes = [{ type: 'heading', content: { level: 1, text: title } }];
      let used = wordsIn(title);
      const push = (n, w) => { nodes.push(n); used += w; };

      // Lead paragraph: the strongest material for this section's own vocabulary.
      const lead = rankSentences(pool, focus, 8);
      if (lead.length) {
        const para = lead.slice(0, 5).join(' ');
        push({ type: 'text_block', content: { text: para } }, wordsIn(para));
      } else {
        // No usable library material reached this section. Say so in the draft rather than
        // inventing prose — an author must be able to see that the library came up empty.
        push({ type: 'text_block', content: {
          text: `No approved library content was retrieved for "${title}". Add source material to the `
            + 'library, or draft this section directly; nothing here has been generated from thin air.',
        } }, 30);
      }

      // Which extra primitives this section gets (deterministic per title). See the exerciser above.
      // Key on the whole prompt, not the title — see primitivePlanFor. A section whose title
      // did not parse still gets a distinct plan from its subsections/criteria/atoms.
      const plan = primitivePlanFor(`${title}|${subsections.join(',')}|${criteria.join(',')}|${(atoms[0]?.text || '').slice(0, 120)}`);
      let figureNo = 0;

      // A figure straight after the lead, when planned. `imageKeys` are REAL library storage keys
      // when the product supplied any in the atom block; otherwise a stable placeholder so the
      // image PATH still runs (inliner → export → compliance image budget).
      if (plan.figure && used < maxWords) {
        figureNo += 1;
        const key = imageKeys[0] || `emulated/figure-${hash32(title) % 997}.png`;
        push(imageNode(key, `${title} — reference figure`, figureNo), 12);
        push(captionNode('Figure', figureNo, `${title} — reference figure.`), 8);
      }

      // One subsection per required subsection, filled from the remaining best-matching material.
      const usedSentences = new Set(lead);
      for (const sub of subsections.slice(0, 6)) {
        if (used > targetWords) break;
        const subFocus = terms(`${title} ${sub}`);
        const picks = rankSentences(pool.filter((x) => !usedSentences.has(x)), subFocus, 3);
        // The heading goes in EITHER WAY. A required subsection that silently vanishes because the
        // library had nothing for it is a compliance failure the author never sees; an empty one
        // with an honest note is a visible gap they can close.
        push({ type: 'heading', content: { level: 2, text: sub } }, wordsIn(sub));
        if (picks.length) {
          picks.forEach((x) => usedSentences.add(x));
          const para = picks.join(' ');
          push({ type: 'text_block', content: { text: para } }, wordsIn(para));
        } else {
          push({ type: 'text_block', content: {
            text: `No library material matched "${sub}". This required subsection still needs to be written.`,
          } }, 14);
        }
      }

      // Every MANDATORY requirement gets an explicit, visible answer — an unanswered mandatory
      // requirement is the single most common way a compliant-looking volume fails review.
      if (mandatory.length && used < maxWords) {
        push({ type: 'heading', content: { level: 2, text: 'Compliance' } }, 1);
        const items = mandatory.slice(0, 8).map((m) => {
          const support = rankSentences(pool.filter((x) => !usedSentences.has(x)), terms(m), 1)[0];
          if (support) usedSentences.add(support);
          return { text: support ? `${m} — ${support}` : `${m} — addressed above.`, indent_level: 0 };
        });
        push({ type: 'bulleted_list', content: { items } }, items.reduce((a, i) => a + wordsIn(i.text), 0));
        // A traceability TABLE alongside the list — the shape a reviewer actually reads, and the
        // node type the docx/pdf writers and the ruler treat completely differently from prose.
        if (plan.table && used < maxWords) {
          push(tableNode(title, mandatory.slice(0, 4)), 24);
          push(captionNode('Table', 1, `${title} — requirement traceability.`), 8);
        }
        if (plan.callout && used < maxWords) {
          push(calloutNode('warning', 'Mandatory requirements',
            `${mandatory.length} mandatory requirement(s) are traced to this section; each is answered above.`), 18);
        }
      }

      // ── FILL THE ALLOWANCE ────────────────────────────────────────────────────────────
      // The product's own prompt says "Aim for about N words"; without this the responder stopped
      // after the lead paragraph whenever a mold listed no required subsections — which is the
      // usual case — and landed ~4 nodes against a ten-page allowance. Measured before this: a
      // Technical Volume at 40% of its page envelope. Every sentence below is still the tenant's
      // OWN retrieved material, just no longer discarded; when the library runs dry the section
      // stays short and the readiness warning says so.
      // ── The remaining planned primitives ──────────────────────────────────────────────
      // Placed before the continuation fill so they land inside the budget rather than after it
      // has been spent on prose. Each is charged; none is free.
      if (plan.chart && used < maxWords && subsections.length) {
        push(chartNode(title, subsections.slice(0, 4).map((x) => x.slice(0, 24))), 20);
        push(captionNode('Chart', 1, `${title} — phase schedule.`), 8);
      }
      if (plan.numbered && used < maxWords && criteria.length) {
        push(numberedNode(criteria.slice(0, 4)), criteria.slice(0, 4).reduce((a, c) => a + wordsIn(c), 0));
      }
      if (plan.quote && used < maxWords && criteria.length) {
        push(quoteNode(criteria[0], 'Solicitation, evaluation criteria'), wordsIn(criteria[0]) + 3);
      }
      if ((plan.chart || plan.numbered) && used < maxWords) push(dividerNode(), 0);

      const CONTINUATION = ['Approach', 'Technical Detail', 'Implementation', 'Evidence',
        'Risk and Mitigation', 'Expected Outcomes'];
      const remaining = () => rankSentences(pool.filter((x) => !usedSentences.has(x)), focus, 400, 0);
      let more = remaining();
      let ci = 0;
      while (used < targetWords * 0.95 && more.length && ci < CONTINUATION.length) {
        const take = more.slice(0, 5);
        take.forEach((x) => usedSentences.add(x));
        push({ type: 'heading', content: { level: 2, text: CONTINUATION[ci] } }, 2);
        const para = take.join(' ');
        push({ type: 'text_block', content: { text: para } }, wordsIn(para));
        // A short list every other block — the canvas renders and exports bulleted_list natively.
        const bullets = more.slice(5, 8);
        if (bullets.length && ci % 2 === 1) {
          bullets.forEach((x) => usedSentences.add(x));
          push({ type: 'bulleted_list', content: { items: bullets.map((b) => ({ text: b })) } },
            bullets.reduce((a, x) => a + wordsIn(x), 0));
        }
        ci += 1;
        more = remaining();
      }

      // Emphasis on the concrete claim in each paragraph — what a proposal writer actually bolds,
      // and what the canvas models as text_block.inline_formats. Never invented: the run points at
      // a figure or designator already in the sentence.
      const CONCRETE = /\b(?:\d[\d,.]*\s?(?:%|percent|metres?|meters?|km|nm|kW|W|months?|days?|weeks?)|TRL\s?\d|[A-Z]\d{5}-\d{2}-[A-Z]-\d{4}|\$[\d,]+)/;
      for (const n of nodes) {
        if (n.type !== 'text_block' || n.content?.inline_formats) continue;
        const t = n.content?.text ?? '';
        const m = t.match(CONCRETE);
        if (!m || m.index == null) continue;
        n.content.inline_formats = [{ start: m.index, length: m[0].length, format: 'bold' }];
      }

      // Trim to the budget from the end, never mid-node, so the draft always parses.
      while (used > maxWords && nodes.length > 2) {
        const dropped = nodes.pop();
        used -= wordsIn(JSON.stringify(dropped?.content ?? {}));
      }

      return textMsg(req.model, JSON.stringify(nodes));
    },
  },
  // section_drafter — the PIPELINE archetype (agents/archetypes/section_drafter.py). Same opening
  // phrase as the frontend tool, three material differences: it wants MARKDOWN ("## for
  // subsections"), it is told to call search_starter_scaffold FIRST and then search_library, and
  // draft_v0 feeds its text through build_canvas_document. Answering it the frontend way returned
  // a JSON array that the markdown converter faithfully wrapped in ONE text block — every section
  // of the proposal landed as a wall of JSON — and skipping its tool loop meant search_library
  // never ran, so the draft honestly reported that no library content had been retrieved. Walk the
  // tools first, then compose markdown from what they actually returned.
  {
    name: 'section_drafter_pipeline',
    match: (req) => /senior government proposal writer/i.test(systemText(req)),
    respond: (req) => {
      const tools = req.tools || [];
      const results = (req.messages || [])
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .filter((b) => b?.type === 'tool_result');

      // The section title must come from the WHOLE request, not the last user message: inside a
      // tool loop the last user message is the tool_result block, so reading it gave every section
      // the title "Section" and searched the library for a placeholder string.
      const all = reqText(req);
      const title = sectionTitleFrom(all);

      // Walk every tool once, in the order the archetype's own prompt names them — and call them
      // with the REAL section title. genericToolInput fills a string param with a placeholder
      // ("Emulated section_title — representative content…"), so search_library was querying for
      // that placeholder and correctly finding nothing. A tool loop that searches for the wrong
      // thing is worse than no tool loop: it looks like retrieval and returns noise.
      if (results.length < tools.length) {
        const order = ['search_starter_scaffold', 'search_library', 'get_compliance'];
        const ranked = [...tools].sort((a, b) => {
          const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        const next = ranked[results.length];
        if (next) {
          const input = genericToolInput(next, req);
          for (const k of Object.keys(input)) {
            if (/^(section_title|query|search|text|topic|title)$/i.test(k)) input[k] = title;
          }
          return toolUseMsg(req.model, next.name, input);
        }
      }

      // The MATERIAL is what the tools returned — the tenant's own library. The solicitation
      // excerpt in the prompt is REFERENCE: it says what the section must address, and the
      // archetype's own instructions call it untrusted data, never source copy.
      //
      // Pooling the two together is what produced the worst output this harness has ever
      // generated. `rfp_excerpt` carries up to 20,000 characters of DSIP instruction text, so it
      // outweighed the library by an order of magnitude and every section of the Technical Volume
      // opened with the same sentence about the False Claims Act and the fraud-waste-and-abuse
      // tutorial. A real model reads that excerpt and writes ABOUT the topic; quoting it back is
      // an artifact of the stand-in, and a stand-in whose failure mode does not resemble the
      // model's teaches the wrong lesson about the pipeline.
      const harvested = results.flatMap((b) => harvestProse(b.content));
      const pool = harvested.flatMap((t) => sentences(t));
      const focus = terms(title);

      // ── Honour the prompt's LENGTH + FORMAT contract ────────────────────────────────────
      // The archetype now states a character TARGET ("aim for roughly N characters") because a
      // page limit is an allowance to fill, not a ceiling to stay under, and asks for markdown's
      // full vocabulary. This emulator stands in for Claude, so it has to respond to both — a
      // stand-in that ignores half the prompt tests half the pipeline.
      //
      // It still NEVER fabricates. Length comes from using MORE of what the tools actually
      // returned (the old code ranked the pool and then threw away everything past the seventh
      // sentence), and the table below is built from requirement text the prompt itself carries.
      // When the library genuinely has nothing, it says so and stays short — under-filling is
      // the honest outcome there, and the readiness warning will say so.
      const target = Number((all.match(/aim for roughly ([\d,]+) characters/i)?.[1] ?? '0').replace(/,/g, ''))
        || Number((all.match(/Aim for ([\d,]+)[–-]/i)?.[1] ?? '0').replace(/,/g, ''))
        || 1200;

      // Emphasise the section's own focus terms — first occurrence per paragraph, mirroring the
      // narrow rule in lib/proposal/document-furniture.ts::emphasise.
      // What a proposal writer actually bolds is the CLAIM an evaluator scans for — a measured
      // result, a contract number, a TRL. So: a focus term if the paragraph carries one, else the
      // first concrete figure in it. Never invented, never more than one run per paragraph
      // (emphasising everything is what makes a page look shouted rather than structured).
      const CONCRETE = /\b(?:\d[\d,.]*\s?(?:%|percent|metres?|meters?|km|nm|kW|W|months?|days?|weeks?)|TRL\s?\d|[A-Z]\d{5}-\d{2}-[A-Z]-\d{4}|\$[\d,]+)/;
      const bolded = (para) => {
        if (!para || para.includes('**')) return para;
        for (const t of focus.slice(0, 3)) {
          const re = new RegExp(`(?<![\\w*])(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\w*])`, 'i');
          if (re.test(para)) return para.replace(re, '**$1**');
        }
        const m = para.match(CONCRETE);
        return m ? para.replace(m[0], `**${m[0]}**`) : para;
      };

      const lines = [`# ${title}`, ''];
      // floor 0 — relevance still ORDERS the material, but nothing usable is discarded:
      // the section has pages to fill and this is all real, retrieved content.
      const ranked = rankSentences(pool, focus, 400, 0);
      if (ranked.length === 0) {
        lines.push(
          `No approved library content was retrieved for "${title}". Add source material to the library, `
          + 'or draft this section directly; nothing here has been generated from thin air.', '');
        return textMsg(req.model, lines.join('\n'));
      }

      // Lead paragraph, then subsections of ~4 sentences until the target is reached or the
      // retrieved material runs out — whichever comes first.
      const SUBHEADS = ['Approach', 'Technical Objectives', 'Work Plan', 'Risk and Mitigation',
        'Relevant Experience', 'Anticipated Results', 'Transition and Commercialization'];
      let i = 0;
      const take = (n) => ranked.slice(i, (i += n));
      lines.push(bolded(take(4).join(' ')), '');

      // STRUCTURE BEFORE BUDGET. This loop used to run only `while length < target`, so when the
      // retrieved material was dense the 4-sentence lead alone met the target and the subheads,
      // bullets and table below never ran — the responder emitted one heading and one paragraph
      // and looked like a converter ceiling when it was a gating bug. Guarantee a minimum of two
      // subsections, THEN fill to target.
      const MIN_SUBS = 2;
      let sub = 0;
      while (sub < SUBHEADS.length && i < ranked.length
             && (sub < MIN_SUBS || lines.join('\n').length < target)) {
        const para = take(4);
        if (para.length === 0) break;
        lines.push(`## ${SUBHEADS[sub]}`, '', bolded(para.join(' ')), '');
        // A short bulleted list every other subsection — markdown the converter now carries
        // through as a real bulleted_list node.
        const bullets = take(3);
        if (bullets.length && sub % 2 === 1) {
          lines.push(...bullets.map((b) => `- ${b}`), '');
        }
        sub += 1;
      }

      // A requirements table, built ONLY from requirement text the prompt itself carries (the
      // fenced evaluation-criteria / required-subsections blocks). No requirements in the prompt
      // ⇒ no table, rather than an invented one.
      // The SHORT fenced blocks only. The archetype fences four things in the same markers: the
      // section name, the evaluation criteria, the required subsections — and the whole raw
      // solicitation excerpt, up to 20,000 characters. Taking them all fed the table arbitrary
      // lines of agency boilerplate ("Distribution A - Approved for Public Release") as if they
      // were requirements. Requirements come in short bullets; the excerpt does not.
      const fenced = all.split('--- BEGIN USER CONTENT ---').slice(1)
        .map((seg) => seg.split('--- END USER CONTENT ---')[0])
        .filter((seg) => seg.length < 2500)
        .join('\n');
      const reqs = fenced.split('\n')
        .map((l) => l.replace(/^\s*-\s*/, '').trim())
        .filter((l) => l.length > 12 && l.length < 200);
      if (reqs.length >= 2) {
        lines.push('## Compliance Cross-Reference', '',
          '| Requirement | Addressed in |',
          '| --- | --- |',
          ...reqs.slice(0, 8).map((r, n) => `| ${r.replace(/\|/g, '\\|')} | §${n + 1} above |`),
          '');
      }
      // ── The three primitives the shipped MOLDS use and markdown cannot yet say ──────────
      // Measured demand (scripts/analyze-node-demand.mjs): page_break, callout and divider each
      // appear in a shipped mold, and none survives the markdown round-trip today. Emitting them
      // here is the RED half — until markdown_to_canvas parses them these are dropped, which is
      // the drop this harness exists to demonstrate.
      //
      // Syntax choices, deliberately conventional rather than invented:
      //   callout  → GitHub's `> [!WARNING]` alert, a de-facto standard
      //   divider  → `***`, standard markdown thematic break. NOT `---`, which collides with the
      //              table separator row and with frontmatter (the footgun called out in review).
      //   page_break → `<!-- pagebreak -->`, since markdown has no notion of one. An HTML comment
      //              degrades to nothing visible in any renderer that does not know it, which is
      //              the property that makes markdown safe to extend at all.
      if (reqs.length >= 2) {
        lines.push('> [!WARNING]', `> ${reqs.length} mandatory requirement(s) are traced to this section.`, '');
      }
      lines.push('***', '');
      lines.push('<!-- pagebreak -->', '');

      return textMsg(req.model, lines.join('\n'));
    },
  },
  // Generic tool-using agent: walk the WHOLE tool loop — read/query tools first, the OUTPUT tool
  // (emit_/save_/publish_/…) LAST so the agent's result actually lands — one tool per turn until every
  // tool has run, then finish with text. Id params get real uuids from the request context.
  {
    name: 'tool-agent',
    match: (req) => (req.tools || []).length > 0,
    respond: (req) => {
      const tools = req.tools || [];
      const isOutput = (n) => /^(emit_|save_|publish_|store_|submit_|apply_|write_|record_|create_)/i.test(n) || /draft_plan|candidates|revision/i.test(n);
      const ordered = [...tools].sort((a, b) => (isOutput(a.name) ? 1 : 0) - (isOutput(b.name) ? 1 : 0));
      const done = (req.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b?.type === 'tool_result').length;
      if (done === 0 && req.tool_choice?.type === 'tool') {
        const forced = tools.find((t) => t.name === req.tool_choice.name);
        if (forced) return toolUseMsg(req.model, forced.name, genericToolInput(forced, req));
      }
      if (done >= ordered.length) return textMsg(req.model, 'Done — the emulated model completed its tool loop.');
      return toolUseMsg(req.model, ordered[done].name, genericToolInput(ordered[done], req));
    },
  },
  // Structured-output call: the caller demanded JSON, so prose is a wiring FAILURE, not a stand-in.
  // The shredder says "Respond ONLY with valid JSON matching the schema below" and then json.loads()
  // the reply — so the catch-all text rule below killed every OnRfpUploaded run with
  // "ValueError: Claude returned unparseable JSON" (7 failed instances), and no structured-output AI
  // flow could be driven end to end in the sandbox at all. The emulator is documented as mirroring
  // the prod wiring exactly; here it did the opposite.
  {
    name: 'json-schema',
    match: (req) => wantsJson(req),
    respond: (req) => textMsg(req.model, JSON.stringify(emulatedJsonFor(req))),
  },
  // Plain-text agent / AI route: a concise, structured completion.
  {
    name: 'text',
    match: () => true,
    respond: (req) => textMsg(req.model,
      'Emulated model response for end-to-end wiring verification. The request was received with a valid ' +
      `system prompt (${systemText(req).length} chars) and ${(req.messages || []).length} message(s). ` +
      'In production the Railway-keyed Claude returns the live content here; the surrounding agent/route ' +
      'plumbing, guardrails, landing, and human-review UX are what this run exercises.'),
  },
];

const server = http.createServer((httpReq, res) => {
  if (httpReq.method === 'GET' && httpReq.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'emulated-claude', seq }));
    return;
  }
  if (httpReq.method !== 'POST' || !httpReq.url.startsWith('/v1/messages')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: httpReq.url } }));
    return;
  }
  let body = '';
  httpReq.on('data', (c) => { body += c; });
  httpReq.on('end', () => {
    let req;
    try { req = JSON.parse(body || '{}'); }
    catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad json' } })); return; }
    const responder = RESPONDERS.find((r) => r.match(req)) || RESPONDERS[RESPONDERS.length - 1];
    const out = responder.respond(req);
    log({ t: nowIso(), responder: responder.name, model: req.model, tools: toolNames(req), toolChoice: req.tool_choice ?? null, system: systemText(req).slice(0, 240), lastUser: lastUserText(req).slice(0, 240), out });
    res.writeHead(200, { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' });
    res.end(JSON.stringify(out));
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`[emulated-claude] listening on http://127.0.0.1:${PORT}  (log: ${LOG})`));
