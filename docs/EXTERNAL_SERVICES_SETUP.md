# External services — step by step, staging and production

**Scope:** every account and credential outside Railway. Ordered so nothing waits on something you
could have started earlier.
**Companions:** `docs/STAGING_ENVIRONMENT.md` (the environment itself) ·
`docs/SECRETS_INVENTORY.md` (what every variable is for) · `docs/EMAIL_INTERFACE_DESIGN.md`.

---

## 0 · Are three enough?

**Yes — three are required. There is a fourth that is a decision, not a blocker.**

| Service | Status | Why |
|---|---|---|
| **Anthropic** | **required** | every AI path: drafting, shredding, compliance and colour-team review, opportunity analysis, CMS content |
| **Postmark** | **required** | all transactional mail, bounce webhooks, the suppression list |
| **Google Workspace** | **required** | correspondence (a human emailing a human) *and* the inbox sweep — neither of which Postmark can do |
| **Voyage AI** | **a decision** | semantic atom retrieval. See below — this one is easy to get wrong by omission |

### The Voyage decision, stated plainly

`lib/embeddings.ts` has three states, not two:

- **Voyage** (`VOYAGE_API_KEY` set) — real neural semantics. The production intent.
- **Local** (`ATOM_EMBED=local`) — a deterministic hashed-n-gram embedder. **Lexical, not neural**: it
  clusters by shared vocabulary and character-grams, not meaning. It exists to prove the whole vector
  pipeline with no key and no data leaving the box.
- **Disabled** (default, and what you get if you set neither) — `selectForSection` is *exactly the
  pre-vector selector*. Semantic retrieval is **off**, not degraded.

So shipping V1 without a Voyage key does not degrade atom retrieval — it **switches the feature off**,
silently and by default. That may be the right call for launch. It should be a choice.

### Explicitly NOT needed

| | Why not |
|---|---|
| **Resend** | it is a *fallback inside the Gmail driver*, reached only when no Google credentials exist. Configure Google and it is unreachable. |
| **OpenAI** | only if you set `EMBEDDINGS_PROVIDER=openai`. Leave the provider unset. |
| **ipinfo** | geo enrichment on sign-in events; unset, the feature no-ops |
| **Stripe** | self-serve checkout is descoped — the comp code `rfppipelinetest` is the launch mechanism |
| **SAM.gov** | dropped. DSIP is public and keyless, and is the recommended discovery source |
| **Cloudflare R2** | provisioned by Railway's bucket service; credentials injected, no account of your own |

---

## 1 · Order of operations

DNS propagates on its own schedule and everything in Postmark waits on it, so it goes first even
though it is the least interesting step.

```
1  DNS records                    ← start here, then walk away
2  Anthropic workspaces + keys    ← can be done while DNS propagates
3  Postmark servers + webhooks    ← needs DNS verified
4  Google credentials             ← two different kinds; see §4
5  Set variables in Railway
6  Verify, per service
```

---

## 2 · DNS — do this first

One record set, serving **both** senders.

| Record | Host | Value |
|---|---|---|
| **SPF** (TXT) | `@` | `v=spf1 include:_spf.google.com include:spf.mtasv.net ~all` |
| **DKIM** (TXT) | Workspace-generated | from Google Admin → Apps → Gmail → Authenticate email |
| **DKIM** (TXT) | Postmark-generated | from Postmark → Sender Signatures → `rfppipeline.com` |
| **Return-Path** (CNAME) | Postmark-generated | same screen |
| **DMARC** (TXT) | `_dmarc` | start `v=DMARC1; p=none; rua=mailto:dmarc@rfppipeline.com`, tighten later |

> ⚠️ **BOTH SPF includes.** Google carries the correspondence, Postmark carries the transactional,
> and a record naming only one silently fails SPF for the other. It does not bounce — it lands in
> spam, so the failure is invisible from the sending side and reads as a deliverability mystery.
> Three documents in this repo carried the Google-only record until it was corrected.

**Two DKIM records is correct**, one per sender. They do not conflict — each is on its own selector.

**Staging:** if you want §6's deliverability check to mean anything, add a
`staging.rfppipeline.com` CNAME. Without it a Railway subdomain works for everything except DMARC
alignment.

