# Canvas Document Builder — Complete User Manual

## Overview

The Document Builder provides three canvas editors for creating, editing, formatting, and exporting documents. Each canvas type is optimized for a different output format.

| Canvas | Output | Best For |
|--------|--------|----------|
| **Document Editor** | .docx (Word) | Technical volumes, whitepapers, proposals, letters |
| **Slide Editor** | .pptx (PowerPoint) | CSO briefings, pitch decks, presentations |
| **Spreadsheet Editor** | .xlsx (Excel) | Cost volumes, budgets, data tables, BOMs |

Access: Admin > Document Builder (`/admin/documents`)

In the proposal pipeline, each proposal section is also a canvas document with additional collaboration features (comments, AI revision, change tracking, watermarks).

---

## Creating a New Document

1. Navigate to **Admin > Document Builder**
2. Click **New Document** (top right)
3. Fill in the creation form:
   - **Title** (required): name of the document
   - **Description** (optional): notes about the document's purpose
   - **Preset**: determines the canvas type, page layout, and defaults

### Available Presets

| Preset | Canvas Type | Page Size | Font | Limits | Use Case |
|--------|-------------|-----------|------|--------|----------|
| **Standard Letter** | Document | 8.5x11 | Times New Roman 12pt | None | General documents, whitepapers |
| **SBIR Phase I** | Document | 8.5x11 | Times New Roman 10pt | 15 pages | DoD SBIR Phase I technical volumes |
| **SBIR Phase II** | Document | 8.5x11 | Times New Roman 12pt | 30 pages | DoD SBIR Phase II technical volumes |
| **CSO Slide Deck** | Slide | 16:9 widescreen | Arial 18pt | 25 slides | CSO/STTR briefing presentations |
| **Spreadsheet** | Spreadsheet | N/A | Calibri 11pt | None | Cost volumes, data tables |
| **Custom** | Document | 8.5x11 | Times New Roman 12pt | None | Blank canvas, configure everything in Settings |

4. Click **Create** — the editor opens immediately

### Preset Details

**SBIR Phase I** preset includes:
- Header template: `{topic_number} — {company_name}`
- Footer template: `{company_name} | Page {n} of {N}`
- 15-page limit (compliance sidebar tracks page count)
- Single line spacing (1.0)

**SBIR Phase II** preset includes:
- Same header/footer as Phase I
- 30-page limit
- Single line spacing (1.0)
- Larger default font (12pt vs 10pt)

**CSO Slide Deck** preset includes:
- 16:9 aspect ratio (960x540 points)
- 25-slide limit
- No header/footer (slide-level footer with slide numbers)

---

# Document Editor

Used for: Standard Letter, SBIR Phase I, SBIR Phase II, Custom presets.

## Editor Layout

```
+--------------------------------------------------+----------+
|  Toolbar: Title | Status | Export .docx | Save    |          |
+--------------------------------------------------+  Sidebar |
|                                                    |          |
|  +--------------------------------------------+   | Tabs:    |
|  | Header: {topic_number} — {company_name}    |   | Comply   |
|  |                                             |   | Node     |
|  | [WATERMARK: DRAFT / AI DRAFT / FOR REVIEW]  |   | Add      |
|  |                                             |   | Settings |
|  |  Content nodes rendered WYSIWYG:            |   |          |
|  |  - Headings                                 |   |          |
|  |  - Paragraphs with formatting               |   |          |
|  |  - Lists                                    |   |          |
|  |  - Tables                                   |   |          |
|  |  - Images                                   |   |          |
|  |  - etc.                                     |   |          |
|  |                                             |   |          |
|  | Footer: Page {n} of {N}                     |   |          |
|  +--------------------------------------------+   |          |
|                                                    |          |
|  Page info: status | 12 atoms | ~3/15 pages | v5  |          |
+--------------------------------------------------+----------+
```

## Content Nodes — Complete Reference

### Adding Nodes

1. Click the **Add** tab in the right sidebar
2. Click any node type button — it inserts after the currently selected node (or at the end if nothing is selected)

12 node types available:

| Button | Node Type | Default Content | Description |
|--------|-----------|-----------------|-------------|
| **H** | Heading | "New Section" (H2) | Section headings with levels |
| **T** | Paragraph | Empty text | Body text with inline formatting |
| **bullet** | Bullet List | "Item 1" | Unordered list with items |
| **#** | Numbered List | "Step 1" | Ordered list with items |
| **img** | Image | Empty placeholder | Upload images from disk |
| **grid** | Table | 2 columns, 1 row | Data tables with editable cells |
| **C** | Caption | "Figure 1: Caption text" | Figure/Table/Chart captions |
| **dagger** | Footnote | Marker "1" + empty text | Reference citations |
| **arrow** | Link | Empty URL + text | Hyperlinks |
| **dash** | Page Break | N/A | Forces a new page |
| **toc** | TOC | Placeholder | Table of contents |
| **space** | Spacer | N/A | Vertical whitespace |

