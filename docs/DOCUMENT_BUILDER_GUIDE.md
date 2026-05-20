# Document Builder — User Guide

Admin > Document Builder (`/admin/documents`)

## Quick Start

1. Click **New Document**
2. Enter a title and optional description
3. Pick a preset (or Custom)
4. Click **Create** — opens the editor

---

## Presets

| Preset | Editor | Export | Use For |
|--------|--------|--------|---------|
| Standard Letter | Document canvas | .docx | General documents, whitepapers |
| SBIR Phase I | Document canvas | .docx | 15-page technical volumes, TNR 10pt |
| SBIR Phase II | Document canvas | .docx | 30-page technical volumes, TNR 12pt |
| CSO Slide Deck | Slide editor | .pptx | Briefings, 16:9, Arial 18pt |
| Spreadsheet | Grid editor | .xlsx | Cost volumes, data tables |
| Custom | Document canvas | .docx | Start blank, configure everything |

---

## Document Editor (Letter/Custom)

### Adding Content

1. Click the **Add** tab in the right sidebar
2. Click a content type to insert it after the selected node:
   - **Heading** — H1/H2/H3 with level picker
   - **Paragraph** — text block with formatting toolbar
   - **Bullet List / Numbered List** — editable items with add/remove
   - **Image** — click to upload from disk (PNG, JPEG, GIF, WebP, SVG)
   - **Table** — editable grid with add row/column
   - **Caption** — Figure/Table/Chart prefix with number
   - **Footnote** — marker + text
   - **Link** — URL + display text
   - **Page Break** — section divider
   - **TOC** — table of contents placeholder
   - **Spacer** — vertical spacing

### Editing Content

- **Click any node** to select it (blue border)
- **Text blocks**: click to edit, use the toolbar for **B** (Bold), *I* (Italic), U (Underline), x^2 (Superscript), x_2 (Subscript)
  - Select text first, then click a format button to toggle it
- **Headings**: click to edit text, use dropdown to change level (H1/H2/H3), enter section numbering (e.g., "1.1")
- **Lists**: edit items inline, click **+ Add item** to append, click **x** to remove, use **<** / **>** arrows to outdent/indent items
- **Tables**: click cells to edit, **+ Row** / **+ Column** to expand, **x** on rows to delete, **x** below column letters to delete columns
- **Images**: click to upload, edit alt text and caption, set width/height (px) for resize
- **Captions**: pick prefix (Figure/Table/Chart/Exhibit), set number, edit text
- **Footnotes**: edit marker and text
- **Links**: edit URL and display text

### Formatting a Node (Sidebar > Node Tab)

Select any node, then open the **Node** tab in the sidebar. Below the action buttons you'll see the **Format** section:

**Text Alignment**
- 4 buttons: Left (default), Center, Right, Justify
- Active alignment is highlighted blue
- Alignment exports to DOCX and renders in WYSIWYG

**Font Override**
- **Family** dropdown: Times New Roman, Arial, Calibri, Georgia, Helvetica, Courier New
- **Size** input: 6-72pt (leave blank for document default)
- These override the document-level font set in Settings

**Bold / Italic (Node-Level)**
- **B** toggle: makes the entire node bold
- **I** toggle: makes the entire node italic
- These are node-level (apply to whole block), separate from the inline B/I/U in the text toolbar