---

## 3 · Anthropic

### Production
1. console.anthropic.com → **Workspaces** → create `production` (or use the default).
2. Create an API key **inside that workspace**.
3. Set a **monthly spend limit**. Pick a number you would be unhappy to exceed, not one you expect to
   reach — this cap and the platform's own `platform_agent_config.platform_monthly_cap` are two
   independent mechanisms, and the value of two is that they fail independently.
4. Set `ANTHROPIC_API_KEY` on **all three services**: frontend, pipeline, rfp-crm.

### Staging
1. A **separate workspace** named `staging`, with its own key.
2. **Spend limit $50.** That matches the platform default tenant budget, so the provider cap and the
   product cap agree; on the measured figures (`docs/AGENT_SPEND_AND_CAPS.md`) it is 30–40 full
   proposal builds.
3. Same variable, all three services.

### Both
- Leave **`ANTHROPIC_BASE_URL` unset.** Set, it points the SDK at the local emulator — and staging
  would run canned text while looking entirely healthy.
- `CLAUDE_MODEL` / `SHREDDER_MODEL` / `VISION_MODEL` have working defaults; set only to override.

---

## 4 · Postmark

You are on **Pro** — 10,000 emails/month, inbound processing, 10 servers, 30 streams, $1.30/1,000
overage.

### Once, for the account
1. **Sender Signatures → add domain `rfppipeline.com`.** Publish the DKIM TXT and Return-Path CNAME
   it generates (§2). Wait for *Verified* before going further.
2. Confirm with support: **do Sandbox-server sends count against the monthly quota?** If they do, a
   heavy staging drive eats production's allowance.

### Production server
1. **Servers → Create Server** → `rfp-production`, type **Live**.
2. **API Tokens** tab → copy the **Server API Token**. *Not* the Account token — that mix-up is
   documented in the driver's own header because it is the easy mistake.
3. **Webhooks → Add webhook** → `https://www.rfppipeline.com/api/webhooks/postmark`
   - subscribe to **Bounce** and **SpamComplaint**
   - authenticate with your generated `POSTMARK_WEBHOOK_SECRET`, as either the Basic-auth password or
     `?token=<secret>` on the URL — the route accepts both shapes
4. No message stream to create. The code sends `outbound`, which every server has by default
   (`POSTMARK_MESSAGE_STREAM` overrides it and should stay unset).

### Staging server
Identical, with two changes:
1. Create it as a **Sandbox** server — it accepts every message and delivers none. This is the only
   layer that holds regardless of what addresses end up in the staging database.
2. Webhook points at the staging host.

> The webhook path is already in the middleware allowlist, so it is reachable unauthenticated by the
> middleware and authorised by the handler. Postmark does not sign webhooks — that secret **is** the
> authorization.

---

## 5 · Google Workspace — **two different credential types**

This is the step that catches people. The frontend and the CRM authenticate to Google in
**different ways**, and configuring one does not configure the other.

| | Reads | Gives you |
|---|---|---|
| **Frontend** (`lib/email/drivers/gmail.ts`) | `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` · `GOOGLE_REFRESH_TOKEN` | **OAuth** — send-only, one mailbox |
| **CRM** (`workers/gmail_client.py`) | `GOOGLE_SERVICE_ACCOUNT_JSON` | **Service account + domain-wide delegation** — send-as *and read* any mailbox |

The CRM auto-detects: service-account JSON if present, otherwise it falls back to the OAuth
credentials. **Full function needs both.**

### Production — service account (the CRM: sweep + multi-mailbox send)
1. Google Cloud console → new project (or existing) → **IAM → Service Accounts → Create**.
2. **Keys → Add key → JSON.** That file's contents are `GOOGLE_SERVICE_ACCOUNT_JSON`. Note the
   service account's **Client ID** (numeric).
3. Google **Admin** console → Security → Access and data control → **API controls → Domain-wide
   delegation → Add new**. Client ID from step 2, scopes:
   ```
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.modify
   ```
4. Provision the mailboxes it will act as: `platform@`, `automation@`, `eric@`, `content@`, `blog@`.
   (The sweep watches `content@` and `blog@` for `[CONTENT REQUEST]` subjects.)
