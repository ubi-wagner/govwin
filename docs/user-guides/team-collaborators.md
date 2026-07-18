# Team & collaborators

**Who this is for:** tenant admins managing their team (`tenant_admin`), and
external collaborators invited to a proposal (`partner_user`).
**What you'll accomplish:** invite teammates, set their roles, and grant external
collaborators **section-scoped** access to a proposal — plus understand what each
person can and can't reach.

**Prerequisites:** `tenant_admin` access to reach **Team**.

---

## 1. The Team page

Click **Team** in the left nav. It has three parts: an **invite** form, your
**team members**, and your **proposal collaborators**.

![The Team page — invite form, team members, and proposal collaborators](./img/portal-team.png)

- **Invite Team Member:** email, name, and a **role** (e.g. *Contributor*) →
  **Send Invite**.
- **Team Members:** everyone in your tenant, with role (Admin / Contributor),
  status (Active / invited), and last login.
- **Proposal Collaborators:** external people invited to a *specific* proposal,
  with their role (reviewer / contributor), which proposal, and status
  (Accepted / Pending).

---

## 2. Invite a teammate

1. Enter their **email** (and name).
2. Pick a **role**:
   - **Admin** (`tenant_admin`) — full portal access: buy, build, lock, export,
     manage the team and library.
   - **Contributor** (`tenant_user`) — draft, edit, save, comment, export per your
     grant.
3. **Send Invite.** They receive an email, set their own password, and appear as
   *Active* once they sign in.

---

## 3. Grant a collaborator section-scoped access

External partners (`partner_user`) are invited to a **proposal** and scoped to
**specific sections** at a specific level:

| Grant | They can… |
|---|---|
| **View** | Read the section only |
| **Comment** | Read + leave comments |
| **Edit** | Read + comment + edit the section content |

A collaborator **only ever sees the sections they're granted** — they can't reach
another section's content, versions, or exports. This is enforced everywhere
(save, lock, versions, export, atomize, comment resolution), not just hidden in
the UI — so the collaborator-landing model is safe by construction.

> Invite/manage collaborators from the proposal's **Team & Access** tab (see
> [Proposal build](./proposal-build.md)); they then appear in the **Proposal
> Collaborators** table here.

---

## 4. What each role can do (summary)

| Role | Scope |
|---|---|
| **Admin** (`tenant_admin`) | Everything in the portal |
| **Contributor** (`tenant_user`) | Tenant-wide member; draft/edit/comment/export per grant (admin locks) |
| **Collaborator** (`partner_user`) | Only granted sections, at view / comment / edit |

---

## Troubleshooting

- **An invite shows "Pending" forever.** They haven't accepted yet — resend, or
  confirm the email arrived. Collaborators must accept before their access is live.
- **A collaborator says they can't see a section.** They were granted a *different*
  section, or only *view* where they need *edit*. Update their grant on the
  proposal's **Team & Access** tab.
- **A teammate can't lock a section.** Locking is an **admin** action; contributors
  save and an admin accepts & locks (see [Proposal build](./proposal-build.md)).
