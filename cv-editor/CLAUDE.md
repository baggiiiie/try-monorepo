# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `bun run dev` — Start Vite dev server
- `bun run build` — Production build to `dist/`
- `node build-cv.js` — Generate static `cv.html` from `cv-data.yaml` + `cv-template.html` (no browser needed)

No test or lint commands are configured.

## Architecture

This is a browser-based CV/resume editor built with React 19, Vite, and Tailwind CSS v4. The user edits YAML on the right, and a live A4-formatted preview renders on the left.

### Data flow

1. **YAML source** → edited via CodeMirror 6 in `src/pages/CvEditor.jsx`
2. **Parsing** → `js-yaml` parses YAML into a JS object; errors shown in a banner
3. **Rendering** → `src/lib/cv-renderer.js` converts the data object to HTML strings (with manual escaping via `esc()`)
4. **Sanitization** → `skills` and `distinctions` fields allow limited HTML (`<b>`, `<i>`, `<a>`, `<span>`) via DOMPurify; all other fields are escaped
5. **Preview iframe** → `src/lib/cv-preview-frame.js` generates a self-contained HTML document loaded as `srcDoc`; content is sent via `postMessage`
6. **Pagination** — The iframe's inline script measures content height against A4 dimensions and splits into multiple `.page` divs
7. **Export** — "Export to PDF" sends a `print` message to the iframe, triggering `window.print()`

### Key files

- `cv-data.yaml` — Default CV data (also serves as the YAML schema reference)
- `src/pages/CvEditor.jsx` — Main (and only) page component; contains all state management
- `src/hooks/useCodeMirror.js` — React hook that initializes and manages the CodeMirror 6 editor instance
- `src/lib/cv-renderer.js` — Pure functions that convert CV data → HTML strings (shared between browser app and `build-cv.js`)
- `src/lib/cv-preview-frame.js` — Generates the iframe's full HTML document with pagination logic
- `src/lib/cv-styles.js` — CV print styles as a JS string constant
- `src/lib/cv-styles.css` — Default CV stylesheet (Times New Roman, 10pt)
- `src/lib/cv-template-2.css` / `cv-template-3.css` — Alternative CV stylesheets (Helvetica Neue / Georgia)
- `src/lib/yaml-source-map.js` — Maps YAML object paths to line ranges in the raw YAML string
- `src/lib/yaml-inline-edit.js` — Applies inline edits to YAML by updating nested values via path
- `src/lib/yaml-mutations.js` — Utilities for YAML path parsing, section reordering, and dump formatting
- `src/lib/pdf-extractor.js` — Extracts text from PDF files using pdfjs-dist
- `src/lib/resume-to-yaml.js` — Calls backend API to convert extracted resume text to YAML
- `cv-template.html` + `build-cv.js` — Static HTML generation pipeline (independent of the React app)

### State persistence

YAML content is persisted to `localStorage` under `cv-editor-yaml` and debounced at 300ms.
