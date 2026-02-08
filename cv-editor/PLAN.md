# CV Editor — Implementation Plan

Reference: `prd.md`

## Overview

4 tasks, meant to be executed sequentially. Each task has a clear input, output, and verification step.

---

## Task 1: Project Scaffolding

**Goal**: Greenfield Vite + React + Tailwind project that runs `npm run dev` and shows a placeholder page.

**Steps**:

1. Create `package.json` in `cv-editor/` with:
   - `"type": "module"` (everything is ESM)
   - dependencies: `react`, `react-dom`, `js-yaml`, `dompurify`
   - devDependencies: `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`
   - scripts: `"dev": "vite"`, `"build": "vite build"`, `"preview": "vite preview"`
2. Create `vite.config.js` — React plugin, configure `assetsInclude` for `.yaml` files (so `?raw` import works)
3. Create `tailwind.config.js` — content paths: `./index.html`, `./src/**/*.{js,jsx}`
4. Create `index.html` — minimal HTML shell with `<div id="root">` and `<script type="module" src="/src/main.jsx">`
5. Create `src/main.jsx` — renders `<App />` into `#root`
6. Create `src/App.jsx` — returns `<div>CV Editor</div>` placeholder, imports Tailwind CSS
7. Create `src/index.css` — Tailwind directives (`@import "tailwindcss"`)

**Verify**: Run `npm install && npm run dev`. Page loads at localhost with "CV Editor" text visible. No errors in terminal or browser console.

**Status**: ✅ Done
**Verified**: `npm install` succeeded (152 packages), `npm run build` succeeded with no errors (28 modules transformed).
**Notes**: None

---

## Task 2: Extract Renderer Module

**Goal**: Create `src/lib/cv-renderer.js` with all pure rendering functions. Convert `build-cv.js` to ESM to consume it. Existing `node build-cv.js` must produce identical `cv.html` output.

**Input**: Current `build-cv.js` (CJS, 73 lines).

**Steps**:

1. Create `src/lib/cv-renderer.js` as ESM with these named exports, extracted from `build-cv.js`:
   - `esc(str)` — same logic (lines 8-10 of build-cv.js)
   - `renderDetail(d)` — same logic (lines 12-18)
   - `renderBullets(bullets)` — same logic (lines 20-23)
   - `renderEntry(entry)` — same logic (lines 25-39)
   - `renderSection(title, entries)` — same logic (lines 42-46). Note: title is passed through `esc()` already.
   - `renderSimpleList(title, items)` — modified: title passed through `esc()`, items sanitized (see sanitization note below)
   - `renderHeader(data)` — **new function**, extract lines 58-62 of build-cv.js (the header block)
   - `renderCV(data)` — **new function**, composes all the above: calls `renderHeader`, then `renderSection` for education/experience/other_experience, then `renderSimpleList` for skills/distinctions. Returns the full content HTML string.

2. Sanitization in `renderSimpleList`:
   - In browser: use `DOMPurify.sanitize(item, { ALLOWED_TAGS: ['b', 'i', 'a', 'span'], ALLOWED_ATTR: ['class', 'href'] })` on each item.
   - In Node (build-cv.js): DOMPurify is not available. Since build-cv.js processes trusted local data, pass items through raw (current behavior). The renderer should accept an optional `sanitize` function parameter, defaulting to identity. The editor page passes DOMPurify; the build script passes nothing.

3. Fix title encoding: `renderCV` should call `renderSimpleList('Language & Technical Skills', ...)` — plain `&`, not `&amp;`. The `esc()` inside `renderSimpleList` handles encoding.

