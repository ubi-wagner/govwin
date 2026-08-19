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
    .filter((x) => !/^\s*\d+\.\s/.test(x) || x.length > 140);
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

/** Rank candidate sentences by overlap with the section's own vocabulary; keep the best, deduped. */
function rankSentences(pool, focusTerms, limit) {
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
    .filter((x) => x.score > 0.4)
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

const wordsIn = (s) => (s.match(/\S+/g) || []).length;

// ── RESPONDER REGISTRY — expand per-agent as flows are wired. First match wins. ─────────────────────
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
      const title = (user.match(/Draft the "([^"]{2,120})" section/i)?.[1] ?? 'Section').replace(/\s+/g, ' ').trim();

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
      const title = (all.match(/Draft the "([^"]{2,120})" section/i)?.[1] ?? 'Section').replace(/\s+/g, ' ').trim();

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

      const user = lastUserText(req);

      // Everything the tools returned is the material to write from.
      const harvested = results.flatMap((b) => harvestProse(b.content));
      const pool = [...harvested.flatMap((t) => sentences(t)), ...sentences(user)];
      const focus = terms(title);

      const lines = [`# ${title}`, ''];
      const lead = rankSentences(pool, focus, 6);
      if (lead.length) {
        lines.push(lead.slice(0, 4).join(' '), '');
      } else {
        lines.push(
          `No approved library content was retrieved for "${title}". Add source material to the library, `
          + 'or draft this section directly; nothing here has been generated from thin air.', '');
      }
      const used = new Set(lead);
      const rest = rankSentences(pool.filter((x) => !used.has(x)), focus, 6);
      if (rest.length) {
        lines.push('## Approach', '', rest.slice(0, 3).join(' '), '');
      }
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