**Text Color**
- Color picker: click the swatch to open the browser color picker
- Shows current hex value (e.g., #FF0000)
- **reset** link: removes color override, returns to default black
- Color exports to DOCX

**Spacing**
- **Space Before**: padding above the node (in points, 0-72)
- **Space After**: padding below the node (in points, 0-72)
- Leave blank for auto (default 4pt)

**Indent**
- Left indent in pixels (0-200, step 20)
- Useful for block quotes or nested content

### Inline Formatting (Text Blocks Only)

When editing a text block, a formatting toolbar appears above the textarea:

| Button | What it does | Shortcut |
|--------|-------------|----------|
| **B** | Bold selected text | Select text, click B |
| *I* | Italic selected text | Select text, click I |
| U | Underline selected text | Select text, click U |
| x^2 | Superscript (e.g., citations) | Select text, click |
| x_2 | Subscript (e.g., chemical formulas) | Select text, click |

**How to apply formatting:**
1. Click a text block to enter edit mode
2. Select the text you want to format (click and drag in the textarea)
3. Click a format button — the format is applied to the selection
4. The char range indicator shows which characters are selected
5. Click the same button again on the same selection to toggle it off

**How formatting works internally:**
- Formats are stored as `{ format, start, length }` ranges on the text
- Multiple formats can overlap (e.g., bold + italic on the same text)
- Formatted text renders with proper HTML tags in the WYSIWYG view
- All formats export correctly to DOCX (Word)

### Moving and Deleting

1. Select a node (click it)
2. Go to the **Node** tab in the sidebar
3. Use **Move Up** / **Move Down** to reorder
4. Click **Delete** to remove (red button)
5. Click **Accept** to mark AI-drafted content as accepted

### Document Settings

1. Click the **Settings** tab in the sidebar
2. Configure:
   - **Margins** — top/bottom/left/right in inches
   - **Font** — family (Times New Roman, Arial, Calibri, etc.) and size (6-24pt)
   - **Line Spacing** — single, 1.15, 1.5, double
   - **Page Limit** — set to 0 for unlimited
   - **Header** — click "+ Add header", then edit the template text
   - **Footer** — click "+ Add footer", then edit the template text
3. Header/footer variables: `{company_name}`, `{topic_number}`, `{pi_name}`, `{n}` (page number), `{N}` (total pages)

### Saving

- Click **Save** (blue button, top right) — saves to S3
- The toolbar shows "unsaved" in orange when changes exist
- Save errors appear as red text next to the button

### Exporting

- Click **Export .docx** — downloads a Word document
- Click **Export .xlsx** — only shown if document contains tables
- PDF export is not yet implemented (shows alert)

### Save History

- Click **History (N)** in the header bar to see previous saves
- Each entry shows timestamp and file size
- Click an entry to restore that version (confirms first)

---

## Slide Editor (Presentations)

### Layout

- **Left panel**: slide thumbnails with numbers
- **Center**: current slide (dark background, white surface, 16:9 ratio)
- **Right**: same sidebar as document editor (Add, Node, Format, Settings)

### Creating Slides

- Click **+ Add Slide** at the bottom of the thumbnail panel
- Each slide is separated by a page_break node internally

### Navigating

- Click any thumbnail to switch to that slide
- Current slide has a blue border
- Slide count shown at bottom of thumbnail panel

### Editing Slide Content

- Use the **Add** tab to insert content on the current slide
- All node types work the same as the document editor
- Slides use larger default text (Arial 18pt)
- Footer shows slide number automatically

### Formatting on Slides

The sidebar works identically to the document editor. Select a node on the slide, then use the **Node** tab:

- **Format section**: alignment, font family/size, bold/italic, color, spacing, indent
- **Inline formatting**: select text in a text block, use B/I/U/super/sub toolbar
- **All formatting exports to .pptx**

### Deleting Slides

- Hover over a thumbnail and click the red **x** button
- Cannot delete the last remaining slide

### Exporting

- Click **Export .pptx** — downloads a PowerPoint file

---

## Spreadsheet Editor

### Layout

- **Top row**: title, status, cell reference, formula bar, Export, Save
- **Format bar**: Bold, alignment, fill color, font size, font family
- **Center**: grid with column headers (A, B, C...) and row numbers
- **Bottom**: sheet tabs

### Cell Editing

- **Click** a cell to select it (blue outline)
- **Double-click** or **start typing** to enter edit mode
- **Enter** — commit and move down
- **Tab** — commit and move right
- **Shift+Tab** — commit and move left
- **Escape** — cancel edit
- **Arrow keys** — navigate between cells
- **Delete/Backspace** — clear cell and start editing
- **Formula bar** — shows and edits the active cell's content

### Cell Formatting

Select a cell, then use the format bar above the grid:

| Control | What it does |
|---------|-------------|
| **B** | Toggle bold on the active cell |
| Align buttons | Left / Center / Right alignment |
| Fill color | Cell background color picker |
| **clear** | Remove background color |
| Size dropdown | Change document font size (8-24pt) |
| Font dropdown | Change document font family |

Cell styles (bold, alignment, background color) are:
- Applied visually in the grid immediately
- Preserved across saves
- Exported to .xlsx

### Adding Rows and Columns

- Click **+ Row** at the bottom of the grid
- Click **+** in the column header area to add a column

### Deleting Rows and Columns

- Click the **x** at the end of any row to delete it
- Click the **x** below any column letter to delete it
- Cannot delete the last row or column

### Sheet Management

- Click a **sheet tab** to switch sheets
- Click **+** next to the tabs to add a new sheet
- **Double-click** a tab name to rename it (Enter to confirm, Escape to cancel)
- Click **x** on a tab to delete that sheet (confirms first, cannot delete last sheet)

### Exporting

- Click **Export .xlsx** — downloads an Excel workbook
  - Each sheet tab becomes a worksheet
  - Sheet names are preserved

---

## Common Workflows

### Build a 5-page whitepaper

1. New Document > Custom
2. Settings tab: 1" margins, 12pt Times New Roman, single spacing
3. Settings tab: add footer "Page {n} of {N}"
4. Add: TOC
5. Add: Heading (H1) — "Introduction"
6. Add: Paragraph — write content, use B/I/U toolbar
7. Add: Heading (H2) — "Background"
8. Add: Paragraph
9. Add: Image — upload a diagram
10. Add: Caption — "Figure 1: System Architecture"
11. Continue adding sections...
12. Add: Footnote — reference citations
13. Save > Export .docx

### Build a cost volume spreadsheet

1. New Document > Spreadsheet
2. Double-click "Sheet 1" tab > rename to "Labor"
3. Edit header row: Name, Role, Hours, Rate, Total
4. Fill in data rows
5. + Add Sheet > rename to "Materials"
6. Fill in materials data
7. + Add Sheet > rename to "Travel"
8. Save > Export .xlsx

### Build a CSO briefing deck

1. New Document > CSO Slide Deck
2. Edit the first slide: add Heading "Company Name — Topic Title"
3. Add Paragraph with key points
4. + Add Slide
5. Add Heading "Technical Approach"
6. Add Bullet List with approach items
7. Add Image — upload a diagram
8. Continue adding slides...
9. Save > Export .pptx

---

## Formatting Reference — All Three Editors

### Capabilities by Editor

| Capability | Document | Slides | Spreadsheet |
|------------|----------|--------|-------------|
| **Bold** (inline) | Toolbar: select text, click B | Same | N/A |
| **Italic** (inline) | Toolbar: select text, click I | Same | N/A |
| **Underline** (inline) | Toolbar: select text, click U | Same | N/A |
| **Superscript** (inline) | Toolbar: select text, click x^2 | Same | N/A |
| **Subscript** (inline) | Toolbar: select text, click x_2 | Same | N/A |
| **Bold** (node-level) | Sidebar > Node > Format > B | Same | Format bar > B (per cell) |
| **Italic** (node-level) | Sidebar > Node > Format > I | Same | N/A |
| **Text alignment** | Sidebar > Node > Format | Same | Format bar > align buttons |
| **Font family** | Sidebar > Node > Format > Font | Same | Format bar > font dropdown |
| **Font size** | Sidebar > Node > Format > Size | Same | Format bar > size dropdown |
| **Text color** | Sidebar > Node > Format > Color | Same | N/A |
| **Cell background** | N/A | N/A | Format bar > Fill color |
| **Spacing** | Sidebar > Node > Format > Space | Same | N/A |
| **Indent** | Sidebar > Node > Format > Indent | Same | N/A |
| **List indent/outdent** | < > arrows per item | Same | N/A |
| **Heading numbering** | # input next to level | Same | N/A |
| **Image upload** | Click image node to upload | Same | N/A |
| **Image resize** | W/H inputs when selected | Same | N/A |
| **Header/footer** | Settings tab | Same | N/A |
| **Margins** | Settings tab | Same | N/A |
| **Save history** | History button in header | Same | Same |
| **Export** | .docx (.xlsx if tables) | .pptx | .xlsx |

### What Exports to Each Format

| Feature | DOCX | PPTX | XLSX |
|---------|------|------|------|
| Bold/Italic/Underline | Yes | Yes | Yes (cell bold) |
| Superscript/Subscript | Yes | N/A | N/A |
| Text color | Yes | N/A | N/A |
| Alignment | Yes | N/A | Yes (cell) |
| Font family/size | Yes | Yes | Yes |
| Cell background | Yes (tables) | N/A | Yes |
| Heading levels | Yes (H1-H3) | Yes (font sizes) | N/A |
| Lists | Yes (bullets/numbers) | Yes | N/A |
| Tables | Yes (full) | Yes | Yes (per sheet) |
| Images | Placeholder text* | Placeholder text* | N/A |
| Header/footer | Yes (page numbers) | Yes (slide numbers) | N/A |
| Page breaks | Yes | Yes (slide breaks) | N/A |

*Image embedding in exports is not yet implemented — images upload and display in the editor but export as placeholder text.
