# RFP admin — ingest, curate, release

**Who this is for:** the RFP Pipeline team (`rfp_admin`, `master_admin`) who bring
opportunities into the system, curate them, onboard customers, and release
purchased proposals.
**What you'll accomplish:** take an RFP from raw notice to a released,
build-ready proposal portal in a customer's account — and know where every admin
lever lives.

**Prerequisites:** an `rfp_admin` or `master_admin` login. You land in **`/admin`**.

---

## 1. The admin console

The admin nav is grouped by area: **Overview**, **Opportunities** (Intake, RFP
Curation, Opportunity Cards, Sources, Pipeline Jobs, Templates, Guardrail
Defaults), **Customers** (Applications, Tenants, Billing, Waitlist, Purchases,
Proposals), **Content**, **System**, and **CRM**. A **Portal →** link at the
bottom jumps you into the customer portal (including a tenant shadow).

---

## 2. Ingest an RFP

Two ways in, both under **Opportunities**:

- **Intake** — record a no-file notice (title, agency, topic).
- **RFP Curation → + Upload RFP** — upload the RFP PDF; the system extracts text
  and topics and creates the opportunity + solicitation.

New solicitations land in the **RFP Triage Queue**.

![The RFP triage queue — live DoD SBIR (DSIP) solicitations awaiting curation](./img/admin-rfp-curation.png)

Each row shows the title, **source** (here `dsip`), agency (DARPA, Navy, …),
status (`new`), namespace, and ingest date. The queue above holds real current
**DoD SBIR 2026 (DSIP)** topics — DARPA DSO/BTO and NAVWAR releases; a superseded
notice is shown `dismissed`. Click **Claim** to take a solicitation and open its
curation workspace.

---

## 3. Curate the compliance skeleton

In the curation workspace you author the **skeleton** every customer build will be
provisioned from (you author the skeleton, not per-proposal rows):

- **Compliance Matrix** — set/confirm the required elements.
- **Volumes** — *Add volume* (Technical, Cost, Supporting…), then *Add required
  item* under each (the section molds). Set page/slide limits and fonts per item.

Every required item's **Add / Edit** dialog carries a **Section grounding** block —
this is where you decide what a customer's build starts from:

![Required-item dialog — compliance fields plus the Section grounding block (template picker + expert notes)](./img/curation-item-template-picker.png)