5. Set `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_WORKSPACE_EMAIL=platform@rfppipeline.com` on
   **rfp-crm**.

### Production — OAuth (the frontend: correspondence)
1. Same Cloud project → **APIs & Services → OAuth consent screen** (Internal, since it is your own
   Workspace) → **Credentials → Create OAuth client ID → Web application**.
2. Perform a one-time authorization as the sending mailbox with the `gmail.send` scope, and keep the
   **refresh token** it returns.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_WORKSPACE_EMAIL`
   on **frontend**.

### Staging — recommended: **skip Google entirely, at first**

There is one Workspace domain. A staging service account with domain-wide delegation can impersonate
and read your **real** mailboxes, which is how staging comes to email real people and read real mail.

So leave `GOOGLE_SERVICE_ACCOUNT_JSON` and the OAuth trio **unset in staging**:

- transactional mail → Postmark Sandbox ✓
- correspondence → fails cleanly with *"No email provider configured"*, recorded in the ledger. A
  visible failure, not a silent one.
- the sweep → no enabled accounts, the worker idles

**When you do want to exercise correspondence and the sweep on staging**, do it the safe way: a
dedicated `staging@rfppipeline.com` mailbox, its own service account, delegation scoped to that
mailbox, and `sweep_enabled = TRUE` on that account only.

---

## 6 · The variable matrix

| Variable | Service(s) | Production | Staging |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | all three | production workspace key | **staging workspace key** |
| `ANTHROPIC_BASE_URL` | — | **unset** | **unset** |
| `EMAIL_DRIVER` | frontend, rfp-crm | `postmark` | `postmark` |
| `POSTMARK_SERVER_TOKEN` | frontend, rfp-crm | live server token | **sandbox server token** |
| `POSTMARK_WEBHOOK_SECRET` | frontend | generated | **separately generated** |
| `POSTMARK_MESSAGE_STREAM` | — | unset (`outbound`) | unset |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | rfp-crm | the SA key JSON | **unset** (§5) |
| `GOOGLE_CLIENT_ID/_SECRET/_REFRESH_TOKEN` | frontend | OAuth trio | **unset** (§5) |
| `GOOGLE_WORKSPACE_EMAIL` | frontend, rfp-crm | `platform@rfppipeline.com` | unset |
| `VOYAGE_API_KEY` | frontend | set, **or** decide `ATOM_EMBED=local`, **or** accept retrieval off | same decision |
| `ADMIN_NOTIFICATION_EMAIL` | frontend, rfp-crm | a mailbox you read | a mailbox you read |

---

## 7 · Verify, per service

### Anthropic
Fire one full draft and watch `agent_task_log`: a row per invocation with real token counts. Then
compare the spend against the prior — **$1.00–$1.40 for a Phase I, $1.20–$2.30 for a Phase II**
(`docs/AGENT_SPEND_AND_CAPS.md`), and re-measure with
`node frontend/scripts/estimate-full-build-cost.mts` so the estimate is replaced by a measurement.

### Postmark
1. **Send one** → `email_send_ledger` shows reserve → dispatch → confirm. Reserving *before* dispatch
   is what makes a crash mid-send visible instead of invisible.
2. **Hard-bounce one deliberately** → the webhook writes an `email_suppressions` row → the next send
   to that address is refused.
3. **Soft-bounce one** → must **not** suppress. This is the check that proves the classifier works
   rather than only the plumbing — a suppression list that suppresses everything passes a
   suppression-only test.
4. Read the received headers: **SPF, DKIM and DMARC all aligned.** This is what catches a
   half-propagated DNS record.

### Google
1. Send one `correspondence` message and confirm it lands in the sending mailbox's **Sent folder** —
   that is the whole reason this path is not on Postmark.
2. Reply to it and confirm the sweep picks the reply up within its 5-minute interval.
3. Send one to `content@` with a `[CONTENT REQUEST]` subject and confirm it is detected.

### Voyage (if you enable it)
Confirm `atom_embeddings` rows carry `model = voyage-…` rather than the local engine id. The selector
only ever compares within one model, so a mixed table is not a corruption — but it does mean half your
atoms are outside the semantic axis.
