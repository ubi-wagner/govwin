# MS Office Export Capabilities — Low-Hanging Fruit Analysis

**Purpose:** Map every useful feature in our export libraries to canvas
node types and AI generation patterns. Identify what we can add to the
editor with minimal effort because the export library already supports it.

---

## 1. Word (.docx) via `docx` npm — Full Capability Map

### Already in our canvas model + wired in export

| Feature | Canvas Node | Export | AI Can Generate |
|---------|-------------|--------|-----------------|
| Headings (h1-h3) | `heading` | ✅ HeadingLevel | ✅ |
| Paragraphs | `text_block` | ✅ Paragraph + TextRun | ✅ |
| Bulleted lists | `bulleted_list` | ✅ bullet property | ✅ |
| Numbered lists | `numbered_list` | ✅ numbering property | ✅ |
| Tables | `table` | ✅ Table + TableRow + TableCell | ✅ |
| Page breaks | `page_break` | ✅ pageBreakBefore | ✅ |
| Headers/footers | canvas rule | ✅ Header/Footer | N/A (template) |
| Font control | style override | ✅ TextRun font/size | N/A (template) |
| Margins | canvas rule | ✅ page.margin | N/A (template) |
| Captions | `caption` | ✅ italic Paragraph | ✅ |
| Footnotes | `footnote` | ✅ superscript + text | ✅ |
| URLs | `url` | ✅ colored TextRun | ✅ |

### LOW-HANGING FRUIT — supported by library, NOT yet in our model

| Feature | Effort | Value | How to Add |
|---------|--------|-------|-----------|
| **Bold/italic/underline inline** | 1 hr | HIGH | `TextBlockContent.inline_formats` already defined but export doesn't process them. Wire TextRun per format range. |
| **Table cell merging** | 2 hr | HIGH | Add `rowSpan`/`colSpan` to TableContent cells. `docx` has `VerticalMerge` + `GridSpan`. Critical for cost volumes. |
| **Table cell shading** | 1 hr | MEDIUM | Add `cellStyle` to TableContent. `docx` has `ShadingType`. Header rows with gray bg. |
| **Table borders** | 1 hr | MEDIUM | Already default in `docx`. Add border style options to TableContent. |
| **Real TOC** | 2 hr | HIGH | `docx` has `TableOfContents` class that generates a Word field code. Replace our placeholder with real auto-updating TOC. |
| **Footnotes (proper)** | 2 hr | HIGH | `docx` has `FootnoteReferenceRun` + `FootNotes`. Real footnotes at page bottom, not inline text. Proposal reviewers expect real footnotes. |
| **Watermarks** | 1 hr | HIGH | `docx` has `DocumentBackground` + text watermarks. "DRAFT" watermark during review stages, removed on final. Auto-set from document status. |
| **Comments/annotations** | 3 hr | HIGH | `docx` has `Comment`, `CommentRangeStart/End`, `CommentReference`. Map reviewer comments from node.history to Word comments. Color team feedback becomes visible in Word. |
| **Track changes** | 4 hr | VERY HIGH | `docx` has `InsertedTextRun`, `DeletedTextRun`. Export the diff between versions as tracked changes in Word. Reviewers see exactly what changed between pink team and red team. |
| **Bookmarks + cross-refs** | 2 hr | MEDIUM | `docx` has `Bookmark`, `InternalHyperlink`. "See Section 3.2" links that work in the exported doc. |
| **Math equations** | 2 hr | LOW | `docx` has full MathML support (`MathFraction`, `MathRadical`, etc.). Useful for some DOE/NSF proposals with formulas. |
| **Images (embedded)** | 3 hr | HIGH | `docx` has `ImageRun` with embedded binary data. Currently we output `[Image: alt]` placeholder. Wire S3 fetch → embed in docx. |
| **Multi-column layout** | 1 hr | LOW | `docx` has `Column` for multi-column sections. Rare in proposals but some want 2-column bios. |
| **Page borders** | 1 hr | LOW | `docx` has `PageBorders`. Used on cover sheets. |
| **Highlight color** | 0.5 hr | MEDIUM | `docx` has `HighlightColor` for text highlighting. Useful for showing AI-drafted vs human-edited in review exports. |
| **Symbols** | 0.5 hr | LOW | `docx` has `SymbolRun` for special characters (checkboxes ☑, arrows →). |
| **Tab stops** | 1 hr | MEDIUM | `docx` has `TabStopPosition` + `TabStopType`. Clean alignment in tables-of-figures, schedule milestones. |
| **CheckBoxes** | 1 hr | MEDIUM | `docx` has `CheckBox` + `CheckBoxSymbolElement`. Compliance checklists in the exported doc. |

