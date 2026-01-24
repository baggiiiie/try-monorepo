# CV Editor Proposal Review

## Critical Issues

### 1. XSS Vulnerability

`renderSimpleList` in `build-cv.js` does not escape its items, and `cv-data.yaml` already contains raw HTML (`<b>`, `<a>`). In a live editor, this is a self-XSS footgun. Either:

- Sanitize with a strict allowlist before inserting into the preview, or
- Restructure the YAML schema to use structured data instead of raw HTML (e.g., `{ text, bold: true }` instead of `<b>text</b>`)

### 2. LLM Endpoint Exposed Publicly

`/api/cv-style` with no auth on a public blog is an abuse/cost target. Requirements:

- Authentication (at minimum a session or API key check)
- Rate limiting
- Payload size caps
- Validate returned CSS is applied via `styleEl.textContent` (not `innerHTML`) to prevent injection

---

## Architectural Concerns

### 3. iframe `srcdoc` Updates Will Flicker

Setting `srcdoc` on every edit resets scroll, reruns scripts, and creates jank. Instead, initialize the iframe once with a skeleton that listens for `postMessage` commands (`setHTML`, `setCSS`, `highlight`), and update the DOM incrementally.

### 4. Renderer Extraction Is a Refactor, Not a Copy-Paste

`build-cv.js` mixes I/O, parsing, templating, and rendering in a procedural CJS script. Required work:

- Separate pure rendering helpers into ESM
- Parameterize annotation injection (`data-yaml-path`, `data-yaml-lines`)
- Keep `fs`/`path` concerns in the build script only

### 5. Source-Position Ranges Are Character Offsets, Not Byte Offsets

The proposal says "byte-offset range values" but `yaml`'s `.range` gives JS string indices (UTF-16 code units). This matters for non-ASCII characters (e.g., the Korean text in the data). Build an offset-to-line index and test with multi-byte content.

### 6. Bidirectional Hover Sync Has Feedback-Loop Risk

Preview hover → highlight editor → "cursor moved" event → highlight preview → infinite loop. Need a source-of-truth flag to suppress echo events.

### 7. CodeMirror 6 Is Significant New Scope

Zero CM dependencies today, and CM6 requires `next/dynamic` with `ssr: false` in Pages Router. Consider prototyping with a `<textarea>` first; swap in CodeMirror once the render/mapping loop is stable.

### 8. Consider Shadow DOM as an Alternative to iframe

If HTML is sanitized (removing the need for a hard security boundary), Shadow DOM gives style isolation with simpler communication (no `postMessage`), easier highlighting, and no origin quirks.

---

## UX Gaps

### Split-Pane Layout

- **No responsive/mobile story** — a two-panel editor is unusable on narrow screens. Consider a tab-based toggle or stacked layout below a breakpoint.
- **No resizable divider** — users will want to adjust the preview vs. editor ratio. A drag handle between panes is expected in this pattern.
- **Preview scroll resets on every edit** — rebuilding `srcdoc` on change loses the user's scroll position.

### YAML as the Editing Surface

- **High barrier to entry** — YAML is indentation-sensitive and unforgiving. A single misplaced space breaks the parse.
- **No inline error display** — users will type something invalid, the preview will silently go blank, and they won't know why.
- **No graceful degradation on parse errors** — should show the last valid render + an inline error banner with the line number. Never show a blank preview.
- **Raw HTML in YAML values** (e.g., `<b>French</b>`) is confusing for non-technical users. Pick one: structured YAML or a rich-text input.

### Hover-to-Highlight

- **No visual affordance described** — needs a subtle background tint + a left-gutter marker in CodeMirror, and a colored outline in the preview, so the bidirectional link is visually obvious.
- **No hover cursor change** — preview elements should show `cursor: pointer` on hoverable/clickable items to signal interactivity. Without it, users won't discover the feature.

### Click → LLM Style Prompt

- **Discoverability is zero** — no onboarding, tooltip, or empty-state hint telling users they can click elements to restyle them. Add a banner or first-use tooltip.
- **No undo** — LLM-generated CSS replaces the current stylesheet with no way to revert. Add an undo stack or at minimum a "revert last change" button.
- **No preview before apply** — show a diff or before/after toggle so users can accept or reject the LLM's CSS changes.
- **No loading state** — LLM calls take 1–3s. The popover should show a spinner and disable the submit button to prevent double-sends.
- **Prompt input is too open-ended** — users won't know what's possible. Offer quick-action buttons ("make bold", "add border", "increase spacing") alongside the freeform input.

### Print / Export

- **`window.print()` is jarring** — launches the browser's native print dialog with no warning. Add a dedicated "Export PDF" button with an explanation.
- **No print preview** — the preview uses screen CSS; printed output may differ. Add a toggle that applies `@media print` styles in the iframe so users can verify before exporting.

### Missing UX Basics

| Gap | Impact |
|---|---|
| No save/load | Edits are lost on refresh — add localStorage persistence at minimum |
| No keyboard shortcuts | Power users expect Ctrl+S (save), Ctrl+Z (undo CSS), Ctrl+P (print) |
| No accessibility | No ARIA roles, no keyboard nav between panes, iframe content not announced |
| No empty state | What does the page look like before any YAML is loaded? |
| No loading state | Initial parse + render has no skeleton or spinner |

---

## Suggested Phasing

| Phase | Scope | Effort |
|---|---|---|
| 1 | Refactor renderer to ESM, fix escaping, textarea + live preview | Small |
| 2 | iframe/Shadow DOM preview with incremental updates | Medium |
| 3 | `yaml` AST source mapping + bidirectional hover | Medium |
| 4 | CodeMirror 6 integration | Medium |
| 5 | LLM CSS editing (with auth + rate limiting) | Medium |
