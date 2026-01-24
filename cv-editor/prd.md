# CV Editor — Product Requirements Document

## Goal

A web page at with a split-pane interface: rendered resume preview on the left, editable YAML textarea on the right. Edits to the YAML update the preview in real time. Desktop only.

## Stack

- React + Tailwind CSS (existing)
- `yaml` npm package for parsing with source positions (new dependency — replaces `js-yaml` for the editor only; `build-cv.js` keeps using `js-yaml`)

## Decisions

| Question | Decision |
|---|---|
| Preview isolation | Plain `<div>` (no iframe, no Shadow DOM) — simplest for phase 1 |
| Editor surface | `<textarea>` — no CodeMirror for now |
| Persistence | None — YAML lives in React state only |
| Mobile | Not supported |
| LLM auth | Hardcoded API key via environment variable |
| HTML in YAML | Keep as-is (raw HTML in `skills` and `distinctions`); sanitize before rendering |

## Phases

### Phase 1 — Live Preview

Textarea + rendered CV preview, updated on every keystroke (debounced).

#### Scope

- **Page**: `src/pages/cv-editor.js`
- **Renderer**: Extract pure rendering functions from `build-cv.js` into `src/lib/cv-renderer.js` (ESM). Both `build-cv.js` and the editor page consume this module.
  - `renderSection(title, entries)` → HTML string
  - `renderEntry(entry)` → HTML string
  - `renderBullets(bullets)` → HTML string
  - `renderDetail(detail)` → HTML string
  - `renderSimpleList(title, items)` → HTML string
  - `renderHeader(data)` → HTML string
  - `renderCV(data)` → full HTML content string
  - `esc(str)` → escaped string
- **Layout**: Two-pane CSS grid. Left = preview, right = textarea. No resizable divider yet.
- **State**: Single `yamlString` state, initialized with the contents of `cv-data.yaml` (loaded at build time via `getStaticProps` or bundled as a raw string).
- **Parse → Render loop**: On textarea change (debounced ~300ms), parse YAML with `js-yaml`, call `renderCV(data)`, set preview innerHTML.
- **Error handling**: If YAML parsing fails, show an error banner above the preview with the parse error message and line number. Keep the last valid render visible beneath it.
- **Sanitization**: `renderSimpleList` currently does **not** escape its items (the data contains raw `<b>`, `<a>` tags). For the editor, sanitize with a strict allowlist (`b`, `i`, `a`, `span` + `class` and `href` attributes) before inserting into the preview. Use a simple regex-based sanitizer or a small library — avoid large dependencies.
- **CV CSS**: Inline the styles from `cv-template.html` into the preview `<div>` using a `<style>` tag scoped by a wrapper class (e.g., `.cv-preview`) to avoid bleed into the editor page.

#### Out of scope for Phase 1

- Source-position mapping
- Hover highlighting
- LLM CSS editing
- CodeMirror
- localStorage / persistence
- Mobile layout
- Print/export button

### Phase 2 — Bidirectional Hover Highlighting

Source-position mapping between YAML and the rendered preview.

#### Scope

- **New dependency**: `yaml` npm package (provides AST with source positions; `js-yaml` does not).
- **Source map module**: `src/lib/cv-source-map.js`
  - Parse YAML with `yaml.parseDocument(str)`.
  - Walk the AST, convert each node's character-offset `range` to line numbers.
  - Return a mapping: `{ yamlPath → { startLine, endLine } }`.
- **Renderer changes**: `cv-renderer.js` gains an optional `sourceMap` parameter. When provided, each rendered HTML element gets `data-yaml-path` and `data-yaml-lines` attributes.
- **Preview → Textarea**: On `mouseenter` of a preview element with `data-yaml-lines`, highlight the corresponding lines in the textarea (via a highlight overlay or by scrolling + selecting).
- **Textarea → Preview**: On cursor position change in the textarea, determine which YAML node the cursor is inside, and add a highlight class to the matching preview element.
- **Feedback-loop prevention**: Use a `hoverSource` ref (`"preview"` | `"editor"` | `null`) to suppress echo events.
- **Visual affordance**: Highlighted preview elements get a subtle blue outline. Highlighted textarea lines get a light background tint. Preview elements show `cursor: pointer` on hover.

### Phase 3 — LLM CSS Editing

Click a preview element → type a natural-language prompt → get updated CSS.

#### Scope

- **API route**: `src/pages/api/cv-style.js`
  - `POST /api/cv-style`
  - Request body: `{ css: string, selector: string, prompt: string, apiKey: string }`
  - Validates `apiKey` against `process.env.CV_EDITOR_API_KEY`
  - Calls OpenAI (or Anthropic) with a system prompt: "You are a CSS expert editing a resume stylesheet. Return only the complete updated CSS."
  - Returns `{ css: string }`
  - Rate limiting: simple in-memory counter (max 20 requests/minute)
- **Style prompt UI**: `src/components/cv-editor/StylePrompt.js`
  - Popover anchored to the clicked preview element.
  - Shows the element's name/path + a text input + submit button.
  - Loading spinner during LLM call; disable submit while loading.
  - On success, inject the returned CSS into a `<style>` tag in the preview.
- **API key input**: A small input field in the page header where the user pastes their API key. Stored in React state only (not persisted).
- **Undo**: Maintain a CSS history stack. "Revert last change" button restores the previous CSS.
- **Custom CSS state**: Separate from the base CV CSS. LLM edits only touch the custom CSS layer.

#### Out of scope for Phase 3

- Preview before apply (diff view)
- Quick-action buttons
- Template gallery

## File Structure

```
src/
  pages/
    cv-editor.js                # Main page (Phase 1)
    api/
      cv-style.js               # LLM API route (Phase 3)
  components/
    cv-editor/
      StylePrompt.js            # LLM prompt popover (Phase 3)
  lib/
    cv-renderer.js              # Shared render logic, extracted from build-cv.js (Phase 1)
    cv-source-map.js            # YAML source-position mapping (Phase 2)
```

## Renderer Refactor Plan

`build-cv.js` is a CJS script that mixes I/O with rendering. Refactor as follows:

1. Move `esc`, `renderDetail`, `renderBullets`, `renderEntry`, `renderSection`, `renderSimpleList` into `src/lib/cv-renderer.js` as named ESM exports. Add `renderHeader` and `renderCV` that compose them.
2. `build-cv.js` stays CJS. It imports the renderer via `require()` (or is rewritten to use the renderer functions directly — either approach is fine as long as both paths produce identical output).
3. The editor page imports `cv-renderer.js` as a normal ESM import.
4. Fix `renderSimpleList` to sanitize HTML (allowlist) instead of passing raw strings through.

## Non-Functional Requirements

- No new heavyweight dependencies. Prefer small, focused packages.
- All rendering is client-side. No server-side rendering for the preview.
- The editor page does not need to be indexed by search engines.
- Performance: preview re-render should feel instant (<100ms for typical CV-sized YAML).


## other ideas

- maybe [aidenybai/react-grab](https://github.com/aidenybai/react-grab) could be used on the preview panel to select element and ask LLM to update
- maybe we don't need react-grab at all? when user select an element, just update the html tag with IDs
- later on, we wanna ditch the yaml editing for non-tech user.
    - mouse hover over a section in the preview pane highlights its background, the user should be able to click on it and edit its content on a input field on the left
    - and support 'add section', 'delete section'