### Editing Each Node Type

#### Heading

**Click to select (blue border), then:**
- **Level picker**: dropdown showing H1, H2, H3 — changes heading size (18pt, 14pt, 12pt)
- **Numbering input**: small text field labeled "#" — enter section numbering like "1.0", "1.1", "2.0"
- **Text input**: main text of the heading

**Display (when not selected):** renders bold text at the heading size, with numbering prefix if set.

**Export to DOCX:** Word heading levels (Heading 1, Heading 2, Heading 3) with numbering in text.

#### Paragraph (Text Block)

**Click to select, then:**
- **Formatting toolbar** appears above the textarea:
  - **B** — bold selected text
  - **I** — italic selected text
  - **U** — underline selected text
  - **x^2** — superscript selected text
  - **x_2** — subscript selected text
  - Character range indicator: shows "chars 3-8" when text is selected
- **Textarea**: type or paste text content
- Formatting is applied to the selected character range only

**How to format text:**
1. Click a paragraph node to enter edit mode
2. Click and drag to select a range of text in the textarea
3. Click a format button (e.g., **B**) — the format is applied to that range
4. The selection is preserved after formatting so you can apply multiple formats
5. Click the same button on the same selection to toggle the format off
6. Typing before/inside formatted text automatically adjusts format positions

**Display (when not selected):** renders with proper HTML formatting — `<strong>`, `<em>`, `<u>`, `<sup>`, `<sub>`. Overlapping formats render correctly (e.g., bold + italic).

**Export to DOCX:** each formatted range becomes a separate TextRun with the appropriate Word formatting.

#### Bullet List

**Click to select, then:**
- Each item shows as an **input field** with controls:
  - **<** button — outdent (decrease indent level, minimum 0)
  - **>** button — indent (increase indent level)
  - **x** button — remove this item
- **+ Add item** button at bottom — appends a new empty item
- Items cannot be empty — removing the last item creates a single empty item

**Display:** standard bullet list with indent levels (20px per level).

**Export to DOCX:** Word bullet paragraphs with level-based indentation.

#### Numbered List

Identical to Bullet List, but renders with numbers (1. 2. 3.) instead of bullets.

**Export to DOCX:** Word numbered paragraphs (1. a) i.) with 9 indent levels.

#### Table

**Click to select, then:**
- **Header row**: each cell is an editable input
- **Data rows**: each cell is an editable input
- **Row controls**: **x** button at end of each data row to delete it (disabled on last row)
- **Column controls**: **x** button below each column letter to delete it (disabled on last column)
- **+ Row** button — appends an empty row
- **+ Column** button — appends a new column

**Display:** HTML table with borders, header styling (bold, gray background), and per-cell styles (background color, bold, alignment) if set.

**Export to DOCX:** Word table with cell borders, header styling, background colors, row/column spans.

#### Image

**Click to select with no image uploaded:**
- **Upload zone**: dashed border box, "Click to upload image"
- Click to open file picker (accepts PNG, JPEG, GIF, WebP, SVG, max 10MB)
- **Alt text** input: description for accessibility
- **Caption** input: text shown below the image

**Click to select with image uploaded:**
- Image displays at actual dimensions (constrained to max 500px width)
- **Alt text** input
- **Caption** input
- **W** / **H** inputs: set width and height in pixels for resize
- **Replace image** link: upload a different image

**Upload flow:** image uploads to S3 at `reference/images/{uuid}.ext`, dimensions auto-detected from the image file.

**Display:** actual image from S3 (via presigned URL, 1-hour expiry, auto-refreshes on storage_key change).

**Export:** currently exports as placeholder text `[Image: alt_text]`. Image embedding in DOCX/PPTX not yet implemented.

#### Caption

**Click to select:**
- **Prefix dropdown**: Figure, Table, Chart, Exhibit
- **Number input**: auto-incrementing number
- **Text input**: caption description

**Display:** italic centered text: "Figure 1: Caption text"

**Export to DOCX:** italic centered paragraph.

#### Footnote

**Click to select:**
- **Marker input**: superscript marker (e.g., "1", "2", "*")
- **Text input**: footnote content