### What this means for AI generation

Claude can generate canvas JSON nodes that use ALL of these features
because each maps to a simple, structured property on the node type.
For example:

```json
{
  "type": "text_block",
  "content": {
    "text": "Our approach leverages novel ablative materials (TRL 4) developed under prior SBIR Phase I.",
    "inline_formats": [
      { "start": 24, "length": 24, "format": "bold" },
      { "start": 50, "length": 5, "format": "italic" }
    ]
  }
}
```

The AI doesn't need to know about Open XML — it just produces JSON
with typed format ranges. The export engine handles the translation.

---

## 2. PowerPoint (.pptx) via `pptxgenjs` — Capability Map

| Feature | Effort | Value | Notes |
|---------|--------|-------|-------|
| **Slides with positioned content** | Already designed | HIGH | Each canvas "page" = one slide |
| **Text boxes** | 1 hr | HIGH | `pptxgenjs` positions text boxes by x/y/w/h in inches |
| **Styled text** | 1 hr | HIGH | Font, size, color, bold, italic per text run |
| **Images** | 2 hr | HIGH | Embedded or linked, positioned + sized |
| **Tables** | 1 hr | HIGH | `pptxgenjs` renders tables with borders/fills |
| **Charts** | 3 hr | VERY HIGH | Bar, line, pie, area, scatter, doughnut. Generate from tabular data. |
| **Shapes** | 2 hr | MEDIUM | Rectangles, circles, arrows, callouts. Used for system diagrams. |
| **Speaker notes** | 0.5 hr | HIGH | Map node.provenance.comment or reviewer notes to speaker notes. |
| **Slide masters** | 2 hr | HIGH | Branded template with logo/footer. Set once, all slides inherit. |
| **Slide transitions** | 0.5 hr | LOW | Professional but not critical. |

### Key for AFWERX CSO slides

The CSO slide deck (25 slides max) is a distinct format. Our canvas
already has `slide_cso` preset (960×540, 40px margins, Arial 18pt).
The export engine needs to:

1. Each `page_break` node → new slide boundary
2. First `heading` on each slide → title text box (top zone)
3. `text_block` + `bulleted_list` → body text box (center zone)
4. `image` → positioned media element
5. `table` → slide table
6. Speaker notes from node provenance/comments

**This is ~4 hours of work** to wire up. `pptxgenjs` handles everything;
we just walk our nodes and map to slide elements.

---

## 3. Excel (.xlsx) via `exceljs` — Capability Map

| Feature | Effort | Value | Notes |
|---------|--------|-------|-------|
| **Cell formatting** | 1 hr | HIGH | Font, fill, borders, alignment, number formats |
| **Formulas** | 2 hr | VERY HIGH | Auto-calculating cost volumes (hours × rate = total). The AI can generate formula references. |
| **Merged cells** | 1 hr | HIGH | Section headers spanning multiple columns |
| **Column/row sizing** | 0.5 hr | HIGH | Readable output without manual adjustment |
| **Multiple sheets** | 1 hr | HIGH | "Summary" + "Labor" + "Materials" + "Travel" + "Subcontracts" per the SF-1411 structure |
| **Named ranges** | 1 hr | MEDIUM | Structured references for formulas |
| **Conditional formatting** | 2 hr | MEDIUM | Highlight budget items over thresholds |
| **Data validation** | 1 hr | MEDIUM | Dropdown lists for labor categories, cost types |
| **Print area + page setup** | 1 hr | HIGH | Print-ready output matching agency format |
| **Headers/footers** | 0.5 hr | HIGH | Company name + page numbers on printed output |
| **Frozen panes** | 0.5 hr | MEDIUM | Keep headers visible while scrolling |
| **Auto-filters** | 0.5 hr | LOW | Filter by category/type |
| **Charts** | 3 hr | MEDIUM | Budget breakdown visualizations |
| **Comments** | 1 hr | MEDIUM | Reviewer notes on specific cells |

### Excel template approach for cost volumes

Instead of building a spreadsheet editor, we:

1. **Store SF-1411 / SF-424A templates** as .xlsx files in S3
2. **Structured cost form in the UI** captures line items:
   - Labor categories × hours × rates
   - Materials, equipment, travel, subs, other direct
   - Indirect rates, fee/profit
3. **`exceljs` populates the template cells** with the form data
4. **Formulas in the template auto-calculate** totals, subtotals, roll-ups
5. **Export produces a ready-to-submit spreadsheet**

