# Manage Console — Customer-Admin Guide

The **Manage** console is where a company admin (and a descended RFP shadow-admin) sets up
and governs everything: subscription, spotlight buckets, the team, proposal portals, and
automation. It is the "setup" half of the admin experience — the Dashboard is where an
admin works *as a full-access user*; **Manage** is where they *configure*.

> **Get there:** sign in → left nav → **Manage** (visible to admins only). URL:
> `/portal/<company>/manage`. A base team member or partner never sees it; a descended
> RFP/master admin does (by role rank).

Design + rationale: `docs/CUSTOMER_ADMIN_CONSOLE_DESIGN.md`. Screenshots for this guide are
in the session's `manage-shots/` set (01 home … 14 editor-in-console).

---

## The layout

- **Center — the lifecycle home.** The spine of the business, left to right:
  **Subscribe → Spotlight → Buy → Build → Close out**, each card reading your live state
  (subscription, `N buckets · N OPPs`, `N portals`, `N active builds`, `N to-dos`). The
  first three cards open a drawer; **Build** links to your proposals and **Close out** to
  your task queue. Below is a **Set up** grid of quick actions.
- **Right — the rail.** Six tiles, each opening a slide-out drawer: **Account · Buckets ·
  Users · Portals · Automation · AI usage**. Count badges show what's inside.

Everything is a drawer over the same page, so you never lose your place. On a narrow /
split-screen pane the layout reflows (hamburger nav, the spine to 2–3 columns).

---

## Account

Subscription state, billing, expert-consulting hours, and your company profile.

- **Spotlight Subscription** — subscribe ($499/mo) or **Manage Billing**.
- **Expert Consulting** — buy 1-on-1 hours (requires an active subscription).
- **Company Profile** — NAICS, keywords, agencies, set-asides, summary (**Edit**).

> If you're one of our experts working inside a customer's console (a *shadow admin*), the
> billing buttons are disabled — they act on your own account, not the customer's. Sign in
> as the company to change its subscription. (The comp-code purchase is the live path
> regardless.)

## Buckets

A **spotlight bucket** is a saved lens on the always-searchable master-mirror opportunity
list — its definition (keywords / agencies / program types / NAICS), plus context matching.
Create one, then **Rank →** to order your pipeline against it. **Notification logic is not
here — it's global, in Automation.**

## Users & collaborators

Your roster. **Invite** a member (Admin / Contributor / External), change a member's **role**
inline (promote/demote; the last active admin can't be demoted), and **Deactivate /
Reactivate** anyone (never deleted — access off, history kept). Your own row shows *You*.
Per-surface access (bucket pinning, library editing, workflow actors) is granted in those
respective admins.

## Portals & workflow

Each **portal** is a proposal build for one opportunity. Open one from a pinned OPP, then
**Configure & launch** to author its workflow before it goes live:

- **Phases (up to 3, selectable):** Kickoff & Compliance → Draft (V0.5) → Review, Lock &
  Submit — spanning **purchase → close → +30 days**, deadlines anchored to the close date.
- **HITL ToDos per phase:** add as many as you need (type · title · assignee · due-days).
- **Managers (delegated, per portal):** your admins always get the final notice; delegate
  it to more people — a teammate or one of our experts (e.g. Econ-dev) — added or not, as
  many as you want.
- **Nudges:** up to 3 reminders (days before due). The last is the **final notice** — it
  goes to your admins plus any delegated managers.

On **Launch build**, the config is validated, the portal provisions, and the first phase's
ToDos land in your task queue. Advance a stage once its ToDos are done (or force-advance).

## Automation

Global, tenant-level notification preferences: who gets ToDos / notifications / nudges, and
on what triggers (document ready, collaborator get-ready, stage advanced, new priority
opportunity), plus AI-review-on-advance and auto-advance-when-all-locked. **Save** to apply.

## AI usage

Your agent-call usage and remaining allocation (7d / 30d / 90d).

---

## The one automation grammar

Everything nudges the same way — `recipients × trigger × timing × escalation`:

- **Discovery side (buckets/OPPs):** who to alert when an OPP changes, enters your top-N, or
  matches a focus agency; timed off open/close dates.
- **Build side (portals):** the phase actors, on their ToDo deadlines, with the escalating
  3-nudge cadence whose final notice reaches your admins + delegated managers.

Same engine, two vocabularies — which is why the RFP-Admin side is the mirror image of this
console.
