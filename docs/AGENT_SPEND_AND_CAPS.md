# Agent spend and the caps that bound it

**Measured 2026-08-28** on the sandbox, against the build that was serving.
Instruments: `pipeline/tests/verify_spend_guardrails.py` · `frontend/scripts/estimate-full-build-cost.mts`.
Both are registered in `frontend/scripts/run-branch-drives.sh` (`spend-guardrails`, `full-build-cost`)
— an instrument run by hand is one that quietly stops being run.

---

## 1 · The caps

Six layers, resolved in `pipeline/src/agents/fabric.py`. Each **fails closed**.

| Layer | Where it is set | What it does |
|---|---|---|
| Platform kill switch | `platform_agent_config.ai_enabled` | refuses every call, every tenant |
| Platform monthly cap | `platform_agent_config.platform_monthly_cap` | refuses on total spend across **all** tenants |
| Framework ceiling | `automation_framework.agent_monthly_budget_ceiling_usd` | a tenant may only lower below it, never raise |
| Tenant monthly budget | `tenant_agent_config.monthly_budget` → platform default → `$50` | `0` disables AI for that tenant |
| Hourly rate limit | `tenant_agent_config.rate_limit_per_hour` → `50` | refuses on calls in the trailing hour |
| Per-call ceiling | `PER_CALL_CEILING_USD = $0.50` | checked mid-loop, bounds one invocation |

The aggregation source for every dollar figure is `agent_task_log`, summed
`WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())`.

### Verified — 11 cases, both directions

`verify_spend_guardrails.py` asserts the **ALLOW** as well as the **REFUSE** for every cap that has
one. A guard that refuses everything passes a refusal-only test, which is why the allow half is not
optional.

```
1 · tenant monthly budget      REFUSES over · ALLOWS under
2 · monthly_budget = 0         REFUSES (AI disabled for that tenant)
3 · platform cap               REFUSES even when the TENANT has headroom · ALLOWS once lifted
4 · ai_enabled = false         REFUSES everywhere
5 · hourly rate limit          REFUSES at the limit · ALLOWS below it
6 · framework ceiling          beats a tenant's own $9999 figure
restore                        ceiling back · tenant config back exactly as found

11 passed · 0 failed
```

It snapshots every value it touches **first** and restores in a `finally`, then **asserts the
restore**. That shape was not free: an earlier hand-run version left a tenant on a $9999 budget and
the framework ceiling at $0.39, because it restored a column it had never snapshotted.

---

## 2 · What a full build costs

### The emulator cannot answer this, and says so

`scripts/test-harness/emulated-claude.mjs` returns a **constant** usage block — `input_tokens: 64`
(96 on a tool turn), output derived from the length of its own canned text. It has to: a fabricated
response has no real prompt behind it. So `cost_usd` after an emulated run measures **the call count
and the rate table**, not spend.

The emulator now records `chars` — the untruncated size of the real system prompt, tool schemas and
messages the product assembled — which is the one honest input a forecast can be built from.

### Two numbers, side by side, never blended

One full Mode C build. 18 sections, 15 authorable (three are letters and a priced workbook, which
`is_authorable` correctly declines to draft), foundation tenant, TVSF Round 45.

|  | Figure | What it is |
|---|---|---|
| **LEDGER** | **$0.1462** · 24 calls | what `agent_task_log` recorded, and what every cap acts on. Under emulation this is a plumbing measurement. |
| **LIVE-RATE** | **$1.34 – $1.78** | the forecast. Input **measured**, output **assumed**. |

```
input   $1.09 – $1.46   MEASURED: 1,592,023 real characters the product assembled
                        and sent across 92 requests
output  $0.24 – $0.32   ASSUMED: 15 drafting calls × 3,817 chars (the observed mean
                        of the 18 sections already drafted on the source proposal)
                        + 9 advisory calls × 1,500 chars
```

Band spans 4.0 → 3.0 chars/token. Blended rate $2.75 in / $13.75 out per M (88 % of calls are
Sonnet; `stylist`, `library_seed_suggester` and `packaging_specialist` are Haiku, and the ledger's
own arithmetic confirms the split — identical token counts billing at exactly one third).

**≈ $0.09 – $0.12 per drafted section.**

### Against the caps

```
effective monthly budget   $50.00   (platform default — foundation has no tenant row)
builds/month at LEDGER     341      the emulated figure. Do not plan on this.
builds/month at LIVE-RATE  28 – 37  what the same cap actually buys

per agent call   ~66,300 input chars (mean over 24 calls, 3.8 requests each)
                 largest single request 24,344 chars
                 mean call $0.078 · bound $0.103 against the $0.50 per-call ceiling
                 → 4.9× headroom even at the bound
```

---

## 3 · Three findings

### 3.1 The ledger figure is ~12× low under emulation

A budget sized against an emulated run would be exhausted after ~28 builds, not 341. The caps
themselves are correct — they sum the right column with the right predicate — but **the number they
sum is only real when the model is real.** Nothing on the emulated path can tell you otherwise,
because the arithmetic is right at every step.

### 3.2 Every proposal on the box was un-draftable, so every prior "full build" measured the cheap half

`draft_v0` selects `WHERE s.status IN ('empty','ai_drafted')`. Every proposal in the sandbox is
`approved` or `in_progress`. A full draft fired at any of them returns:

```json
{"draft_sections": {"drafted": 0, "skipped": false, "reason": "no_authorable_sections"}}
```

The manager and the nine-strong review cohort still run and still bill, so the workflow completes,
the ledger gains rows and the run looks like a full build. It is not one: `section_drafter` — 15 of
the 24 calls and the great majority of the input tokens — never fires. `agent_task_log` shows
`section_drafter` had been invoked **once, ever**, before this measurement.

`estimate-full-build-cost.mjs` therefore builds its own fixture and **refuses a verdict** (exit 2)
if the run drafts zero sections. Red-tested: with the tenant budget forced to `0`, the build drafted
nothing and the script refused rather than reporting the review cohort's cost as a full build.

### 3.3 A budget refusal stops the build cleanly, at the first section, audited

The same red test proves the stop behaviour end to end. With `monthly_budget = 0`, ten
`agent_task_log` rows were written — every one `status='failed'`, `cost_usd = 0`, carrying the reason
`Tenant … exceeded the monthly budget` — and `section_drafter` appears **once, not fifteen times**.
`draft_v0` recognises that a guardrail refusal is not a per-section problem and stops, rather than
spending fourteen more calls to be refused fourteen more times, and rather than dead-ending the
workflow.

---

## 4 · What this does NOT establish

- **The output side of the forecast is an assumption**, not a measurement. It is sourced — the
  observed lengths of real drafted sections on the same solicitation — but a live model may write
  longer or shorter, and the estimate moves with it.
- **Input apportionment across models is approximate.** The emulator log does not name the calling
  archetype, so measured input bytes are priced at a blended rate weighted by each archetype's share
  of the run's calls.
- **Nothing here is a live-key measurement.** Every figure comes from the emulated path with real
  prompt sizes. The first live-key build should be re-measured with this same instrument and the
  numbers above treated as the prior, not the answer.
- **One solicitation, one shape.** An 18-section state grant. A 40-section DoD volume set will cost
  more than proportionally if context assembly grows with the proposal.

---

## Related

- `docs/AGENT_WORKFORCE.md` — the archetypes, the safety contract, what "advisory" means
- `docs/AI_EMULATION_HARNESS.md` — what the emulator stands in for and what it cannot
- `docs/AUTOMATION_POLICY_BUILD_LOG.md` — the recipients × timing × escalation layer above these caps