**Display:** small text with superscript marker and top border separator.

**Export to DOCX:** superscript marker + small text paragraph with border.

#### Link

**Click to select:**
- **URL input**: the target URL
- **Text input**: display text shown to the reader

**Display:** blue underlined text.

**Export to DOCX:** blue-colored text (not a clickable hyperlink in current export).

#### Page Break

Not editable. Renders as a dashed horizontal line. Forces a new page on export.

#### TOC (Table of Contents)

Not editable. Renders as placeholder text: "[Table of Contents — auto-generated on export]". Currently exports as placeholder text.

#### Spacer

Not editable. Renders as vertical whitespace (32px).

---

## Node Management

### Moving Nodes

1. Select a node by clicking it
2. Open the **Node** tab in the sidebar
3. Click **Move Up** or **Move Down** to reorder the node in the document
4. Nodes swap position with their neighbor

### Deleting Nodes

1. Select a node
2. Open the **Node** tab
3. Click **Delete** (red button)
4. The node is immediately removed (no confirmation)

### Accept / Revert

- **Accept**: marks AI-drafted content as accepted (adds "accepted" history entry)
- **Revert**: adds a "reverted" history entry (content is not actually restored — use Save History to restore previous versions)

### Replace from Library

1. Select a node
2. Open the **Node** tab
3. Click **Replace from Library**
4. The Library Picker opens — search by category or text
5. Results show library atoms ranked by outcome score (awarded proposals first)
6. Click an atom to replace the selected node's content
7. The node's provenance changes to "library" with the atom ID recorded

---

## Node-Level Formatting (Sidebar > Node > Format)

When a node is selected, the **Node** tab shows a **Format** section with these controls:

### Text Alignment

Four buttons in a row:
| Button | Alignment | CSS | DOCX |
|--------|-----------|-----|------|
| **left arrow** | Left (default) | `text-align: left` | `AlignmentType.START` |
| **center arrow** | Center | `text-align: center` | `AlignmentType.CENTER` |
| **right arrow** | Right | `text-align: right` | `AlignmentType.END` |
| **justify arrow** | Justify | `text-align: justify` | `AlignmentType.JUSTIFIED` |

Active alignment is highlighted with blue background.

### Font Override

| Control | Options | Effect |
|---------|---------|--------|
| **Font family** dropdown | Default, Times New Roman, Arial, Calibri, Georgia, Helvetica, Courier New | Overrides document default font for this node only |
| **Font size** input | 6-72pt | Overrides document default size for this node only |

"Default" (empty) inherits from document-level Settings.

### Style Toggles

| Button | Effect | Scope |
|--------|--------|-------|
| **B** | Toggle bold | Entire node (all text in the block) |
| **I** | Toggle italic | Entire node |

These are different from the inline B/I/U toolbar — node-level bold makes the whole paragraph bold, inline bold only affects the selected range.

### Text Color

- **Color picker** swatch: click to open browser color picker
- Shows current hex value (e.g., "#FF0000" for red)
- **reset** link: removes color override, returns to default (black)
- Renders as CSS `color` property on the node
- Exports to DOCX as `color` on TextRun

### Spacing

| Control | Range | Effect |
|---------|-------|--------|
| **Space Before** | 0-72 points | Padding above the node |
| **Space After** | 0-72 points | Padding below the node |

Leave blank for auto (default ~4pt). Exports to DOCX as paragraph spacing.

### Indent

- Number input: 0-200 pixels, step 20
- Renders as `margin-left` on the node
- Exports to DOCX as paragraph indent
- Useful for block quotes or nested content

---

## Document Settings (Sidebar > Settings Tab)

Controls that affect the entire document layout:

### Page Margins

Four number inputs (in inches, 0.25 increments):
| Margin | Default | Range |
|--------|---------|-------|
| Top | 1.0" | 0-3" |
| Bottom | 1.0" | 0-3" |
| Left | 1.0" | 0-3" |
| Right | 1.0" | 0-3" |

### Default Font

| Control | Options |
|---------|---------|
| Family dropdown | Times New Roman, Arial, Calibri, Georgia, Helvetica, Courier New |
| Size input | 6-24pt |

This sets the base font for all nodes that don't have a per-node font override.

### Line Spacing

| Option | Value |
|--------|-------|
| Single | 1.0 |
| 1.15 | 1.15 (default for Standard Letter) |
| 1.5 | 1.5 |
| Double | 2.0 |

### Page / Slide Limit

Number input. Set to 0 for unlimited. The Compliance tab tracks estimated page count against this limit.

### Header

