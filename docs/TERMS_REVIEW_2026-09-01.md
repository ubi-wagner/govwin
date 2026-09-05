# Terms & Conditions — review and revision

**Reviewed 2026-09-01** against `frontend/lib/terms.ts` (`v3-2026-07-platform`), the four
`/legal/*` pages, and the code that actually moves customer data.

> ⚠️ **I am not a lawyer and this is not legal advice.** What follows is an engineering-grade
> review: factual claims checked against the source, structural gaps measured against what
> comparable AI/SaaS terms carry, and drafting proposed for counsel to accept, reject or rewrite.
> **Nothing here should bind a customer until a licensed attorney in Ohio has reviewed it.** The
> factual corrections in §1 are the part you should act on regardless of legal review, because they
> are simply wrong today.

---

## 1. FACTUAL ERRORS — these are wrong right now

These are not drafting opinions. They are statements in published legal pages that the code
contradicts, and a subprocessor disclosure that is wrong is worse than none: it is an affirmative
misstatement about where a customer's data goes.

### 1a. The AI disclosure names a provider we do not use, and omits the one we do

`/legal/ai-disclosure` lists **"OpenAI Embeddings: Used for semantic search within the content
library"** and says *"Our AI providers (Anthropic, OpenAI) process your data…"*.

Measured from source, every third-party endpoint that receives customer data:

| endpoint | what it processes | disclosed? |
|---|---|---|
| `api.anthropic.com` | prompts, document text | ✅ yes |
| `api.voyageai.com` | library atom text, for embeddings | ❌ **no** |
| `api.postmarkapp.com` | recipient addresses, message bodies | ❌ **no** |
| `api.resend.com` | same, fallback path | ❌ **no** |
| Google Gmail API | correspondence mail | ❌ **no** |

The frontend embedding path is **Voyage** (`voyage-3.5`, `lib/embeddings.ts`). OpenAI appears in
exactly one place — `pipeline/src/agents/embeddings.py`, a lazy import gated on both
`EMBEDDINGS_PROVIDER=openai` and `OPENAI_API_KEY`, neither set. So the disclosure names a
subprocessor that receives nothing and omits four that receive something.

### 1b. The privacy page's subprocessor list is incomplete, and names the wrong storage vendor

It lists *"Stripe (payments), Railway (infrastructure), AWS (storage), Anthropic (AI processing) —
each bound by data processing agreements."*

* **Storage is Cloudflare R2**, not AWS. The bucket is S3-*compatible*; the vendor is different, and
  a subprocessor list names vendors, not protocols.
* Voyage, Postmark/Resend and Google are missing, as above.
* **"each bound by data processing agreements"** is an affirmative representation that a signed DPA
  exists with every named vendor. Verify that before launch — it is the kind of statement that is
  cheap to make true and expensive to have made falsely.

### 1c. §11(a) states a price the site may not match

The terms fix the Founding Cohort subscription at **$499/month**. The `/apply` page states the same
figure, so they agree today — but the price lives in two places and only one is contractual. If
pricing moves, the terms are the binding number.

---

## 2. LIABILITY GAPS — what comparable AI/SaaS terms carry and these do not

Ordered by how much exposure each closes.

### 2a. The liability cap has no carve-outs, which is what makes caps fail

§9 caps everything at 12 months' fees with **no exclusions**. Standard practice carves out gross
negligence, wilful misconduct, death or personal injury, and the customer's indemnification
obligations — because a cap that purports to limit *everything* is the kind courts strike down
entirely, taking the protection with it. There is also no **savings clause** for failure of
essential purpose. *Recommend: add carve-outs and a savings clause.*

### 2b. No confidentiality obligation running to the customer

§5 takes a licence over customer content. Nothing anywhere commits RFP Pipeline to keep it
confidential. For a platform whose users upload unpublished SBIR technical approaches, that is both
a liability gap and a **sales objection** — a sophisticated customer's counsel will ask for it.
*Recommend: a mutual confidentiality section.*

### 2c. No prohibition on controlled data — the domain-specific risk

Customers pursue DoD work. Nothing forbids uploading **ITAR / EAR-controlled technical data, CUI, or
classified information**, and nothing warrants that they will not. If a customer uploads ITAR
technical data to a platform with foreign-national access or non-compliant storage, the violation is
regulatory, not contractual, and a limitation-of-liability clause does not reach it. *Recommend: an
express prohibition plus a customer warranty and indemnity. This is the single most important
addition for this business.*

### 2d. The no-training commitment lives only on a marketing page