The AI's role: given the RFP's cost volume requirements + the customer's
typical cost structure (from prior proposals in the library), generate
the initial line-item breakdown that populates the form.

---

## 4. What to build NOW (priority by impact/effort)

### Tier 1 — Wire this week (< 2 hours each, massive value)

1. **Inline bold/italic/underline in text_blocks**
   - TextBlockContent.inline_formats already in the type
   - Wire in canvas-renderer.tsx (render spans with styles)
   - Wire in docx-exporter.ts (multiple TextRun per format range)
   - AI generates: `{ inline_formats: [{ start: 0, length: 12, format: "bold" }] }`

2. **Real TOC generation**
   - Replace `[Table of Contents]` placeholder with `docx.TableOfContents`
   - Auto-generates from heading nodes on export
   - Zero effort for the user — just include a `toc` node

3. **Watermark from document status**
   - `metadata.status === 'ai_drafted'` → "DRAFT" watermark
   - `metadata.status === 'review'` → "FOR REVIEW" watermark
   - `metadata.status === 'accepted'` → no watermark
   - Automatic — no user action needed

4. **Table cell shading + header row styling**
   - Expand TableContent: `header_style: { bg: '#f0f0f0', bold: true }`
   - `docx` ShadingType maps directly
   - Every proposal table looks professional on export

### Tier 2 — Wire next week (2-4 hours each, high value)

5. **Embedded images from S3**
   - Fetch image bytes from S3 during export
   - `docx.ImageRun` embeds them in the .docx
   - System diagrams, org charts, facility photos actually appear

6. **Word comments from reviewer feedback**
   - Map `node.history` entries with `action === 'edited'` + `comment`
     to `docx.Comment` + `CommentRangeStart/End`
   - Pink/red/gold team feedback visible as Word comments
   - Reviewer opens the .docx and sees exactly what was flagged

7. **PPTX export for CSO slides**
   - Install pptxgenjs ✅ (just installed)
   - Walk nodes, map to slide elements
   - Branded master slide with company logo zone
   - Speaker notes from provenance

8. **Excel template population for cost volumes**
   - Install exceljs ✅ (just installed)
   - Structured cost form component
   - Template stored in S3
   - `exceljs` populates cells + formulas auto-calculate

### Tier 3 — Wire later (4+ hours, medium value)

9. **Track changes between versions**
10. **Bookmarks + cross-references**
11. **Charts in slides + spreadsheets**
12. **Multi-column layout for bios/past-performance**
13. **Math equations for DOE/NSF technical proposals**
14. **Checkbox compliance checklists**

---

## 5. AI Generation Patterns

The key insight: Claude generates **canvas JSON nodes**, not raw
document markup. Each node type is a bounded container with a
well-defined schema. This means:

### Claude sees:
```
Generate a text_block node for the "Technical Approach" section.
The canvas allows: 10pt Times New Roman, single-spaced, 468pt content width.
The page has ~55 lines available. This section should use ~3 pages = ~165 lines.
The evaluation criteria (from the compliance matrix) are:
  1. Scientific/technical merit (40%)
  2. Understanding of the problem (20%)
  3. Qualification of key personnel (20%)
  4. Potential for commercialization (20%)

Customer's library has these relevant atoms:
  - "hypersonic_materials_approach_v2" (from AF241-001, awarded)
  - "tps_testing_methodology" (from AF241-001, awarded)

Generate the text_block content addressing criteria 1 with inline
formatting: bold key terms, italic paper references.
```

### Claude produces:
```json
{
  "type": "text_block",
  "content": {
    "text": "Our technical approach builds on the ablative material system demonstrated in Phase I (AF241-001), which achieved a Technology Readiness Level (TRL) of 4. The key innovation is a novel ceramic matrix composite that withstands sustained temperatures above 2,500°F...",
    "inline_formats": [
      { "start": 78, "length": 37, "format": "bold" },
      { "start": 120, "length": 25, "format": "italic" }
    ]
  },
  "provenance": {
    "source": "ai_draft",
    "library_unit_id": "lib_hypersonic_materials_approach_v2"
  }
}
```

The AI doesn't format a Word document — it produces typed JSON atoms
within the canvas constraints. The export engine handles the formatting.
This separation means:
- The AI can be tested against the JSON schema (deterministic)
- The same AI output renders in the editor AND exports to Word/PPT/PDF
- The AI can reason about space: "I have 165 lines, I'll allocate
  50 to the approach, 40 to methodology, 30 to schedule, 20 to risks,
  25 to deliverables"