- **+ Add header**: creates a header with default template `{company_name}` and 36pt height, 10pt font
- **Template text input**: edit the header content
- **Remove** link: removes the header entirely

### Footer

- **+ Add footer**: creates a footer with default template `Page {n} of {N}` and 36pt height, 10pt font
- **Template text input**: edit the footer content
- **Remove** link: removes the footer entirely

### Template Variables

Available in header and footer templates:

| Variable | Replaced With |
|----------|---------------|
| `{company_name}` | Company name from proposal context |
| `{topic_number}` | Topic/solicitation number |
| `{pi_name}` | Principal investigator name |
| `{n}` | Current page number |
| `{N}` | Total page count |

---

## Compliance Tab (Sidebar)

Shows document compliance metrics:

| Metric | Description |
|--------|-------------|
| **Status** | Current document status (empty, ai_drafted, in_progress, review, accepted) |
| **Atoms** | Total number of content nodes |
| **Version** | Document version number (increments on every edit) |
| **Page limit** | Estimated pages vs. maximum (e.g., ~3 / 15) |
| **Font** | Document default font and size |
| **Margins** | Document margins in inches |
| **Content Sources** | Breakdown of nodes by provenance: AI drafted (yellow), from library (indigo), manual (green) |

---

## Saving and Exporting

### Save

- Click **Save** button (blue, top right of toolbar)
- Button is disabled when no changes exist ("unsaved" indicator disappears)
- On failure: red error text appears next to the button
- **Every save archives the previous version** to S3 history

### Export

| Button | When Shown | Output |
|--------|-----------|--------|
| **Export .docx** | Letter or Custom format documents | Word document with all formatting |
| **Export .pdf** | Letter or Custom format | Not yet implemented (shows alert) |
| **Export .pptx** | Slide format documents | PowerPoint presentation |
| **Export .xlsx** | Any document containing table nodes | Excel workbook |

### Save History

1. Click **History (N)** button in the editor header bar
2. A dropdown panel shows all previous saves:
   - Timestamp of each save
   - File size
3. Click any entry to restore that version
4. Confirms before restoring ("Restore this version? Current changes will be lost.")
5. After restoring, click Save to persist the restored version

---

## Visual Indicators

### Watermark Overlay

A large, semi-transparent rotated text appears on the canvas page showing the document status:

| Status | Watermark |
|--------|-----------|
| `empty` | EMPTY |
| `ai_drafted` | AI DRAFT |
| `in_progress` | DRAFT |
| `review` | FOR REVIEW |
| `accepted` | (no watermark) |

### Provenance Badges

When a node is selected, a small badge appears showing its origin:
- **ai draft** (yellow) — generated by AI
- **library** (indigo) — inserted from the library
- **template** (gray) — from the proposal template
- **manual** (no badge) — manually created

### Change Indicators

Each node shows a compact indicator of who last edited it:
- Colored dot + first name in compact mode
- Full name, action, and timestamp when the node is selected

---

# Slide Editor

Used for: CSO Slide Deck preset (and any document with `slide_16_9` or `slide_4_3` format).

## Editor Layout

```
+----------------+-------------------------------+----------+
| Slide          |                               |          |
| Thumbnails     |     Dark background           | Sidebar  |
|                |                               |          |
| [Slide 1]     |   +---------------------+     | Tabs:    |
|  Title         |   | White slide surface |     | Comply   |
|  3 elements    |   |                     |     | Node     |
|                |   |  Content nodes      |     | Add      |
| [Slide 2]     |   |  rendered WYSIWYG   |     | Settings |
|  Approach      |   |                     |     |          |
|  5 elements    |   |  Footer: 1 / 5      |     |          |
|                |   +---------------------+     |          |
| [Slide 3]     |                               |          |
|  ...           |   Slide 1 of 5                |          |
|                |                               |          |
| [+ Add Slide]  |                               |          |
| 5 slides       |                               |          |
+----------------+-------------------------------+----------+
```

## Slide Management

### Adding Slides

- Click **+ Add Slide** at the bottom of the thumbnail panel
- A new empty slide is created after the current slide
- Internally, a `page_break` node is inserted to separate slides

### Navigating Slides

- **Click any thumbnail** to switch to that slide
- Current slide has a blue border on its thumbnail
- Thumbnail shows: slide title (first heading text), element count, slide number
- Slide count displayed below thumbnails

### Deleting Slides

- Hover over a thumbnail — a red **x** button appears in the top-right corner
- Click to delete the slide and all its content
- Cannot delete the last remaining slide

### Slide Footer