`/legal/ai-disclosure` promises *"Your data is not used to train their AI models."* That is the
commitment customers care about most and it is **not in the binding agreement** — while §13(b),
which IS binding, permits "de-identified, aggregated insights." *Recommend: state the no-training
commitment in the terms, and make §13(b)'s boundary explicit so the two cannot be read against each
other.*

### 2e. AI output: no allocation of IP risk

§5(d) says we do not claim ownership. It does not address that AI output may be uncopyrightable,
may resemble third-party material, and that the customer bears the risk on submission. *Recommend:
say so plainly.*

### 2f. Arbitration clause is missing its two working parts

§15 sends disputes to AAA arbitration in Ohio, with **no class-action waiver** — which is the
main reason to have the clause — and **no opt-out window**, which several courts treat as a factor
in enforceability. It also omits a small-claims carve-out and injunctive-relief reservation.

### 2g. Missing boilerplate that is cheap and load-bearing

**Severability** (without it, striking the arbitration clause or the cap can endanger the rest),
**survival** (which sections outlive termination), **force majeure**, **assignment**, **notices**,
**no waiver**, **export control / OFAC**, **U.S. Government rights**, and **third-party beneficiary
disclaimer**. Any one of these is routine; the absence of all of them is what makes an agreement
look drafted from a template rather than for a business.

### 2h. §16 unilateral modification is weak as written

*"May modify at any time… continued use constitutes acceptance"* has been struck in several
jurisdictions where the change was material and notice was thin. The existing 30-day email notice
is good; pairing it with a right to terminate without penalty during the notice period is what
makes it hold.

### 2i. §10(d) commits to 72-hour breach notification

Stricter than most U.S. state law requires, and self-imposed. It is defensible as a trust signal
but it is a contractual deadline you must meet from *discovery*. Consider "without undue delay and
in any event as required by applicable law" unless the 72 hours is a deliberate differentiator.

---

## 3. WHAT IS ALREADY GOOD

Worth saying, because most of this document is criticism:

* **§3 (Your Final Review Responsibility)** is unusually strong and unusually honest — *"We make
  mistakes. AI output can be inaccurate or fabricated"* — and it is the correct posture for an AI
  drafting tool. Most comparable terms bury this.
* **§6 (Shadow Access)** discloses admin oversight *and* the opt-out *and* the consequence of
  opting out. Many platforms with support impersonation never disclose it at all.
* **§4** places user-access responsibility on the customer admin clearly.
* **One source of truth**: `/legal/terms` renders `TERMS_TEXT` directly, so the published page and
  the accepted agreement cannot drift. Keep that.
* The application form's **scroll-to-accept + email signature** is real assent evidence —
  `terms_accepted_at` and `terms_version` are stored per application. That is better than a
  checkbox and materially better than most.

---

## 4. WHAT CHANGED IN THIS REVISION

Version **`v3-2026-07-platform` → `v4-2026-09-platform`**.

⚠️ **Existing acceptances are of v3 and stay that way.** `applications.terms_version` records what
each applicant actually signed; do not backfill it. Anyone who accepted v3 is bound by v3 until they
accept v4 through the §16 notice process.

Added: **§5(e)** no-training commitment · **§5(f)** AI output and IP risk · **§8(f)** no
representation about FAR/DFARS, eligibility or agency acceptance · **§10(e)** controlled-data
prohibition and warranty · **§11 (new)** mutual confidentiality · **§16(b)–(d)** liability
carve-outs and savings clause · **§21** class-action waiver, opt-out window, small-claims and
injunctive carve-outs · **§23–§29** severability, survival, force majeure, assignment, notices, no
waiver, export control, U.S. Government rights, third-party beneficiaries.

Amended: **§13(b)** aggregate-insights boundary made explicit · **§22** modification paired with a
termination right during the notice period.

---

## 5. BEFORE THIS BINDS ANYONE

1. **Ohio counsel reviews the whole document.** Particularly §16 (carve-outs), §21 (arbitration and
   class waiver) and §10(e) (controlled data) — the three places where getting it wrong costs the
   most.
2. **Fix the subprocessor lists** (§1a, §1b above). Independent of legal review; they are factually
   wrong today.
3. **Confirm the DPAs exist** with every vendor the privacy page names, or soften the claim.
4. **Decide on the 72-hour breach commitment** (§2i).
5. Consider whether any customer could be a **sole proprietor** — if so, consumer-protection rules
   may reach the arbitration clause and the non-refundable term.
