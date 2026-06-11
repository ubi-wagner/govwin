# RFP Pipeline — Public Site Launch‑Readiness Review

**Prepared as an outside strategy + creative review (Bain‑style diagnosis, NYC‑ad‑house creative lens).**
**Status: ANALYSIS ONLY — no page/route changes have been made.** This is a recommendations + TODO document for your review.

> **Approved for implementation (round 2 — Eric):** The dollar figures below are **cleared to publish** ($5,000/mo monitoring, $299/mo Spotlight, 10%-of-award consultants, $999 Phase I / $1,999 Phase II). **No Phase I → Phase II credit** — the prior pricing FAQ that promised a $1,000 upgrade credit is **incorrect and is being removed**; the correct value story is *"Phase II is an exponentially bigger proposal for only $1,000 more."* Implementation is proceeding through **all phases**, shipped as incremental, individually-revertable commits. This document is the running plan of record; a build log is appended at the bottom as work lands.
>
> **Unifying principle (Eric):** "Why it wins," "what it saves and adds (pains & gains)," "the value drivers," and "how it works" are **one narrative and one user arc** — not four overlapping pages. So the build collapses them into a single spine — **Pain → Gain (saves + adds) → Why it wins (value drivers / the model + moat + flywheel) → How it works (the journey) → Proof (the expert) → Price → Apply** — told in condensed form on the homepage and in full on a flagship **"Why RFP Pipeline"** page (an upgrade of `/value`). `/engine`'s "Expert + AI + Process" thesis folds into that arc (and `/engine` redirects in), so there is exactly one "why/how" story instead of three competing numbered-step pages. `/how-it-works` remains the operational deep-dive chapter, cross-linked from the arc.

Scope reviewed: every public page and route — `/`, `/about`, `/the-expert`, `/value`, `/engine`, `/features`, `/how-it-works`, `/pricing`, `/infosec` (`/security` redirects here), `/apply`, `/team`, `/customers`, `/resources`, `/resources/[slug]`, `/legal/*`, header/footer/nav, and the redirect routes (`/get-started`→`/pricing`, `/blog/*`→`/resources`).

---

## 0. Executive summary

**The site is design‑ready and credibility‑strong, but not yet conversion‑optimized.** It reads like a real product built by people who know the domain. The visual system is clean and consistent, the expert story is genuinely differentiating, and the honesty (esp. the security page) builds trust. For a warm audience that already knows federal R&D, it largely works today.

It is **not yet tuned for the two jobs you told us matter most:**

