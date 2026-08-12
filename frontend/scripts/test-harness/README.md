# Sandbox test-harness — emulated Claude

**Sandbox-only. Never used in production.** Production points at the real Anthropic API via the
Railway `ANTHROPIC_API_KEY`; this harness exists so the AI-gated flows can be exercised **end-to-end
in the sandbox** (which has no live key) with **zero product-code change**.

## `emulated-claude.mjs`

A minimal Anthropic **Messages API** (`POST /v1/messages`) compatible endpoint. Both services already
read `ANTHROPIC_BASE_URL` and gate on `ANTHROPIC_API_KEY !== 'sk-noop'`, so pointing them here activates
every real agent/AI invoke path — the agents run their *own* code (tool loop, guardrails, landing,
human-review UX); the emulator returns the model's side.

- Non-streaming only (all callers use `messages.create`).
- Deterministic; every request/response is appended to a `.log.jsonl` for review ("both sides" tape).
- **Responses come from a per-agent RESPONDER registry** — each responder returns the *exact* shape that
  agent's code expects (e.g. the `compliance_reviewer` returns the JSON array the `ai/compliance` route
  `JSON.parse`s). A generic tool/text fallback covers anything not yet special-cased. Expand the registry
  as new flows are wired.

Run it via the heartbeat (`EMULATE=1 … sandbox-heartbeat.sh`) so it stays up, or directly:

```
LOG=/tmp/emu.log.jsonl PORT=8787 node frontend/scripts/test-harness/emulated-claude.mjs
# then start the app/pipeline with:  ANTHROPIC_BASE_URL=http://127.0.0.1:8787  ANTHROPIC_API_KEY=emulated-claude
```

⚠️ These responses are authored for wiring/UX/guardrail/security verification — realistic, but authored
per scenario, not the live model's open-ended generality. That last mile is proven only by prod's real key.
