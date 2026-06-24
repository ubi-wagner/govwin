# Claude Spend Analysis — 30 Launch Customers

**Date:** 2026-06-24 · **Branch:** `claude/nice-hamilton-kBqtD`
**Scope:** end-to-end Claude API cost for (a) **Spotlight scoring for all** and
(b) **random proposal build buys**, sized for **30 launch customers**, plus the
cost-control rails that cap it.

> All figures are **planning estimates**. The per-model rates and per-operation
> token assumptions are exact (from the code); the **volumes** (opportunities
> scored, proposals bought) are assumptions — every table shows the formula so
> you can drop in real numbers post-launch from the `/admin/agents/usage`
> dashboard, which now sees **all** AI spend (see §6).

---

## 1. Per-model pricing (USD / 1M tokens)

| Model | ID (pinned in code) | Input | Output | Used by |
|-------|---------------------|-------|--------|---------|
| **Sonnet 4** | `claude-sonnet-4-20250514` | $3.00 | $15.00 | section_drafter, proposal_architect, color_team_reviewer, capture_strategist, **live Draft tool** |
| **Haiku 4.5** | `claude-haiku-4-5-20251001` | $1.00 | $5.00 | scoring_strategist, opportunity_analyst, compliance_reviewer, librarian, packaging_specialist, partner_coordinator, **live Compliance route** |

> Sonnet 4 (`…20250514`) is the deprecated pin (retires 2026-06-15); it is the
> same $3/$15 tier as `claude-sonnet-4-6`. Migrating the pin doesn't change this
> analysis. These rates are now consistent in three places: the frontend guard
> (`lib/ai/agent-guard.ts`), the pipeline (`fabric.py::MODEL_PRICING`), and the
> admin dashboard. (Before this change the dashboard mis-priced Haiku at
> $0.25/$1.25 and `fabric.py` billed every Haiku call at Sonnet rates.)

---

## 2. Bucket A — "Spotlight for all" (opportunity scoring)

Spotlight fit-scoring is the **scoring_strategist** archetype (Haiku, `max_tokens=2048`,
temp 0.2). One invocation scores one **(opportunity × tenant)** fit.

**Per-scoring cost** (typical): ~2,500 input tokens (opportunity summary + tenant
profile + rubric) + ~400 output tokens (score + rationale):

```
2,500 × $1/1M  +  400 × $5/1M  =  $0.0025 + $0.0020  =  $0.0045 / scoring
```

| Strategy | Opportunities × tenants / month | Cost/mo | Notes |
|----------|--------------------------------|---------|-------|
| **Naive — score everything for everyone** | 2,000 active opps × 30 = **60,000** | **~$270** | Pays Claude to score obvious non-fits |
| **Gated — pre-filter then LLM-score** (recommended) | ~150 pre-qualified × 30 = **4,500** | **~$20** | Algorithmic NAICS/keyword/recency filter first; LLM only ranks the shortlist |

> **Recommendation:** gate LLM scoring behind the cheap algorithmic pre-filter
> the pipeline already computes. A 13× cost reduction with no user-visible loss —
> non-matching opportunities never needed an LLM opinion. Spotlight runs as an
> **admin** function (`tenant_id = null`), so it is **not** covered by the
> per-tenant budget — see §5 for why this bucket needs the platform cap.

---

## 3. Bucket B — "Random proposal build buys"

End-to-end build of one bought proposal (~8 sections, one lean pass). Costs from
the actual surfaces and their pinned models:

| Step | Archetype / surface | Model | ~Input | ~Output | Cost |
|------|--------------------|-------|--------|---------|------|
| Outline | proposal_architect | Sonnet | 6K | 2K | $0.048 |
| Draft sections (×8) | **live Draft tool** | Sonnet | 15K×8 | 3K×8 | $0.720 |
| Compliance checks (×3) | **live Compliance route** | Haiku | 13K×3 | 1.5K×3 | $0.062 |
| Color-team review (×2) | color_team_reviewer | Sonnet | 17K×2 | 3K×2 | $0.192 |
| Capture / win-themes | capture_strategist | Sonnet | 5K | 2K | $0.045 |
| Packaging | packaging_specialist | Haiku | 8K | 1.5K | $0.016 |
| **Lean one-pass total** | | | | | **~$1.08** |

Real users **reprompt and revise** — drafting is the expensive part. Applying a
reprompt factor:

| Build profile | Reprompt factor on drafting | Cost/proposal |
|---------------|----------------------------|---------------|
| Lean (one pass) | 1× | **~$1.10** |
| **Typical (planning midpoint)** | ~2–3× | **~$3–$6** |
| Heavy (many revisions, big RFP) | 4–6× | **~$8–$12.50** |