- If a footer template is set in Settings, it renders at the bottom of each slide
- Variables `{n}` (slide number) and `{N}` (total slides) are auto-filled
- Slide count text shown below the editing area

## Editing Slide Content

All 12 node types from the Document Editor work identically on slides:
- All content adding, editing, and formatting is the same
- The sidebar (Add, Node/Format, Compliance, Settings) is fully available
- All inline formatting (B/I/U/Super/Sub) works on text blocks
- All node-level formatting (alignment, font, color, spacing) works

### Slide-Specific Defaults

- Default font: Arial 18pt (larger than document defaults)
- Headings render at 18pt (H1), 14pt (H2), 12pt (H3) scaled for slides
- Dark gray background around the slide surface for contrast

## PPTX Export Details

When exporting to PowerPoint:
- Each slide becomes a separate PowerPoint slide
- First heading on each slide becomes the title zone (top of slide)
- Remaining nodes render in the body zone
- Inline formatting (bold/italic/underline/super/sub) is preserved in text runs
- Footer renders at the bottom with slide numbers
- Lists export with bullet/number formatting and indent levels
- Tables export with full structure
- Speaker notes are populated from node history comments
- Images export as placeholder text (not embedded)

---

# Spreadsheet Editor

Used for: Spreadsheet preset (and any document with `spreadsheet` format).

## Editor Layout

```
+------------------------------------------------------------------+
| Toolbar: Title | Status | unsaved | Cell: B3 | fx [cell value]  |
|                                               | Export .xlsx Save |
+------------------------------------------------------------------+
| Format bar: [B] [left][center][right] | Fill: [color] | Size Font|
+------------------------------------------------------------------+
|   |  A        |  B        |  C        |  D        | +           |
|   |  x        |  x        |  x        |  x        |             |
+---+-----------+-----------+-----------+-----------+             |
| H | Column A  | Column B  | Column C  | Column D  |             |
+---+-----------+-----------+-----------+-----------+             |
| 1 |           |           |           |           |  x          |
+---+-----------+-----------+-----------+-----------+             |
| 2 |           |           |           |           |  x          |
+---+-----------+-----------+-----------+-----------+             |
| 3 |           |           |           |           |  x          |
+---+-----------+-----------+-----------+-----------+             |
|                    + Row                                         |
+------------------------------------------------------------------+
| [Sheet 1] [Sheet 2] [+]                                         |
+------------------------------------------------------------------+
```

## Cell Editing

### Selecting Cells

- **Click** any cell to select it — blue outline appears
- Active cell reference shown in toolbar (e.g., "B3", "AH" for header row)
- Formula bar shows the cell's current value

### Entering Edit Mode

| Action | Result |
|--------|--------|
| **Double-click** a cell | Opens inline input in the cell |
| **Start typing** | Opens edit with the typed character |
| **Press Enter or F2** | Opens edit with current value |
| **Press Delete or Backspace** | Clears cell and opens edit |
| **Edit the formula bar** | Opens edit via the formula bar |

### Committing Edits

| Action | Result |
|--------|--------|
| **Enter** | Commits edit, moves selection down one row |
| **Tab** | Commits edit, moves selection right one column |
| **Shift+Tab** | Commits edit, moves selection left one column |
| **Click another cell** | Commits edit, selects the clicked cell |
| **Blur (click outside)** | Commits edit |
| **Escape** | Cancels edit, reverts to original value |

### Keyboard Navigation (when not editing)

| Key | Action |
|-----|--------|
| **Arrow Down** | Move selection down |
| **Arrow Up** | Move selection up (including to header row) |
| **Arrow Right** | Move selection right |
| **Arrow Left** | Move selection left |
| **Tab** | Move selection right |
| **Shift+Tab** | Move selection left |

### Important: Cell styles are preserved on edit

When you edit a cell that has formatting (bold, alignment, fill color), the formatting is preserved. Only the text content changes.

## Cell Formatting

The format bar is located between the toolbar and the grid.

### Bold

- Click **B** button to toggle bold on the active cell
- Active state: blue background when the cell is bold
- Bold cells render with `font-weight: bold` in the grid
- Bold exports to .xlsx as bold cell font

### Text Alignment

Three buttons:
| Button | Alignment |
|--------|-----------|
| **left arrow** | Left align |
| **center arrow** | Center align |
| **right arrow** | Right align |

Active alignment is highlighted. Alignment exports to .xlsx.

### Fill Color (Background)

