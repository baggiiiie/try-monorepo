# CV Editor — Product Requirements Document

## Goal

MVP: a single web page with a split-pane interface — rendered resume preview on the left, editable YAML textarea on the right. Edits update the preview in real time. Desktop only.

## Stack

- **Vite + React** (greenfield)
- **Tailwind CSS** for editor page layout
- **DOMPurify** for HTML sanitization (~3KB gzipped)
- `js-yaml` for YAML parsing

## Decisions

| Question          | Decision                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework         | Vite + React (SPA). No SSR, no Next.js.                                                                                                                                                                                      |
| Preview isolation | `<iframe srcdoc>` — the existing CV CSS targets `*`, `body`, and `@page`, which cannot be scoped to a wrapper class. Iframe provides true style isolation. Updated via `postMessage` to avoid flicker.                       |
| Editor surface    | `<textarea>` — keep it simple, no CodeMirror.                                                                                                                                                                                |
| Persistence       | localStorage — save YAML on every debounced edit, restore on page load.                                                                                                                                                      |
| Mobile            | Not supported                                                                                                                                                                                                                |
| HTML in YAML      | Keep as-is (raw HTML in `skills` and `distinctions`); sanitize with DOMPurify before rendering. Allowlist: tags `b`, `i`, `a`, `span`; attributes `class`, `href`; `href` restricted to `http`, `https`, `mailto` protocols. |
| Module format     | Shared renderer written as ESM (`cv-renderer.js`). `build-cv.js` converted to ESM so both consumers use the same module.                                                                                                     |

## Non-Functional Requirements

- No heavyweight dependencies. Prefer small, focused packages.
- All rendering is client-side.
- Performance: preview re-render should feel instant (<100ms for typical CV-sized YAML).

## Future Work (post-MVP)

- **Bidirectional hover highlighting**: source-position mapping between YAML and preview (requires `yaml` npm package for AST with character offsets)
- **LLM CSS editing**: click a preview element → natural-language prompt → updated CSS (requires API server + LLM key)
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

- upload CV, auto fill in content.
- upload JD, auto generate CV
- left right pane should scroll together
- add different template support