> The heavy end matches `fabric.py`'s own COST MODEL comment ($4.50–$12.50/proposal).
> Use **~$6/proposal** as the planning midpoint.

**Monthly build spend (30 customers):** assume each customer buys **~2 proposals/mo**
on average (some 0, some 5) → **60 builds/mo**:

| Per-proposal | 60 builds/mo |
|--------------|--------------|
| Lean $1.10 | **$66** |
| **Midpoint $6** | **$360** |
| Heavy $12.50 | **$750** |

---

## 4. Blended monthly total (30 launch customers)

| Bucket | Expected (gated + midpoint) | Worst case (naive + heavy) |
|--------|-----------------------------|----------------------------|
| Spotlight scoring | $20 | $270 |
| Proposal builds | $360 | $750 |
| Triage / atomization (opportunity_analyst, librarian on uploads) | ~$30 | ~$60 |
| **Total / month** | **~$410** | **~$1,080** |

**Against revenue:** at $199/mo × 30 = **$5,970/mo**. AI COGS is **~7% expected**,
**~18% worst case** — healthy either way. (The "<2% COGS" line in `fabric.py` is
a per-tenant best case; the blended, reprompt-inclusive number is higher.)

---

## 5. The rails that cap this (verified + newly extended)

The counter the customer asked about is **real** and lives in `agent_task_log`
(the unified spend ledger). It enforces, **fail-closed**, per tenant:

| Rail | Value | Where |
|------|-------|-------|
| Hourly rate limit | **50 calls / hour / tenant** | `fabric.py::_check_rate_limit` + `lib/ai/agent-guard.ts` |
| Monthly budget | **$50 / tenant** (`tenant_agent_config.monthly_budget`, default) | `fabric.py::_check_budget` + `agent-guard.ts` |
| AI kill-switch per tenant | `monthly_budget = 0` → AI disabled | both |
| Per-call ceiling | **$0.50 / call** (mid-loop) | `fabric.py` |

**What changed this session ("wire it up the whole way"):** the two **live**
product-AI surfaces — the **Draft tool** and the **Compliance route** — called
Claude **directly from Next.js and bypassed the counter entirely** (no rate
limit, no budget, and they weren't even written to `agent_task_log`, so the
dashboard and budget check were blind to the real reprompt spend). They now:

1. call `assertAgentBudget(tenantId)` **before** spending (same 50/hr + $50/mo,
   fail-closed), returning a clean **429** (rate) / **402** (budget) on block; and
2. write every attempt to `agent_task_log` via `recordAgentSpend(...)`, priced
   per-model — so **one ledger** governs pipeline **and** product AI.

**Cap math:** $50/tenant × 30 = **$1,500/mo ceiling** on tenant-attributed spend.
Expected build spend ($360) sits ~4× under the ceiling, leaving headroom for
heavy users — and a single runaway customer is hard-capped at $50 (≈ 8 heavy
proposals, then 402 until next month or an admin raises their budget).

**The one gap that remains:** Spotlight "for all" runs as **admin**
(`tenant_id = null`), which is **not** covered by the per-tenant budget. With
gating it's only ~$20/mo, but it is structurally uncapped. **Recommendation:**
add a **platform-level monthly cap** (a single env-configurable ceiling checked
before admin/system invocations) as a kill-switch backstop. Small follow-up;
not launch-blocking given the gated cost.

---

## 6. Recommendations (answers to "Questions or better idea?")

1. **Unify the ledger (done).** `agent_task_log` is now the single source of
   truth for all tenant AI spend; the `/admin/agents/usage` dashboard now
   reflects real product-AI cost (it was previously blind to it).
2. **Gate Spotlight LLM-scoring** behind the algorithmic pre-filter (§2): ~13×
   cheaper, no UX loss.
3. **Add a platform-level cap** for admin/system (`tenant_id = null`) spend (§5)
   so the one uncapped path has a backstop.
4. **Tie budget to tier.** $50/mo is a sensible default; consider raising it for
   higher subscription tiers via `tenant_agent_config.monthly_budget` (already
   per-tenant, no code change needed).
5. **Re-baseline after launch.** The volume assumptions (opportunities scored,
   proposals/customer/month, reprompt factor) are the only soft inputs. The
   dashboard now captures the real numbers — revisit this doc once HITL testing
   produces a week of live data.
6. **Migrate the Sonnet pin** (`…20250514` → `claude-sonnet-4-6`) before the
   2026-06-15 retirement. Same price tier; no impact on these figures.