- **Color picker**: click the colored square to open the browser color picker
- Select a color to set the cell background
- **clear** link: removes the background color
- Background color renders in the grid (suppressed on the active cell to preserve blue selection highlight)
- Fill color exports to .xlsx as cell fill pattern

### Document-Level Font

| Control | Effect |
|---------|--------|
| **Size dropdown** | 8, 9, 10, 11, 12, 14, 16, 18, 20, 24pt — changes the base font size for the entire spreadsheet |
| **Font dropdown** | Calibri, Arial, Times New Roman, Helvetica, Courier New — changes the base font family |

These are document-level settings (affect all cells uniformly).

## Row and Column Operations

### Adding

| Action | How |
|--------|-----|
| Add row | Click **+ Row** at the bottom of the grid |
| Add column | Click **+** in the column header area (rightmost header cell) |

New rows are added at the bottom with empty cells. New columns are added at the right.

### Deleting

| Action | How | Constraint |
|--------|-----|------------|
| Delete row | Click **x** at the end of any data row | Cannot delete the last row |
| Delete column | Click **x** below any column letter header | Cannot delete the last column |

## Sheet Management

### Sheet Tabs

Sheet tabs are displayed at the bottom of the editor. Each table node in the document becomes a separate sheet.

| Action | How |
|--------|-----|
| **Switch sheets** | Click a sheet tab |
| **Add sheet** | Click the **+** button next to the last tab |
| **Rename sheet** | **Double-click** the tab name — an inline text input appears. Press **Enter** to confirm, **Escape** to cancel |
| **Delete sheet** | Click the **x** on a tab — confirms with dialog. Cannot delete the last sheet |

New sheets start with 3 columns (A, B, C) and 3 empty rows.

### Sheet Names in Export

Sheet names set via the rename feature are preserved in the .xlsx export. Each sheet tab becomes a separate Excel worksheet with the assigned name.

## XLSX Export Details