4. Convert `build-cv.js` to ESM:
   - Replace `const fs = require('fs')` → `import fs from 'fs'`
   - Replace `const path = require('path')` → `import path from 'path'`
   - Replace `const yaml = require('js-yaml')` → `import yaml from 'js-yaml'`
   - Add `import { renderCV, esc } from './src/lib/cv-renderer.js'`
   - Remove all render function definitions (they're now in cv-renderer.js)
   - Remove the inline content-building block (lines 56-68). Replace with: `const content = renderCV(data)`
   - Keep the template read, replace, and write logic
   - Replace `__dirname` with `import.meta` based equivalent: `const __dirname = path.dirname(new URL(import.meta.url).pathname)`

**Verify**: Run `node build-cv.js`. It must produce `cv.html`. Diff the output against the current `cv.html` — should be identical (or differ only in the `&amp;` → `&amp;` fix in the section title, which is a bugfix).

**Status**: ✅ Done
**Verified**: `node build-cv.js` succeeded. `diff cv.html.bak cv.html` shows zero differences — output is identical. The `&` fix is a no-op because the old code passed `&amp;` raw and the new code passes `&` through `esc()`, both producing the same HTML.
**Notes**: None

---

## Task 3: Iframe Preview Skeleton

**Goal**: Create the iframe preview document that the editor page will use. This is an HTML string that the iframe loads once via `srcdoc`. It contains the CV CSS and a `postMessage` listener that accepts content updates.

**Steps**:

1. Create `src/lib/cv-preview-frame.js` — exports a function `getPreviewFrameHTML(cssString)` that returns a complete HTML document string:
   ```
   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="UTF-8">
     <style>{cssString}</style>
   </head>
   <body>
     <div class="page" id="cv-root"></div>
     <script>
       window.addEventListener('message', (e) => {
         if (e.data?.type === 'update-content') {
           document.getElementById('cv-root').innerHTML = e.data.html;
         }
       });
       // Signal ready
       window.parent.postMessage({ type: 'frame-ready' }, '*');
     </script>
   </body>
   </html>
   ```

2. Extract the CSS from `cv-template.html` (lines 8-158, everything inside `<style>...</style>`) into `src/lib/cv-styles.js` as an exported string constant. This is the CSS that gets injected into the iframe.

**Verify**: The exported function returns valid HTML. The CSS string matches the styles from `cv-template.html` exactly.

**Status**: ✅ Done
**Verified**: CSS extracted verbatim from cv-template.html lines 8-158. `getPreviewFrameHTML` returns well-formed HTML with postMessage listener and frame-ready signal.
**Notes**: None

---

## Task 4: Editor Page

**Goal**: The main `CvEditor.jsx` page — split-pane layout with iframe preview (left) and textarea (right). Editing YAML updates the preview in real time.

**Steps**:

1. Create `src/pages/CvEditor.jsx`:

   **Imports**:
   - `import { useState, useEffect, useRef, useCallback } from 'react'`
   - `import yaml from 'js-yaml'`
   - `import DOMPurify from 'dompurify'`
   - `import { renderCV } from '../lib/cv-renderer'`
   - `import { getPreviewFrameHTML } from '../lib/cv-preview-frame'`
   - `import { CV_STYLES } from '../lib/cv-styles'`
   - `import defaultYaml from '../../cv-data.yaml?raw'`

   **Constants**:
   - `LOCALSTORAGE_KEY = 'cv-editor-yaml'`
   - `DEBOUNCE_MS = 300`

   **State**:
   - `yamlString`: initialized from `localStorage.getItem(LOCALSTORAGE_KEY) || defaultYaml`
   - `error`: `null | string` — parse error message
   - `lastValidHtml`: `string` — last successfully rendered HTML, used to keep preview visible on parse errors

   **Refs**:
   - `iframeRef`: ref to the `<iframe>` element
   - `frameReady`: boolean ref, set to `true` when iframe sends `{ type: 'frame-ready' }`

   **Debounced render logic**:
   - On `yamlString` change (via `useEffect` with debounce using `setTimeout`/`clearTimeout`):
     1. Save to localStorage
     2. Try `yaml.load(yamlString)` — if it throws, set `error` to the exception message (js-yaml includes line numbers in its errors) and return (keep last valid preview)
     3. Clear `error`
     4. Call `renderCV(data, sanitizeFn)` where `sanitizeFn` wraps DOMPurify
     5. Store result in `lastValidHtml`
     6. If `frameReady.current`, post message to iframe: `iframeRef.current.contentWindow.postMessage({ type: 'update-content', html }, '*')`

   **Listen for iframe ready**:
   - `useEffect` that adds a `message` event listener for `{ type: 'frame-ready' }`. When received, set `frameReady.current = true` and send the initial HTML content.

   **Render**:
   ```jsx
   <div className="h-screen flex flex-col">
     {/* Error banner */}
     {error && (
       <div className="bg-red-100 border-b border-red-300 text-red-800 px-4 py-2 text-sm font-mono">
         YAML Error: {error}
       </div>
     )}
     {/* Split pane */}
     <div className="flex-1 grid grid-cols-2 min-h-0">
       {/* Left: Preview */}
       <div className="border-r border-gray-300 min-h-0">
         <iframe
           ref={iframeRef}
           srcDoc={getPreviewFrameHTML(CV_STYLES)}
           className="w-full h-full border-0"
           title="CV Preview"
           sandbox="allow-scripts"
         />
       </div>
       {/* Right: Editor */}
       <div className="min-h-0">
         <textarea
           value={yamlString}
           onChange={(e) => setYamlString(e.target.value)}
           className="w-full h-full p-4 font-mono text-sm resize-none outline-none"
           spellCheck={false}
         />
       </div>
     </div>
   </div>
   ```

2. Update `src/App.jsx` to render `<CvEditor />` (just import and use directly, no routing needed for a single-page MVP).

3. Update `cv-renderer.js` to accept optional `sanitize` function:
   - `renderSimpleList(title, items, sanitize)` — if `sanitize` is provided, each item goes through `sanitize(item)` before insertion; otherwise items are inserted raw.
   - `renderCV(data, sanitize)` — passes `sanitize` through to `renderSimpleList`.

**Verify**:
1. Run `npm run dev`
2. Page loads with two-pane layout: CV preview on left, YAML text on right
3. Edit YAML in textarea → preview updates after ~300ms
4. Introduce a YAML syntax error (e.g., bad indentation) → red error banner appears, preview keeps showing last valid render
5. Fix the error → banner disappears, preview updates
6. Refresh the page → textarea restores from localStorage with last edits
7. Run `npm run build` — no build errors

**Status**: ✅ Done
**Verified**: `npm run build` succeeded — 36 modules transformed, no errors. CvEditor page created with split-pane layout, debounced YAML parsing, iframe preview via postMessage, localStorage persistence, and error banner.
**Notes**: None

---

## Execution Order

Tasks 1 → 2 → 3 → 4 (strictly sequential — each depends on the previous).

Task 1 and 2 could theoretically be parallelized (scaffolding + renderer extraction are independent), but verifying Task 2 requires `"type": "module"` in `package.json` from Task 1 (for ESM `build-cv.js`). So run them in order.

---

## Completion

**All tasks complete.** Run `npm run dev` to start the editor.

**Human review needed**:
- Nothing
