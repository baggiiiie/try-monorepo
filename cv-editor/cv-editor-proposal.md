# CV Editor: Live YAML-to-Resume Editor

## Overview

A web-based CV editor with a split-pane interface: a rendered resume preview on the left and an editable YAML source on the right. Edits to the YAML update the preview in real time. Users can hover over rendered components to see the corresponding YAML, and click on components to send LLM prompts that modify the CSS/layout.

## Architecture

```
YAML string (with source positions)
       │
       ▼
  Parse with `yaml` pkg (preserves line ranges)
       │
       ├──► Rendered HTML with data-yaml-path / data-yaml-lines attributes
       │         │
       │         ▼
       │    <iframe srcdoc>  ◄──── injected CSS (editable via LLM)
       │         │
       │    hover/click events via postMessage
       │         │
       ▼         ▼
  CodeMirror ◄──► highlight sync
```

All rendering happens client-side. No server round-trips except for the LLM CSS-editing feature.

## Core Components

### 1. Split-Pane Layout (`src/pages/cv-editor.js`)

- Two-panel layout using CSS grid.
- Left panel: resume preview (`CvPreview`).
- Right panel: YAML editor (`YamlEditor`).
- Shared state: YAML string, parsed data, custom CSS, selected element path.

### 2. YAML Editor (`src/components/cv-editor/YamlEditor.js`)

- CodeMirror 6 with YAML syntax highlighting.
- On every change (debounced ~300ms), parse YAML and update the preview.
- Supports line-range highlighting driven by hover events from the preview.

### 3. Resume Preview (`src/components/cv-editor/CvPreview.js`)

- Renders the CV HTML inside an `<iframe srcdoc>` for full style isolation.
- The iframe includes the CV CSS and the user's custom CSS.
- Each rendered element carries `data-yaml-path` (e.g., `experience.0`) and `data-yaml-lines` (e.g., `12-25`) attributes.
- Hover and click events are communicated to the parent via `postMessage`.

### 4. CV Renderer (`src/lib/cv-renderer.js`)

- Shared ES module extracted from `build-cv.js`.
- Same `renderSection`, `renderEntry`, `renderBullets`, `renderDetail` functions, adapted for browser use.
- During rendering, each HTML element is annotated with source-mapping attributes.

### 5. LLM Style Editor (`src/components/cv-editor/StylePrompt.js`)

- Popover that appears on clicking a component in the preview.
- Shows the clicked element's name/path and a text input for the user's prompt.
- Calls an API route that sends the current CSS, the target selector, and the prompt to an LLM.
- The returned CSS is injected into the iframe and stored in state.

## Source-Position Mapping

This is the key piece that enables hover-highlighting between the preview and the YAML editor.

### Why `yaml` instead of `js-yaml`

The `yaml` npm package (https://eemeli.org/yaml/) provides `parseDocument`, which returns an AST where every node has byte-offset `range` values. `js-yaml` does not expose source positions.

### How it works

1. Parse the YAML string with `yaml.parseDocument(str)`.
2. Walk the AST. For each node, convert its byte-offset range to line numbers.
3. During HTML rendering, attach `data-yaml-path` and `data-yaml-lines` to each output element.
4. On hover in the iframe, post the `data-yaml-lines` value to the parent.
5. The parent highlights those lines in CodeMirror using `Decoration.line`.
6. Reverse direction: hovering over lines in CodeMirror highlights the matching element in the iframe via `postMessage`.

## Hover & Click Interaction

### Hover

| Event | Source | Action |
|---|---|---|
| `mouseenter` on preview element | iframe | `postMessage({ type: 'hover', yamlPath, yamlLines })` → parent highlights CodeMirror lines |
| `mouseleave` on preview element | iframe | `postMessage({ type: 'unhover' })` → parent clears highlights |
| Cursor moves in CodeMirror | parent | Determine which YAML node the cursor is in → `postMessage({ type: 'highlight', yamlPath })` to iframe → iframe adds highlight class to matching element |

### Click → LLM Prompt

1. User clicks a component in the preview.
2. Iframe sends `postMessage({ type: 'select', yamlPath, selector, currentStyles })`.
3. Parent shows the `StylePrompt` popover.
4. User types a natural-language instruction (e.g., "make this bold and add a bottom border").
5. Parent calls `/api/cv-style` with: current CSS, target selector, and prompt.
6. API route sends this to an LLM (OpenAI / Anthropic), returns updated CSS.
7. Parent injects the new CSS into the iframe via `postMessage`.

## LLM API Route (`src/pages/api/cv-style.js`)

```
POST /api/cv-style
Body: { css: string, selector: string, prompt: string }
Response: { css: string }
```

The system prompt tells the LLM it is a CSS expert editing a resume stylesheet. It receives the full current CSS, the target selector, and the user's instruction. It returns the complete updated CSS.

## File Structure

```
src/
  pages/
    cv-editor.js              # Main page
    api/
      cv-style.js             # LLM API route for CSS editing
  components/
    cv-editor/
      YamlEditor.js           # CodeMirror YAML editor
      CvPreview.js            # iframe preview with postMessage bridge
      StylePrompt.js          # Popover for LLM CSS prompts
  lib/
    cv-renderer.js            # Shared render logic (from build-cv.js)
    cv-source-map.js          # YAML parse + source-position mapping
```

## Dependencies

| Package | Purpose |
|---|---|
| `yaml` | YAML parsing with source positions |
| `@codemirror/lang-yaml` | CodeMirror YAML mode |
| `codemirror` + `@codemirror/view` + `@codemirror/state` | Code editor |
| `openai` (or similar) | LLM API calls for CSS editing |

## PDF / Print Export

Because the preview is an isolated iframe, exporting to PDF is straightforward:

```js
document.getElementById('cv-iframe').contentWindow.print();
```

The browser's print dialog handles the rest. The CV CSS can include `@media print` rules for clean output.

## Future Ideas

- **Template gallery**: Let users pick from preset CSS themes.
- **Version history**: Store YAML snapshots in localStorage or a database.
- **Collaborative editing**: Use CRDT (e.g., Yjs) for real-time multi-user editing.
- **Export to YAML file**: Download the edited YAML for use with `build-cv.js`.
