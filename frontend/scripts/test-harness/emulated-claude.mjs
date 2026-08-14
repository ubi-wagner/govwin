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
