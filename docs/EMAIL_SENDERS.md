# Email Sender Identities

How the platform decides which **From** address an outbound email is sent as, and
the external (Google Workspace / DNS) setup required to make those addresses
deliverable. This is the **abstraction + config** layer; provisioning and the
inbound reply sweep are tracked separately (see *Deferred* at the bottom).

---

## The identities

| Key           | Default address                     | Voice / purpose |
|---------------|-------------------------------------|-----------------|
| `automation`  | `automation@rfppipeline.com`        | System/automation traffic — workflow NOTIFY steps, admin alerts, HITL nudges, analysis sweeps. The "robot." |
| `engagement`  | `eric@rfppipeline.com` (or `heather@`) | Human-facing traffic — customer onboarding, campaigns/drips, reply responses. The "person." |
| `cms_service` | `cms_gmail_service@rfppipeline.com` | Delegated service mailbox for CMS-originated automation where a distinct service identity is wanted. |

`automation@` / `admin@` is the mirrored real box used for the cross-stakeholder
sweeps and HITL-response-trigger checks; `eric@` / `heather@` are real human boxes
used for campaigns, onboarding, and responses (plus LinkedIn/social later).

## Configuration (env)

All addresses are env-overridable with the defaults above. Set these on the CMS
service (and anywhere `services/cms/src/sender_identity.py` is imported):

```
SENDER_AUTOMATION_EMAIL=automation@rfppipeline.com
SENDER_ENGAGEMENT_EMAIL=eric@rfppipeline.com
SENDER_CMS_SERVICE_EMAIL=cms_gmail_service@rfppipeline.com
```

Legacy fallback: if `SENDER_AUTOMATION_EMAIL` is unset, `automation` falls back to
`GOOGLE_WORKSPACE_EMAIL` (the previous single-sender var), so existing deployments
keep working until the new vars are set.

## Admin-editable addresses (CRM DB)

The addresses are also stored in the CRM database in `sender_identities`
(migration `services/cms/db/009_sender_identities.sql`), so an admin can change a
From address — or add a new identity key — without a redeploy. The CMS event
listener loads the table at startup and refreshes it every 5 minutes. Resolution
precedence is:

    explicit env var  >  sender_identities row (active)  >  hardcoded default

i.e. env stays the per-deploy ops override, the table is the live config, and the
hardcoded defaults are the last resort. Custom keys added to the table are
selectable via a notification's `payload.fromIdentity`.

## How a message is mapped to an identity

`resolve_sender()` (`services/cms/src/sender_identity.py`) picks the address by this
priority, and **fails safe** — if nothing matches it returns the caller's current
sender (`_SEND_AS`), so an unmapped message never changes sender unexpectedly:

1. **Explicit hint** — `payload.fromIdentity` = `automation` | `engagement` | `cms_service`.
2. **Originating namespace** — `payload.senderNamespace`: `capture` and `identity`
   → `engagement`; `finder` / `proposal` / `library` / `system` / `tool` → `automation`.
3. **Template heuristic** — template names containing `welcome`, `onboard`,
   `campaign`, `drip`, `outreach`, `reply`, `response`, `invite`, `lead` → `engagement`.
4. **Fall back** to the caller's `default` (today's sender), else the `automation` floor.

To force a sender from a workflow NOTIFY step, add `fromIdentity` (and optionally
`senderNamespace`) to the step's `input_map`; both flow through to the CMS handler.

## External setup (Google Workspace) — documentation only

These are **manual, one-time** infrastructure steps; the code above assumes they are
done. None are performed automatically.

1. **Provision the mailboxes** in Google Workspace: `automation@`, `eric@`,
   `heather@`, `cms_gmail_service@` (or alias as appropriate).
2. **Domain-wide delegation** for the service account so it may send *as* each
   address: Admin console → Security → API controls → Domain-wide delegation → add
   the service account client ID with scope `https://www.googleapis.com/auth/gmail.send`
   (add `gmail.readonly` / `gmail.modify` later for the inbound sweep).
3. **DNS authentication** for `rfppipeline.com` so mail from these boxes is not
   spam-filtered:
   - **SPF**: include Google **and Postmark** — `v=spf1 include:_spf.google.com include:spf.mtasv.net ~all`.
     One include is the pre-Postmark record; with the transactional mail on Postmark it fails SPF.
   - **DKIM**: generate the key in Admin console → Apps → Google Workspace → Gmail →
     Authenticate email, publish the provided `google._domainkey` TXT record.
   - **DMARC**: `v=DMARC1; p=quarantine; rua=mailto:dmarc@rfppipeline.com`.
4. **OAuth / credentials**: the CMS uses service-account delegation (`gmail_client`);
   the frontend transactional path (`frontend/lib/email.ts`) uses an OAuth2 refresh
   token — see that file's header for `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`.
5. Verify each delegated send works (Workspace → each mailbox can be "sent as" by the
   service account) before relying on the new identities in production.

## Deferred (not in this layer)

- **Provisioning** the Google Workspace mailboxes / service account / DNS (the steps
  above are documentation; someone must perform them).
- **Inbound reply sweep** across stakeholder addresses (the cross-mailbox read +
  HITL-response-trigger engine) — overlaps the dormant agent loop and is tracked
  separately.
- Wiring `fromIdentity` / `senderNamespace` into the pipeline NOTIFY emitters (today
  the template heuristic + fail-safe default cover the common cases).
