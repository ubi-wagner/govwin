# Partner‑Manager — V1 Operational Manual

The how‑to for the partner‑manager actor. Technical spec: `docs/PARTNER_MANAGER_DESIGN.md`.
Environment/replication: `docs/CLAUDE_VM_REPLICATION.md`. Every flow below is verified end‑to‑end
against the live app (see the V1 baseline report).

**Actors:** the **Partner‑Manager** (`partner_admin`, e.g. Paul Jackson / Entrepreneurs' Center,
Stephanie Gaffney / YBI), the **RFP Admin** (`rfp_admin`), and the **Company Admin** (`tenant_admin`
of a client company). A partner never has `/admin` reach.

---

## Part 1 — The Partner‑Manager

### 1.1 Sign in → the console
`/login` → you land on **`/partner`** (the console). Two zones:
- **Your organization** — your own org (a full tenant of its own). "Open my org workspace →" enters
  it exactly like a company: opportunities, buckets, library, proposal builds. This is where you
  pursue grants *as an organization*.
- **Supported companies** — one **rollup card per company** you created or manage: buckets, pins,
  proposals, portals, admin POC, and an **owner/manager** badge.

### 1.2 Add a company (the 3‑branch flow)
Click **+ Add a company** → enter **company name, admin name, admin email**. The system checks for an
existing company, then routes you:

| Result | What you do |
|---|---|
| **New** (no match, email free) | A short onboarding form (phone, website, state, description, your notes) → **Submit for approval**. An RFP admin reviews; on approval it lands in your stable, fully provisioned (buckets + a **ranked** opportunity pipeline + starter library), **owned by you, no checkout**. |
| **Similar name** | We list the close matches. Choose **"None of these — mine is new"** (audited) → onboarding form; or **"one of these is my company"** → request‑manager. |
| **Exact existing tenant** | You can't register it twice. Click **Request manager access →** — the company's admin approves, and it joins your stable. |

**Rules:** the admin email must be unique as a *company owner/admin* — but the same person may be a
collaborator at another company. Creation is always RFP‑admin‑approved (no instant bypass).

### 1.3 Manage a company (descend & return)
On a company card → **Open workspace →**. You enter its portal **as its manager** (full
tenant‑admin), with a top banner: **"Managing <Company> as a partner‑manager · Exit to partner
console →"**. Work inside it (staff the team, review the pipeline, build proposals). Hop straight
between your companies — no re‑login. **Exit to partner console →** returns you up.

### 1.4 Build a proposal inside a company
1. **Opportunities** → each card is scored by your spotlight **buckets** (ranked on arrival).
2. **Create a bucket** (Buckets → new) to shape ranking; cards re‑rank immediately.
3. **Pin** a card (copy the docs local), then **Build →** — the comp‑code purchase opens a proposal
   **portal** (`curation_pending`, 72h SLA, $0 comp). An RFP admin **releases** it → the build
   provisions with the compliance matrix + section molds.
4. Run the **doorbell (Proposal Auto‑Drive)** — Draft → Refine → Compliance (color‑team reviewed);
   comment+regenerate or approve→next at each gate, or run all three.
5. **Download** the locked/submitted proposal — Word / PDF / per‑volume ZIP.

### 1.5 Being added by a company (no request)
A company can grant you access directly: their admin invites your email as a **Manager** from their
Team page. Same manager membership, company‑initiated — nothing for you to accept.

---

## Part 2 — The RFP Admin

### 2.1 Create a new partner‑manager org
`/admin/tenants` → **+ New partner org** → org name (+ legal, website), admin name + email → **Create
partner org**. The modal returns the **temp password** to relay; the new partner logs in at
`/partner`, own org provisioned. (Prod: they reset on first login.)

### 2.2 Approve a partner company registration
`/admin/applications` → partner submissions carry a **"Partner registration"** badge. **Accept** →
provisions the company (tenant + admin user + buckets + **ranked** cards + starter library) **and**
attributes ownership to the submitting partner, so it lands in their stable. (Same accept path as a
public applicant; the partner attribution is the only addition.)

### 2.3 Release a proposal portal
A partner's comp‑code purchase opens a portal `curation_pending`. Curate the solicitation and
**release** it (RFP curation) → the build provisions. (Existing flow; unchanged.)

---

## Part 3 — The Company Admin

### 3.1 Approve / decline a manager request
When a partner requests manager access, you get an **in‑app ToDo *and* an email**. On your
**Team** page → **Manager access requests** → **Approve** (grants the partner manager access) or
**Decline**. Approve is the same terminal grant as adding them directly.

### 3.2 Add a manager directly
Team → invite by email with role **Manager (external partner org)** → grants an existing partner
manager access to your company. Revoke any time (never hard‑deleted).

---

## Part 4 — Reference

**URLs:** `/partner` (console) · `/api/partner/enter?slug=…` / `/exit` (descend/ascend) ·
`/admin/tenants` (+ New partner org) · `/admin/applications` (approve) · `/portal/<slug>/team`
(manager requests).

**Events (audit):** `finder:partner.company_registered / manager_requested / manager_granted /
manager_declined / entered / exited`; ToDos `partner_registration_triage` (rfp_admin),
`manager_request` (company admin).

**Demo accounts** (dev): Paul `pjackson@ecinnovates.com`, Stephanie `sgaffney@ybi.org` — see
`docs/CLAUDE_VM_REPLICATION.md`.

**Invariants:** consent (a partner never reaches a company without that company's approval or
RFP‑admin approval) · isolation (owner‑scoped; no `/admin` reach) · nothing hard‑deleted.
