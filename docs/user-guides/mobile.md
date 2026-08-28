# On a phone

**Audience:** every role
**Short answer:** the whole product works on a phone. Twelve core surfaces were measured at 390 ×
844 and **none of them overflows the screen**. Some are more comfortable than others, and this page
says which, so you can decide what to do on a phone and what to save for a desk.

> Measured, not assumed. `frontend/scripts/capture-mobile-guide.mts` visits each surface as the real
> actor at phone width and records what the browser got — every figure below comes from
> `docs/user-guides/img/mobile-guide.json`, regenerated with the screenshots.

---

## The three verdicts

| | What it means for you |
|---|---|
| **Full** | Everything fits. Nothing to scroll sideways, nothing hidden. |
| **Scroll** | Everything is reachable, but a wide table scrolls **inside its own box** — swipe left and right *on the table*, not the page. |
| **Overflow** | Content off the edge with no way to reach it. **Zero surfaces are in this state.** |

Whichever verdict a page has, the page itself never scrolls sideways. If you find yourself dragging
the whole screen horizontally, that is a bug — please report it.

---

## Surface by surface

| Surface | On a phone | Controls |
|---|---|---|
| Sign in | **Full** | 4 |
| Portal dashboard | **Full** | 33 |
| To-dos | **Full** | 255 |
| Opportunities (cards) | **Full** | 52 |
| Library / atoms | **Scroll** | 1,908 |
| Documents | **Scroll** | 210 |
| Proposals list | **Full** | 29 |
| Proposal build workspace | **Scroll** | 59 |
| Project workspace | **Scroll** | 74 |
| Admin dashboard | **Scroll** | 129 |
| RFP curation | **Scroll** | 164 |
| Workflow monitor | **Scroll** | 332 |

*"Controls" counts the buttons, links and inputs actually visible and tappable at that width — a
measure of what you can do, not of how much rendered.*

---

## What changes when the screen gets narrow

### The navigation becomes a drawer

Below roughly a laptop width the left sidebar collapses behind the **☰** button in the top bar. Tap
it to get the full menu; tap outside to dismiss.

![Signing in on a phone](./img/m-01-login.png)

The sign-in page has no navigation at all — it is the one screen with no drawer, which is worth
saying only because it is the first screen you meet.

### Rows become columns

On customer-facing pages a wide row stacks: the title, the dates and the buttons each take their own
line rather than being squeezed. This is why the to-do queue and the opportunity cards read as
comfortably on a phone as on a laptop.

![The portal dashboard on a phone](./img/m-02-dashboard.png)

### Wide tables scroll inside themselves

Admin tables keep their table shape and scroll horizontally **within the table's own frame**. The
page stays still; the table moves. This is deliberate: an operator comparing rows wants the columns
aligned, and stacking every row into a card would make that comparison impossible.

![The admin dashboard on a phone](./img/m-10-admin-dash.png)

### Long names are shortened, and the full text is still there

A solicitation title, an atom name or a template description is often longer than a phone is wide,
so it is truncated with an ellipsis. **The full value is always kept on the element**, so a long
press (or hover, on a tablet with a pointer) shows it. If you find truncated text you cannot recover
any other way, that is a bug — the product's own checks treat it as one.

---

## What to do on a phone, and what to save for a desk

Nothing is blocked on a phone. This is about comfort, not capability.

**Good on a phone**

- Reading and clearing **to-dos** — the queue is designed for it
- Reviewing **opportunity cards** and pinning what looks interesting
- Checking a **project's progress**, ticking a task off, reading and posting a comment
- Approving or rejecting a **review**, and reading a rejection's reason
- Checking whether an **invoice** was paid, or a deliverable accepted

**Better at a desk**

- **Authoring** in the canvas — writing a proposal section, building a deck or a workbook. The
  editor works, but it is a page-shaped surface with a side panel, and a phone gives you one column
  for both.
- The **workflow monitor** and the architecture map — these are graphs, and a graph wants width.
- **Bulk curation** — triaging a solicitation involves comparing many fields at once.

> **One thing this guide does not claim.** Whether the canvas editor's toolbox is comfortable at 390px
> was **not** established: every proposal section on the fixture used for these measurements is
> locked, and a locked section renders read-only with no toolbox at any width. Rather than infer,
> this page says the editor is *better at a desk* — which is a judgement about a one-column layout
> for a two-column tool, and is true regardless.

---

## Tablets

A tablet in landscape is treated as a small desktop: the sidebar returns, tables stop scrolling
inside themselves, and the canvas editor gets its side panel back. In portrait it behaves like a
large phone. There is no separate tablet layout to learn — the same page simply has more room.

---

## If something looks wrong

The product is checked at three widths on every release — 390 (phone), 820 (tablet) and 1440
(desktop) — and separately probed at phone width **with panels open**, because a page that is fine
collapsed can be unusable the moment you expand something.

Two things are treated as defects rather than quirks, so please report them:

1. **The whole page scrolls sideways.** Inside a table is fine; the page itself is not.
2. **Text is cut off with no way to read it.** Truncation with a long-press tooltip is deliberate;
   truncation with nothing behind it is a bug.

---

## Related

- [Getting started + portal tour](./getting-started.md) — the desktop tour these screens mirror
- [Projects — after you win](./projects.md)
- [Proposal build — draft → lock → export](./proposal-build.md)
