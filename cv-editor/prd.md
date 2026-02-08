# CV Editor — Product Requirements Document

## Goal

MVP: a single web page with a split-pane interface — rendered resume preview on the left, editable YAML textarea on the right. Edits update the preview in real time. Desktop only.

## Stack

- **Vite + React** (greenfield)
- **Tailwind CSS** for editor page layout
- **DOMPurify** for HTML sanitization (~3KB gzipped)
- `js-yaml` for YAML parsing

## Decisions

| Question | Decision |
|---|---|
| Framework | Vite + React (SPA). No SSR, no Next.js. |
| Preview isolation | `<iframe srcdoc>` — the existing CV CSS targets `*`, `body`, and `@page`, which cannot be scoped to a wrapper class. Iframe provides true style isolation. Updated via `postMessage` to avoid flicker. |
| Editor surface | `<textarea>` — keep it simple, no CodeMirror. |
| Persistence | localStorage — save YAML on every debounced edit, restore on page load. |
| Mobile | Not supported |
| HTML in YAML | Keep as-is (raw HTML in `skills` and `distinctions`); sanitize with DOMPurify before rendering. Allowlist: tags `b`, `i`, `a`, `span`; attributes `class`, `href`; `href` restricted to `http`, `https`, `mailto` protocols. |
| Module format | Shared renderer written as ESM (`cv-renderer.js`). `build-cv.js` converted to ESM so both consumers use the same module. |

## Phases

### Phase 0 — Project Scaffolding

Set up the greenfield project.

#### Scope

- Initialize `package.json` with Vite + React + Tailwind CSS
- Install dependencies: `react`, `react-dom`, `js-yaml`, `dompurify`, `tailwindcss`
- Configure Vite: dev server, build, raw asset loading for `cv-data.yaml`
- Create minimal `index.html`, `src/main.jsx`, `src/App.jsx`
- Verify dev server runs with a placeholder page
- Convert `build-cv.js` to ESM (change `require` → `import`, `module.exports` → `export`)

### Phase 1 — Live Preview (MVP)

Textarea + rendered CV preview, updated on every keystroke (debounced). This is the MVP.

#### Scope

- **Page**: `src/pages/CvEditor.jsx`
- **Renderer**: Extract pure rendering functions from `build-cv.js` into `src/lib/cv-renderer.js` (ESM). Both `build-cv.js` and the editor page consume this module.
  - `esc(str)` → escaped string
  - `renderDetail(detail)` → HTML string
  - `renderBullets(bullets)` → HTML string
  - `renderEntry(entry)` → HTML string
  - `renderSection(title, entries)` → HTML string
  - `renderSimpleList(title, items)` → HTML string
  - `renderHeader(data)` → HTML string
  - `renderCV(data)` → full HTML content string
- **Layout**: Two-pane CSS grid (Tailwind). Left = iframe preview, right = textarea.
- **State**: Single `yamlString` state, initialized from localStorage (if present) or from `cv-data.yaml` (loaded as a raw string via Vite's `?raw` import).
- **Parse → Render loop**: On textarea change (debounced ~300ms), parse YAML with `js-yaml`, call `renderCV(data)`, send HTML to iframe via `postMessage`. Iframe initializes once with a skeleton that listens for update messages and patches its body content.
- **Error handling**: If YAML parsing fails, show an error banner above the preview with the parse error message and line number. Keep the last valid render visible beneath it.
- **Sanitization**: `renderSimpleList` passes items through DOMPurify with the configured allowlist. The `renderSimpleList` title is escaped with `esc()` — remove the manual `&amp;` encoding currently in `build-cv.js`.
- **CV CSS**: Injected into the iframe document. No scoping needed — iframe provides full isolation.
- **Persistence**: Save `yamlString` to localStorage on every debounced edit. On page load, restore from localStorage if available.

#### Out of scope for MVP

- Source-position mapping / hover highlighting
- LLM CSS editing
- CodeMirror or any rich editor
- Mobile layout
- Print/export button
- Resizable split pane

## File Structure

```
cv-editor/
  package.json
  vite.config.js
  tailwind.config.js
  index.html
  build-cv.js                     # Static build script (ESM, consumes cv-renderer.js)
  cv-data.yaml
  cv-template.html
  src/
    main.jsx
    App.jsx
    pages/
      CvEditor.jsx                # Main editor page
    lib/
      cv-renderer.js              # Shared render logic, extracted from build-cv.js
```

## Renderer Refactor Plan

`build-cv.js` is a CJS script that mixes I/O with rendering. Refactor as follows:

1. Move `esc`, `renderDetail`, `renderBullets`, `renderEntry`, `renderSection`, `renderSimpleList` into `src/lib/cv-renderer.js` as named ESM exports. Add `renderHeader` and `renderCV` that compose them.
2. Convert `build-cv.js` to ESM. It imports the renderer via `import { renderCV, esc } from './src/lib/cv-renderer.js'` and handles only I/O (read YAML, read template, write output).
3. The editor page imports `cv-renderer.js` as a normal ESM import.
4. Fix `renderSimpleList` to sanitize HTML via DOMPurify (browser) or escape fully (build script). The build script can skip sanitization since it processes trusted data from the local YAML file.
5. Fix the `renderSimpleList` call site — the title `'Language &amp; Technical Skills'` should be `'Language & Technical Skills'` with `esc()` handling the encoding.

## Non-Functional Requirements

- No heavyweight dependencies. Prefer small, focused packages.
- All rendering is client-side.
- Performance: preview re-render should feel instant (<100ms for typical CV-sized YAML).

## Future Work (post-MVP)

- **Bidirectional hover highlighting**: source-position mapping between YAML and preview (requires `yaml` npm package for AST with character offsets)
- **LLM CSS editing**: click a preview element → natural-language prompt → updated CSS (requires API server + LLM key)
- **Resizable split pane**: drag handle between editor and preview panels
- **Print/export**: dedicated button with `@media print` preview
- **Mobile layout**: tab-based toggle or stacked layout
- **Rich editor**: CodeMirror or similar for syntax highlighting, line numbers
- **Keyboard shortcuts**: Ctrl+S, Ctrl+Z, Ctrl+P

## Other Ideas

- Maybe [aidenybai/react-grab](https://github.com/aidenybai/react-grab) could be used on the preview panel to select element and ask LLM to update (evaluation needed)
- Maybe we don't need react-grab at all? When user selects an element, just update the html tag with IDs
- Later on, ditch YAML editing for non-tech users:
    - Mouse hover over a section in the preview pane highlights its background, the user should be able to click on it and edit its content in an input field on the left
    - Support "add section", "delete section"
