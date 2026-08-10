# AI Emulation — being the model behind a local shim (2026-08-10)

> How the two AI P1 gaps from `docs/HUMAN_GAP_ANALYSIS.md` were proven **end-to-end without a live
> Anthropic key**, by standing Claude in for the exact API call each agent makes. Faithful: the real
> agent code, prompts, parsing, guardrails, and land-or-review gate all run unchanged — only the
> transport (the HTTPS call to the key) is substituted.

## The seam
Every agent completion flows through one of two client shapes:
- **Anthropic SDK** (`new Anthropic({apiKey})` → `client.messages.create`) — honors `ANTHROPIC_BASE_URL`
  automatically. Used by `lib/tools/proposal-draft-section.ts` (the `section_drafter`).
- **Raw `fetch`** to the API URL — `lib/ingest/parse-solicitation.ts` (the ingest shred). Made
  redirectable this session: `const base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'`
  (one line; defaults to the real API when the env is unset, so production is unchanged).

## The mechanism
1. **Shim** (`scratchpad/anthropic-shim.mjs`) — a ~50-line local server implementing `POST /v1/messages`.
   It returns a completion I pre-authored, in the Anthropic response shape
   `{content:[{type:'text',text:…}], usage:{…}}`. Responses are routed by a section-title slug in the
   user message (the drafter, many calls) or a single `_default` (the ingest, one call); misses are
   captured to `requests/` so I can author the completion.
2. **Env** — start the server with `ANTHROPIC_API_KEY='sk-emulated'` (non-`sk-noop`, so the code takes
   the AI path) and `ANTHROPIC_BASE_URL='http://127.0.0.1:8790'` (→ the shim). `scratchpad/start_server_emu.sh`.
3. **Drive the real routes** — the agent code builds its real prompt, calls the shim, and lands the
   result through the real routes + guardrails.

## What was proven
### 1. Ingest shred (admin P1) — `scratchpad/emu-ingest.mjs`
Staged a **fresh** solicitation with the **real** DoW 2026 SBIR BAA text (PyMuPDF-extracted), drove the
real `POST /api/admin/rfp-curation/<sol>/ingest-assist` (no `parsed` body → forces `parseSolicitation`),
which called the shim (my faithful extraction) → `materializeSkeleton`. Result: event `source='ai'`
(not the default fallback), and the **materialized compliance matches the hand-authored ground truth**
(mig 167): `page_limit_technical=10`, `min_font_size=10`, **6 DSIP volumes** incl. FWA Training,
**12 technical sections**. Proves *"drop the BAA → get the right compliance matrix"* when the AI runs.

### 2. Section drafter (tenant P1) — `scratchpad/emu-draft.mjs`
Fresh DoW SBIR portal → empty `Phase I Technical Objectives` section → invoked the real
`POST /api/tools/proposal.draft_section` (→ SDK → `ANTHROPIC_BASE_URL` → shim; shim log confirms the
HIT, `model=claude-sonnet-4-20250514`). The tool returned real, on-topic `CanvasNode[]` (218 words,
within the page budget); landed via the real save route as an **advisory `ai_draft`** —
`status='ai_drafted'`, `content_source='ai_draft'`, **`is_locked=false`** (the human still reviews +
`Accept & Lock`). The land-or-review invariant held: no auto-write to a locked/accepted state.

## Invariants preserved
- Advisory → guardrail → land-or-review. The drafter's output landed as a reviewable `ai_draft`, never
  auto-accepted/locked.
- Real prompts + real input (the actual BAA text, the actual section mold + compliance).
- The only substitution is the transport. Point `ANTHROPIC_BASE_URL` at the real key (Railway) and the
  same code paths hit the real API.

## Reproduce
```bash
# 1. shim
SHIM_DIR=…/scratchpad/shim node scratchpad/anthropic-shim.mjs &
# 2. server on the emulated env (real-key sentinel + local base URL)
bash scratchpad/start_server_emu.sh &
# 3. author the completion(s) in scratchpad/shim/responses/ (routed by _default or <title-slug>.txt)
# 4. drive the real route/tool → diff/verify
node scratchpad/emu-ingest.mjs   # admin ingest shred
node scratchpad/emu-draft.mjs    # tenant section drafter
```
To return the sandbox to the deterministic no-AI state, restart with `scratchpad/start_server.sh`
(`sk-noop`, no base URL).