When exporting to Excel:
- Each sheet tab becomes a separate worksheet
- Sheet names from the editor are used
- Header row exports with bold font, gray fill (#E0E0E0), centered alignment
- Data cells export with thin borders and text wrapping
- Per-cell bold, alignment, and fill color are preserved in export
- Column widths are auto-calculated from content (plus 4-character padding)
- Print area is configured with fit-to-page
- Non-table content (headings, text) is written to a "Content" sheet

---

# Portal Proposal Sections (Pipeline Context)

When editing proposal sections in the portal (`/portal/{tenant}/proposals/{id}/sections/{sectionId}`), the canvas editor includes additional collaboration features not available in the admin Document Builder.

## Additional Features in Portal

### Watermark Overlay

The document page shows a semi-transparent watermark indicating the current status:
- **EMPTY** — no content yet
- **AI DRAFT** — AI has drafted content, pending human review
- **DRAFT** — in progress, being edited
- **FOR REVIEW** — submitted for review
- (no watermark when accepted/approved)

### Change Indicators

Every node shows who last edited it:
- **Compact mode** (node not selected): colored dot + first name
- **Expanded mode** (node selected): full name, action type, timestamp
- Color is consistent per actor (same person always gets the same color)

### Per-Node Comments

In the **Node** tab of the sidebar, when a node is selected:
1. **Comments section** appears below the history
2. Shows all comments on this node with author, text, timestamp
3. **Add comment**: type in the input, press Enter or click Add
4. **Resolve**: click "Resolve" on any comment to mark it resolved (grayed out)
5. Comments are stored in the database, not in the JSON — they persist across sessions and are visible to all collaborators

### AI Revision Panel

In the **Node** tab, when a text_block or heading node is selected:

**8 Quick Actions:**
| Action | What AI Does |
|--------|-------------|
| **Regenerate** | Rewrites the entire node content from scratch |
| **Make shorter** | Condenses the text while preserving key points |
| **Make longer** | Expands with more detail and supporting content |
| **More specific** | Adds concrete details, numbers, technical specifics |
| **Simpler language** | Reduces complexity, uses plainer words |
| **Stronger opening** | Rewrites the first sentence to be more impactful |
| **Add metrics** | Inserts quantitative data and measurements |
| **Fix compliance** | Adjusts content to match solicitation requirements |

**Custom prompt**: type any instruction for the AI (e.g., "Add a paragraph about our Phase I results") and click submit.

**After AI revision:**
- Node content is replaced with the AI-generated version
- Provenance changes to "ai_draft"
- History records "AI revision" entry
- User can Accept or Revert the change

### Library Integration

**Replace from Library** button in the Node tab:
1. Opens the Library Picker search interface
2. Search by category or text query
3. Results ranked by outcome score (atoms from awarded proposals first)
4. Shows usage count, category, and outcome indicator
5. Click an atom to replace the selected node's content
6. Provenance updates to "library" with the atom ID

### Read-Only Mode (Locked Proposals)

When a proposal is locked (advanced to "final" stage):
- All editing is disabled — nodes cannot be modified
- Export buttons become available (export requires lock)
- The editor renders in read-only mode
- Unlock requires admin action after the first unlock

### Stage Workflow

Proposals advance through configurable gates:
```
draft → pink_team → red_team → gold_team → final → submitted
```

The StageControl component in the proposal workspace shows:
- Progress dots for each gate
- Current stage highlighted
- **Advance** button (admin only) to move to next stage
- **Lock/Unlock** buttons at the final stage

---

# Common Workflows

## Build a 5-page whitepaper (DOCX)

1. Admin > Document Builder > **New Document**
2. Title: "Technical Whitepaper — [Topic]"
3. Preset: **Custom**
4. **Settings** tab:
   - Margins: 1" all sides
   - Font: Times New Roman, 12pt
   - Line Spacing: Single (1.0)
   - Footer: click "+ Add footer", template: `Page {n} of {N}`
5. **Add** tab: insert **TOC**
6. **Add**: **Heading** (H1) — "1.0 Introduction"
   - Set numbering to "1.0"
7. **Add**: **Paragraph** — type introductory text
   - Select key terms, click **B** to bold them
8. **Add**: **Heading** (H2) — "1.1 Background"
   - Set numbering to "1.1"
9. **Add**: **Paragraph** — type background content
   - Use *I* for technical terms, **B** for emphasis
10. **Add**: **Image** — click to upload a system diagram
11. **Add**: **Caption** — prefix "Figure", number 1, text "System Architecture Overview"
12. **Add**: **Heading** (H1) — "2.0 Technical Approach"
13. **Add**: **Bullet List** — type approach items, indent sub-items with **>**
14. **Add**: **Table** — create a comparison table, add rows/columns as needed
15. **Add**: **Footnote** — marker "1", text for references
16. Click **Save**
17. Click **Export .docx** — opens in Word

## Build a cost volume (XLSX)

1. Admin > Document Builder > **New Document**
2. Title: "Cost Volume — [Topic Number]"
3. Preset: **Spreadsheet**
4. Double-click "Sheet 1" tab > rename to **"Labor"**
5. Edit header cells: Name | Role | Hours | Rate ($/hr) | Total
6. Fill in personnel rows
7. Select "Total" header — click **B** to bold, click center alignment
8. Select total amount cells — set fill color to light yellow
9. Click **+** tab to add sheet > rename to **"Materials"**
10. Headers: Item | Quantity | Unit Cost | Total
11. Fill in materials data
12. Click **+** tab > rename to **"Travel"**
13. Headers: Trip | Purpose | Travelers | Per Diem | Airfare | Total
14. Click **Save**
15. Click **Export .xlsx** — opens in Excel with 3 worksheets

## Build a CSO briefing (PPTX)

1. Admin > Document Builder > **New Document**
2. Title: "CSO Phase I Briefing — [Topic]"
3. Preset: **CSO Slide Deck**
4. **Settings** tab: add footer `{company_name} | Slide {n} of {N}`
5. On Slide 1:
   - **Add**: **Heading** (H1) — "Company Name"
   - **Add**: **Paragraph** — "Topic Title — AFWERX CSO Phase I"
   - **Add**: **Paragraph** — "PI: Dr. Smith | Company | Date"
6. Click **+ Add Slide**
7. On Slide 2:
   - **Add**: **Heading** (H1) — "Technical Approach"
   - **Add**: **Bullet List** — key approach points
   - **Add**: **Image** — upload a block diagram
8. Click **+ Add Slide**
9. On Slide 3:
   - **Add**: **Heading** (H1) — "Schedule & Milestones"
   - **Add**: **Table** — Phase | Task | Duration | Deliverable
   - Fill in milestone data
10. Continue adding slides...
11. Click **Save**
12. Click **Export .pptx** — opens in PowerPoint

---

# Formatting Cross-Reference

## What Works in Each Canvas

| Feature | Document | Slides | Spreadsheet |
|---------|----------|--------|-------------|
| **Bold** (inline on text) | B toolbar | B toolbar | N/A |
| **Italic** (inline) | I toolbar | I toolbar | N/A |
| **Underline** (inline) | U toolbar | U toolbar | N/A |
| **Superscript** (inline) | x^2 toolbar | x^2 toolbar | N/A |
| **Subscript** (inline) | x_2 toolbar | x_2 toolbar | N/A |
| **Bold** (node/cell level) | Sidebar Format B | Sidebar Format B | Format bar B |
| **Italic** (node level) | Sidebar Format I | Sidebar Format I | N/A |
| **Text alignment** | Sidebar Format | Sidebar Format | Format bar |
| **Font family** (per node) | Sidebar Format | Sidebar Format | Format bar (doc-level) |
| **Font size** (per node) | Sidebar Format | Sidebar Format | Format bar (doc-level) |
| **Text color** | Sidebar Format | Sidebar Format | N/A |
| **Cell background** | N/A | N/A | Format bar Fill |
| **Spacing before/after** | Sidebar Format | Sidebar Format | N/A |
| **Indent** | Sidebar Format | Sidebar Format | N/A |
| **List indent/outdent** | < > per item | < > per item | N/A |
| **Heading numbering** | # input | # input | N/A |
| **Image upload** | Click to upload | Click to upload | N/A |
| **Image resize** | W/H inputs | W/H inputs | N/A |
| **Margins** | Settings tab | Settings tab | N/A |
| **Header/footer** | Settings tab | Settings tab | N/A |
| **Page/slide limit** | Settings tab | Settings tab | N/A |
| **Watermark** | Auto (portal) | Auto (portal) | N/A |
| **Change indicators** | Auto (all) | Auto (all) | N/A |
| **Comments** | Sidebar (portal) | Sidebar (portal) | N/A |
| **AI revision** | Sidebar (portal) | Sidebar (portal) | N/A |
| **Library replace** | Sidebar (portal) | Sidebar (portal) | N/A |
| **Save history** | Header button | Header button | Header button |
| **Export** | .docx (.xlsx) | .pptx | .xlsx |

## What Exports to Each Format

| Feature | DOCX | PPTX | XLSX |
|---------|------|------|------|
| Bold (inline) | TextRun bold | TextProps bold | N/A |
| Italic (inline) | TextRun italics | TextProps italic | N/A |
| Underline (inline) | TextRun underline | TextProps underline | N/A |
| Superscript | TextRun superScript | TextProps superscript | N/A |
| Subscript | TextRun subScript | TextProps subscript | N/A |
| Text color | TextRun color (hex) | N/A | N/A |
| Alignment | Paragraph alignment | N/A | Cell horizontal |
| Font family | TextRun font | TextProps fontFace | Workbook font |
| Font size | TextRun size | TextProps fontSize | Workbook font size |
| Cell bold | N/A | N/A | Cell font bold |
| Cell fill color | Table cell shading | N/A | Cell fill pattern |
| Heading levels | H1/H2/H3 | Title font sizing | N/A |
| Bullet lists | Bullet paragraphs | Bulleted text | N/A |
| Numbered lists | Numbered paragraphs | N/A | N/A |
| Tables | Word tables | Slide tables | Worksheets |
| Images | Placeholder text* | Placeholder text* | N/A |
| Header/footer | Page header/footer | Slide footer | N/A |
| Page numbers | {n}/{N} substitution | Slide numbering | N/A |
| Page breaks | Word page breaks | Slide boundaries | N/A |
| Spacing | Paragraph spacing | N/A | N/A |
| Indent | Paragraph indent | N/A | N/A |

*Image embedding in DOCX/PPTX exports is not yet implemented. Images display correctly in the editor but export as `[Image: alt_text]` placeholder text.

---

# Known Limitations

| Limitation | Affects | Workaround |
|------------|---------|------------|
| Image export is placeholder text | DOCX, PPTX | Add images manually in Word/PowerPoint after export |
| PDF export not implemented | All | Export to DOCX, then Save As PDF in Word |
| No auto-save | All | Click Save frequently |
| No unsaved changes warning on navigation | All | Save before navigating away |
| No undo/redo | All | Use Save History to restore previous versions |
| No real-time collaborative editing | All | Users take turns; comments enable async collaboration |
| TOC is placeholder | DOCX | Insert TOC manually in Word after export |
| URLs export as colored text, not clickable hyperlinks | DOCX | Add hyperlinks manually in Word |
| No drag-and-drop node reorder | Document, Slides | Use Move Up/Down buttons in sidebar |
| No drag-to-reorder sheet tabs | Spreadsheet | Delete and recreate sheets in desired order |
| Slide keyboard navigation | Slides | Use thumbnail clicks to switch slides |
| Cell formulas not supported | Spreadsheet | Use Excel formulas after export |
