# Gmail Setup — service-account delegation (send-as + sweep) for rfppipeline.com

This wires the **one credential** that turns on the whole email engine: sending *as*
`platform@` / `eric@` / `automation@`, sweeping their inboxes for replies, and the nudge/template
system. The code is already built (`services/cms/src/workers/gmail_client.py`) — this is the
external Google setup + config. Do it once. ~20 min.

The client auto-detects the mode: if `GOOGLE_SERVICE_ACCOUNT_JSON` is set it uses **service-account
domain-wide delegation** (`from_service_account_info(...).with_subject(delegate_email)`) — that's
the one that can impersonate *multiple* mailboxes. Scopes it requests:
`gmail.send` + `gmail.readonly` + `gmail.modify`.

---

## Part 1 — Google Cloud: create the service account + key

1. **console.cloud.google.com** → pick (or create) a project for RFP Pipeline.
2. **APIs & Services → Library → enable the "Gmail API"** for the project.
3. **IAM & Admin → Service Accounts → Create service account.**
   - Name: `rfp-gmail-delegate` (any). **No project roles needed** — delegation is granted in
     Workspace, not via IAM. Click Done.
4. Open the new service account → **note its "Unique ID" (a long numeric Client ID)** — you need it
   in Part 2.
5. **Keys tab → Add key → Create new key → JSON → Create.** A `.json` file downloads. **That file's
   entire contents are `GOOGLE_SERVICE_ACCOUNT_JSON`** (Part 3). Store it safely; it's a secret.

## Part 2 — Google Workspace admin: domain-wide delegation

(Requires a Workspace super-admin on rfppipeline.com.)

1. **admin.google.com → Security → Access and data control → API controls → Domain-wide delegation
   → Manage domain-wide delegation → Add new.**
2. **Client ID** = the service account's numeric **Unique ID** from Part 1.4.
3. **OAuth scopes** — paste EXACTLY these three, comma-separated:
   ```
   https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.modify
   ```
4. **Authorize.** This is what lets the service account act as any `@rfppipeline.com` user for
   send + read + modify.
5. **Make sure the mailboxes exist** in Workspace (real boxes or aliases): `platform@`, `eric@`
   (you have these), `automation@` (create — the "robot" voice for nudges/alerts), and optionally
   `cms_gmail_service@`.

## Part 3 — Railway env (set on the **CMS** service)

```
GOOGLE_SERVICE_ACCOUNT_JSON = <paste the ENTIRE JSON file contents from Part 1.5, verbatim>
GOOGLE_WORKSPACE_EMAIL      = platform@rfppipeline.com     # default mailbox to send-as / impersonate
SENDER_AUTOMATION_EMAIL     = automation@rfppipeline.com   # robot voice: nudges, alerts, sweeps
SENDER_ENGAGEMENT_EMAIL     = eric@rfppipeline.com         # human voice: onboarding, campaigns, replies
SENDER_CMS_SERVICE_EMAIL    = cms_gmail_service@rfppipeline.com   # optional
ADMIN_NOTIFICATION_EMAIL    = <where admin alerts land>
```
- Paste the JSON as a **single value** (the downloaded file already `\n`-escapes the private key;
  `json.loads` reads it fine). If Railway's editor mangles the newlines, use the file variant
  instead: mount the JSON as a file and set `GOOGLE_SERVICE_ACCOUNT_PATH=/path/to/sa.json`.
- **Redeploy the CMS service** after setting these.
- (The frontend welcome-email path can keep using its own OAuth vars, or you can leave it on
  `RESEND_API_KEY` — the CMS service-account path above is what powers sweep + multi-mailbox.)

## Part 4 — DNS on rfppipeline.com (deliverability — or mail lands in spam)

| Record | Host | Value |
|--------|------|-------|
| **SPF** (TXT) | `@` | `v=spf1 include:_spf.google.com ~all` |
| **DKIM** (TXT) | `google._domainkey` | generate in Admin console → **Apps → Google Workspace → Gmail → Authenticate email**, then publish the TXT it gives you |
| **DMARC** (TXT) | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@rfppipeline.com` (start at `p=none` to monitor, tighten to `p=quarantine` once clean) |

## Part 5 — Turn on the inbox sweep (register each mailbox)

The `email_sweep` worker (runs every 5 min) monitors every **sweep-enabled** row in `email_accounts`
via the Gmail History API. Register one row per mailbox you want swept. Against the CMS API
(`/api/email`, behind the CMS auth header):

```bash
# platform@ — the automation/sweep box
curl -X POST "$CMS_URL/api/email/accounts" -H "Authorization: Bearer $CMS_API_KEY" \
  -H 'content-type: application/json' -d '{
    "email_address":"platform@rfppipeline.com","display_name":"Platform",
    "account_type":"sweep","credentials_type":"service_account",
    "delegate_subject":"platform@rfppipeline.com","sweep_enabled":true }'

# eric@ — the human engagement box
curl -X POST "$CMS_URL/api/email/accounts" -H "Authorization: Bearer $CMS_API_KEY" \
  -H 'content-type: application/json' -d '{
    "email_address":"eric@rfppipeline.com","display_name":"Eric",
    "account_type":"sweep","credentials_type":"service_account",
    "delegate_subject":"eric@rfppipeline.com","sweep_enabled":true }'
```
`delegate_subject` = the mailbox the service account impersonates for that account. Set
`sweep_enabled:false` on any box you want to send-as but not read.

## Part 6 — Verify

1. **Send** — test-send a template to your own inbox (arrives *as* `platform@`, no HITL):
   ```bash
   curl -X POST "$CMS_URL/api/email/templates/<templateId>/test-send" \
     -H "Authorization: Bearer $CMS_API_KEY" -H 'content-type: application/json' \
     -d '{"to_email":"you@example.com"}'
   ```
   PASS = it arrives, and the response carries a `gmail_message_id` (not an error / skip).
2. **Sweep** — reply to that email from another account. Within ~5 min the sweep worker records an
   engagement event and (for an uninterpreted reply) queues it for classification. Confirm a new
   `email` event / thread-state update in the CMS DB.
3. **Multi-mailbox** — a message routed to the `engagement` identity should go out **as `eric@`**
   (sender resolution: `payload.fromIdentity` / namespace / template heuristic → see
   `docs/EMAIL_SENDERS.md`).

Once send + sweep both pass, the nudge/final-notice/onboarding/reply engine is live on real
mailboxes — and the same delegation is what social posting will extend later.