1. **Hooking and educating newcomers** who don't yet know federal R&D / SBIR exists. The site assumes the visitor already knows what SBIR/STTR/BAA/OTA are and that they want to write proposals. A founder who's never heard "non‑dilutive federal R&D" gets no on‑ramp.
2. **Landing the value/ROI punch** for the experienced buyer. The copy is **feature‑led** ("we have curation, AI, a compliance engine") but never **cost‑anchored** against the brutal price of the status quo — the exact argument you made (you paid **$5,000/mo** for monitoring; consultants take **10% of award** or fat retainers; we're **$299/mo + flat $999/$1,999**). That comparison is the single most persuasive thing you have and it appears **nowhere** on the site.

**Plus the issue your wife flagged, which is real:** there are **three overlapping "process" narratives** (homepage "Six stages" = `/how-it-works` almost verbatim; `/engine` is a *second* numbered 6‑step that looks and feels like a sibling). And a handful of themes ("isolated AI," "human‑in‑the‑loop," "stage‑gated") are repeated across 5+ pages instead of landing once, hard.

**Top 5 moves (detail in §5):**
1. Add a **"cost of the status quo" / ROI** value block (the $5k‑vs‑$299 and 10%‑vs‑flat math). Biggest conversion lever on the site.
2. Add a **newcomer on‑ramp** ("There's billions in non‑dilutive federal R&D money and you probably qualify") — a homepage band + a dedicated **"Federal R&D 101 / Is this for you?"** page.
3. **Resolve the process overlap:** make `/how-it-works` the *customer journey* and re‑cast `/engine` as *the model / why it wins* (thesis + moat + flywheel), not a second numbered list.
4. **Dual‑audience hero + dual CTA:** keep "Apply" (paid intent) but add a **soft secondary CTA** for not‑ready newcomers → the **existing waitlist** / a guide. Today every CTA dumps cold traffic onto a $299 paywall.
5. **De‑duplicate the thesis** ("isolation / HITL / stage‑gating"): say it once, powerfully; reference elsewhere.

**Verdict:** *Soft‑launch ready today* (warm/referral traffic). For **paid acquisition or cold newcomer traffic, do Phase 0 first** (§6) — roughly 1–2 focused days of copy + two new sections + one new page.

---

## 1. Lens: who we read the site as

- **"Newcomer Nadia"** — founder/CTO of an innovative small business (robotics, materials, climate, defense‑adjacent). Brilliant tech. Has *never* pursued federal funding; thinks "government contracting" = bureaucratic and not for her. Doesn't know SBIR exists or that it's non‑dilutive. **Needs:** a reason to care, proof she qualifies, and a no‑risk next step.
- **"Experienced Ed"** — has won an SBIR or two. Knows the pain: the BD time sink, the missed deadlines, the consultant invoices. **Needs:** proof you're faster/cheaper/better than his current stack (a monitoring service + a contractor + his own nights/weekends).

Today the site speaks ~80% to Ed and ~20% to Nadia. Your stated goal is **both**.

---

## 2. Page‑by‑page audit

Scorecard (1–5; 5 = launch‑excellent). "Fit" = how well it serves each persona.

| Page | Purpose clarity | Copy quality | Newcomer fit | Expert fit | Notes |
|---|---|---|---|---|---|
| `/` Home | 4 | 4 | 2 | 4 | Strong, ownable hero; jargon subhead loses Nadia; "Six stages" duplicates `/how-it-works`; no ROI anchor. |
| `/about` | 4 | 4 | 3 | 4 | Clean "Expert + AI + Automation + Collaboration = Win." Pillars are good. Slightly abstract for Nadia. |
| `/the-expert` | 5 | 5 | 4 | 5 | **The strongest page.** Eric's track record *is* the proof. Use it harder elsewhere. |
| `/value` | 3 | 4 | 2 | 3 | Describes the loop but never quantifies cost/ROI. This is where the $5k/10% math belongs. |
| `/engine` | 2 | 4 | 2 | 3 | Good thesis ("Expert+AI+Process=Win") buried under a 6‑step that **overlaps `/how-it-works`**. Re‑cast. |
| `/features` | 4 | 4 | 3 | 4 | Solid 8‑card grid. Feature‑led (what), not benefit‑led (so‑what). |
| `/how-it-works` | 4 | 5 | 3 | 4 | Best process page (detail + guardrails). Should be the *single* canonical journey. |
| `/pricing` | 4 | 4 | 3 | 4 | Transparent and honest. Lacks side‑by‑side vs. the alternatives; "Required subscription" framing is a small friction. |
| `/infosec` | 5 | 5 | 3 | 5 | Excellent, honest ("what we are / aren't yet"). Carries thesis weight — let it own "isolation." |
| `/apply` | 4 | 4 | 2 | 4 | Honest paywall framing. It's the *only* conversion path — too narrow for cold traffic. |
| `/team` | 3 | 3 | 3 | 3 | Empty‑state ("coming soon"). Fine pre‑launch; don't link prominently while empty. |
| `/customers` | 2 | 3 | 2 | 2 | Empty‑state. **Risk:** an empty "Customers" page signals "no customers." Hide from nav until populated, or repurpose as "Outcomes" (Eric's track record). |
| `/resources` | 3 | 4 | 3 | 3 | Good structure (Programs grid is genuinely useful for Nadia). Needs real content at launch or it reads thin. |
| `/resources/[slug]` | 4 | 4 | 4 | 4 | Clean article template, good OG/Twitter meta. Ready. |
| `/legal/*` | 5 | 5 | — | — | Versioned, acceptance‑tracked. Good. |

### Page notes that matter most

- **Home.** Hero "*A proposal engine, not a proposal gamble*" is excellent and ownable — **keep it.** But the subhead immediately uses "SBIR, STTR, BAA, and OTA" — alphabet soup that tells Nadia "not for me." The "Six stages" section is ~verbatim the `/how-it-works` journey (duplication). There is **no money/ROI moment** anywhere on the page.
- **The Expert.** This is your unfair advantage and the page proves it (hundreds of millions secured, $270M company, 22+ startups). **Right now its credibility is siloed on one page.** It should anchor the home hero and the pricing page ("the guy who charges $500/hr reviews your pipeline for $299/mo").
- **Engine vs. How‑It‑Works (the flagged overlap).** Diagnosis below in §3C. Confirmed and material.
- **Value.** The page *narrates* the flywheel but never lands a number. "The more you use it the better it gets" is true but soft. This is the natural home for the **cost‑of‑alternative** comparison.
- **Customers (empty).** An empty Customers page is worse than no page for a launch — it advertises the cold‑start. Recommend repurposing to **"Track Record / Outcomes"** (Eric's history, anonymized agency wins) until real logos exist.

---

## 3. Cross‑cutting findings

### A. The value/ROI gap — the #1 fix
The whole site answers "**what** is it" and "**how** does it work," but never "**what does it save me vs. what I do today.**" You handed us the most persuasive content on the site and it isn't on the site:

| What it replaces | Status quo cost | RFP Pipeline | The line |
|---|---|---|---|
| Active opportunity monitoring | **~$5,000 / month** (what you paid) | **$299 / month** (Spotlight) | "Curated monitoring for ~6% of what a monitoring service costs." |
| Proposal consultant | **10% of award** (a $1M Phase II ⇒ $100K) **or** $5–15K/mo retainer | **$999 / $1,999 flat**, no success fee | "Keep the $100K. Pay for the build, not a cut of your win." |
| In‑house BD hire | **$90–150K / yr** loaded | $299/mo + per‑proposal | "Your BD department, without the headcount." |
| Founder's nights & weekends | Your scarcest resource | Hours back | "Stop pulling your best engineer off the product to chase RFPs." |

This isn't a footnote — it's a **hero‑adjacent section** and arguably a recurring motif. (Numbers above are yours; mark any you want softened.)

### B. Newcomer on‑ramp gap
Nothing on the site does the job of: *"Federal agencies hand out **$4B+/year** in **non‑dilutive** R&D funding [verify exact figure before publishing]. It's grant‑like — you keep your equity and your IP. Most qualifying small businesses never apply because the process looks impenetrable. We make it accessible."* The word **"non‑dilutive"** alone will stop a venture‑wary founder cold — it's nowhere on the site. Newcomers need (1) the size of the prize, (2) "you probably qualify," (3) a no‑pay next step.

### C. Three overlapping "process" narratives (your wife's note — confirmed)
- **Home "Six stages":** Apply → Accepted → Onboard → Spotlight → Purchase Portal → Submit & Learn.
- **`/how-it-works` "Six stages":** the *same six*, with more detail + guardrails.
- **`/engine` "6‑step":** a *different* six — Source Scout Finds → Expert Curates → AI Structures → Customer Writes → AI Assists → Expert Reviews — **plus** three "differentiators" (Isolation / Human‑in‑the‑Loop / Stage‑Gated) that **duplicate** `/how-it-works`'s three guardrails **and** `/infosec`.

To a visitor, `/engine` and `/how-it-works` look like **two siblings of the same template** (numbered cards, same rhythm) covering overlapping ground. That's exactly the "too close in content and style" read. **Recommendation (§5):** one canonical *journey* (`/how-it-works`) + re‑cast `/engine` as *the model / why it wins* with a **different visual shape** (diagram/manifesto, not a numbered list).

### D. Thematic repetition
"Isolated AI / your data only," "human‑in‑the‑loop / AI drafts, expert verifies," and "stage‑gated quality" each appear on **home, engine, features, how‑it‑works, infosec, value**. Repetition without escalation reads as padding. Pick the **owner page** for each (isolation → `/infosec`; HITL → `/engine`/model; stage‑gating → `/how-it-works`) and reduce the rest to a single referencing line.

### E. CTA architecture is single‑lane
Every CTA on every page is "**Apply Now**," which lands on a **$299/mo paywall** ("no free trial"). That's correct for high‑intent Ed, but it **leaks 100% of not‑ready Nadias**. You already have a **waitlist API + table** — add a **soft secondary CTA** ("See if you qualify" / "Get the Federal R&D starter guide" → waitlist/email) so top‑of‑funnel converts to a *lead* instead of bouncing.

### F. Social proof vacuum (cold start)
No customers yet; `/customers` and `/team` are empty. **Don't fake it.** Convert the vacuum into the brand's strength: **the expert is the proof** + **founding‑cohort scarcity** ("20 seats, applications reviewed weekly"). Consider an honest "agencies we've won with" strip (DoD, NSF, DOE, DARPA) tied to Eric's *track record*, clearly framed as his history.

### G. Voice (keep it — it's good)
Short sentences, confident, refreshingly honest ("we are not SOC 2 yet"). That voice is an asset; protect it. The only fix is **leading with jargon** before the reader has a reason to learn it.

---

## 4. Information‑architecture recommendation

Proposed top‑nav (Platform dropdown): **Why RFP Pipeline** (new — the value/ROI + newcomer hook) · **How It Works** (the journey) · **The Model** (re‑cast `/engine`) · **Features** · **The Expert** · **Pricing**. Keep **About, Resources, Security**. Replace **Customers** in the footer with **Track Record** until real customers exist.

This gives each persona a lane: Nadia → *Why RFP Pipeline* → *Federal R&D 101*; Ed → *Pricing* / *How It Works* → *Apply*.

---

## 5. Recommendations

### 5a. Small tweaks (copy/messaging cleanup — quick wins, low risk)
1. **Home subhead:** lead benefit before jargon. e.g. *"Win non‑dilutive federal R&D funding — without burning a month of payroll on every submission. (SBIR, STTR, BAA, OTA.)"* Put the acronyms in a parenthetical, not the promise.
2. **Home:** add one **ROI line** near the hero or stats bar: *"Replaces a $5,000/mo monitoring service and a 10%‑of‑award consultant — for $299/mo and a flat per‑proposal fee."*
3. **Pricing:** add a compact **"vs. the alternatives"** comparison row above the tiers (status‑quo cost → our cost). Reframe "**Required** subscription" → "**Start with Spotlight**" (less gating, more on‑ramp).
4. **The Expert → Pricing link:** add a one‑liner on Pricing: *"The expert who charged $500/hr reviews your pipeline as part of $299/mo."*
5. **De‑dupe:** trim the isolation/HITL/stage‑gate repeats on `/features` and `/value` to single referencing lines pointing to their owner pages.
6. **Customers page:** hide from nav while empty (or repurpose to Track Record).
7. **CTA pass:** keep "Apply Now" primary; add a soft secondary ("See if you qualify →") site‑wide.
8. **Resources:** ensure ≥3 real articles live at launch (esp. one newcomer‑facing "What is SBIR and are you eligible?").

### 5b. Significant additions (new value‑prop / CTA sections)
1. **"The cost of doing it the old way" section** (home + `/value`): the comparison table from §3A, designed as a NYC‑ad‑house money moment — big numbers, stark contrast, one‑line payoff.
2. **Newcomer hook band** (home, above or below the hero): *"New to federal R&D? There's billions in non‑dilutive funding and you probably qualify."* → soft CTA to *Federal R&D 101*.
3. **Re‑cast `/engine` → "The Model / Why It Wins":** a manifesto + a single **diagram** (Expert ⟷ AI ⟷ Process, the moat: isolation, accountability, structure, the compounding flywheel). Kill the numbered 6‑step (it lives on `/how-it-works`). Different shape, different job.
4. **Dual‑path hero option** on home: a single sharp promise with two routes beneath — *"New to this → Start here"* / *"I run BD already → See the math."*

### 5c. New page(s)
1. **`/why` (or "Why RFP Pipeline")** — the consolidated value page: cost‑of‑status‑quo, the math, the flywheel ROI, dual‑audience. This becomes the workhorse conversion page and the home for the $5k/10% argument. *(Could be the re‑cast `/value`.)*
2. **`/federal-rd-101` (newcomer guide)** — what SBIR/STTR is, "non‑dilutive" explained, the size of the prize, eligibility checklist, "is this you?", soft CTA → waitlist/guide. The on‑ramp Nadia needs.
3. *(Optional, post‑launch)* an **interactive "What could you win?" / eligibility quiz** → waitlist lead. High‑intent capture for cold traffic.

---

## 6. Implementation plan + TODOs

### Phase 0 — Pre‑(paid)‑launch must‑do (≈1–2 focused days)
- [ ] **ROI/cost‑of‑status‑quo section** (home + value). Verify/lock the $ figures you're comfortable publishing.
- [ ] **Newcomer hook band** on home + soft secondary CTA wired to the **existing waitlist**.
- [ ] **Home subhead rewrite** (benefit before acronyms) + one ROI line.
- [ ] **Customers page**: pull from nav or repurpose to Track Record (avoid the empty‑page signal).
- [ ] **≥3 real Resources articles**, incl. one newcomer‑facing eligibility piece.
- [ ] Confirm `IPINFO_TOKEN` + migration 058 are live so analytics capture cold‑traffic from day one.

### Phase 1 — Launch polish (≈2–3 days)
- [ ] **Re‑cast `/engine` → "The Model"** (manifesto + diagram; remove the numbered 6‑step).
- [ ] **De‑dupe** isolation/HITL/stage‑gate across features/value (single referencing lines).
- [ ] **Pricing "vs. alternatives"** comparison block + "Start with Spotlight" reframe + Expert→Pricing line.
- [ ] **New `/why`** consolidated value page (or upgrade `/value`); point nav + CTAs at it.
- [ ] Tighten home "Six stages" to a *teaser* that links to the canonical `/how-it-works` (remove the near‑duplicate full list).

### Phase 2 — Post‑launch optimization (data‑driven)
- [ ] **`/federal-rd-101`** newcomer guide + lead magnet (guide PDF/email).
- [ ] Eligibility quiz → waitlist.
- [ ] A/B the hero (single promise vs. dual‑path) using the new analytics.
- [ ] Add real customer outcomes to `/customers` as the cohort produces wins.
- [ ] Logo/agency strip once defensible.

---

## 7. Launch‑readiness verdict

| Dimension | Rating | Note |
|---|---|---|
| Visual design / polish | **Launch‑ready** | Clean, consistent, professional. |
| Trust / credibility | **Strong** | Expert story + honest security page are differentiators. |
| Technical/SEO hygiene | **Good** | OG/Twitter meta on articles, redirects in place, analytics now instrumented. |
| Newcomer conversion | **Not ready** | No on‑ramp, no "non‑dilutive," jargon‑first. |
| Value/ROI persuasion | **Not ready** | Feature‑led; the cost‑anchor argument is absent. |
| Process clarity | **Needs work** | Three overlapping process narratives. |
| CTA / funnel | **Single‑lane** | Everything → $299 paywall; no soft capture for not‑ready leads. |

**Go / no‑go:** **Soft‑launch GO** for warm/referral traffic now. **Hold paid/cold acquisition** until Phase 0 ships (the ROI section, the newcomer hook, and the soft CTA) — those three changes are where the conversion is.

---

---

## 8. Build log (round 2 — implementation in progress)

Each entry = one pushed, individually-revertable commit. Working through the §6 TODOs.

- _(in progress — entries appended as commits land)_