- **Starter template (mold)** — point the item at a **canvas template** from
  [Template Studio](#4-author-templates-template-studio) (grouped by type). At
  provision the item's section is created **from that template's layout**, styled to
  the format rules above. Leave it *None* for a blank section.
- **Expert notes (grounding)** — win themes, evaluator hot-buttons, or must-hit
  points; passed to the drafter as grounding for this item.

Linked items show a **📄 template** and **✎ notes** badge in the volume list, so the
skeleton's grounding is visible at a glance:

![A required item badged with its linked template and expert notes](./img/curation-item-template-badge.png)

> **What just happened:** when a customer's portal is later released, the
> per-proposal **compliance matrix + section molds are materialized automatically**
> from this skeleton — each item's section seeded from its linked template and
> grounded by its expert notes.

---

## 4. Author templates (Template Studio)

**Opportunities → Templates** is the template library that both the curation
skeleton and the customer [Documents](./documents.md) browser draw from.

![Template Studio — system + demo templates with type, format, node count](./img/admin-templates.png)

- Filter by **Type / Agency / Program**.
- **System** templates (e.g. *DoD SBIR Phase I — Technical Volume*, *DoD CSO Pitch
  Briefing*, *Cost Volume*) are shared across all tenants; **Preview** them.
- **+ New Template** opens the WYSIWYG canvas editor to build one; existing
  non-system templates have **Edit** / **Delete**.
- Each card shows the export format (DOCX / PPTX / XLSX), a **node count** (a
  filled skeleton) or an outline, and page/slide limits.

> Customers can also create their own templates by **saving a built volume as a
> template** — those show up in their portal's template browser.

---

## 5. Onboard a customer & release their build

1. A customer **purchases a proposal portal** with a comp code — it lands in
   **Customers → Purchases** as `curation_pending` with a 72-hour SLA, and parks
   an admin triage task.
2. Curate the solicitation (steps 3–4) if you haven't already.
3. **Release** the portal from the tenant's **`/portal/[tenant]/portals`** page
   (click **Release to customer**). Release **provisions the build UNLOCKED** — the
   proposal, its volumes, section molds, and the compliance matrix are instantiated
   from your skeleton.

> **Friction note:** the Release button lives on the tenant's portal page — use
> **Portal →** / navigate to the tenant URL to click it (no `/admin` deep-link
> yet).

The customer can now build (see [Proposal build](./proposal-build.md)).

### Or add a company directly (we/expert onboard)

Besides the customer's self-serve **/apply → accept** path, you can create a company
yourself from **Customers → Tenants → + New Company**: enter the company name and its
**admin point of contact** (email + name). That creates the company *and* its admin POC
(with a temporary password) in one step, and seeds their spotlight + pipeline.

![Add a company + admin POC directly from the Tenants page](./img/admin-new-company.png)

Then **shadow into their space** (section 6) to help them **upload & atomize** their
documents — the upload/atomizer is on their dashboard. Everything you do there is logged
to their audit trail. All the tenant's user/collaborator adds and (de)activations come
from their company admin — or from you acting as that admin in shadow, always audited.

---

## 6. Act inside a tenant (shadow / god-view)

Use **Portal →** to enter a tenant's portal and act on their behalf —
upload/atomize their library, provision a portal, or troubleshoot a build. This is
the same portal the customer sees, under their tenant's row-level security.

**You are the only account that changes scope without logging out.** Customers and
collaborators are pinned to one company per session (they sign out to switch). RFP
Pipeline staff instead **descend** into any customer and **ascend** back — and every
transition is guarded:

- **You act as their company admin, never as an RFP admin.** On descent your working
  role inside the tenant is `tenant_admin`, so their data-integrity rules apply to
  you exactly as to a real company admin. There is no elevated "admin acting" mode
  that bypasses a company-level constraint.
- **Every descent and ascent is audited.** Entering writes `identity:shadow.descended`
  and leaving writes `identity:shadow.ascended` to the customer's own trail — so their
  queue (and the platform log) shows exactly when staff were in their space.
- **You always know where you are.** A persistent amber banner marks the customer's
  space, and a one-time acknowledgment modal confirms the descent.

![The shadow-space banner + first-entry acknowledgment — you're acting as company admin, logged](./img/shadow-descend-ack.png)

---

## 7. Pause or restore a company (license)

When a company's license lapses, **archive** it from its **Tenants → company** page.
Archiving is a company-wide *slumber*, not a deletion:

![The tenant page with the Archive (license lapsed) control next to the status badges](./img/admin-tenant-archive.png)

- **Archive (license lapsed)** pauses access for **every** user of that company at once.
  They see an "Access paused" message on sign-in, and the company **disappears from their
  login list** — so a person who also works at other companies just lands there instead.
- **Nobody is deleted and no work is lost.** Archiving doesn't touch any individual
  user's active/inactive state, so **Restore access** returns everyone to *exactly* where
  they were — active users active, anyone you'd individually deactivated still inactive.
- **You (RFP staff) can still enter** an archived company (shadow) to renew or clean up.
- Both actions are audited (`tenant.archived` / `tenant.restored`).

This is the top of the **active · inactive · archived** ladder: a single user can be made
inactive on a proposal or in a company (kept for history, re-invite to revive); a whole
company can be archived (license slumber) and restored losslessly.

---

## Admin surfaces at a glance

| Area | Use it to… |
|---|---|
| **Intake / RFP Curation** | Bring in and curate solicitations |
| **Opportunity Cards** | See what's being spotlighted to tenants |
| **Sources / Pipeline Jobs** | Manage ingestion sources and runs |
| **Templates** | Author the shared template library |
| **Tenants / Applications / Waitlist** | Manage customer accounts and access |
| **Purchases** | Triage new buys → curate → release |
| **Proposals** | Cross-tenant view of every build |
| **System State / Event Stream / Process Monitor** | Observe the platform |
| **Agents / Workflows** | The agent workforce and workflow engine* |

\* *Agent workforce is partly wired — `section_drafter` is live end-to-end;
`compliance_reviewer` runs inline; the rest are registered but dormant. Don't
promise customers the dormant archetypes yet.*

---

## Troubleshooting

- **Can't find the Release button in `/admin`.** It's on the tenant's
  `/portal/[tenant]/portals` page — jump via **Portal →**.
- **A purchase is stuck in `curation_pending`.** It's awaiting an admin to curate
  + release; the 72-hour SLA is counting down on the customer's card.
- **Self-serve checkout isn't available.** Stripe checkout is descoped — customers
  purchase with a comp code; you release from the shadow account.
