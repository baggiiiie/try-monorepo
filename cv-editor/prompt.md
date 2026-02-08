# Agent Prompt: Implement CV Editor MVP

You are implementing a greenfield CV Editor project. All specs and task details are in `PLAN.md`. The PRD is in `prd.md`. Read both files before starting.

## Working Directory

`cv-editor/` — all paths in PLAN.md are relative to this directory.

## Rules

1. **Follow PLAN.md exactly.** Do not add features, refactor beyond what's specified, or deviate from the file structure.
2. **Execute tasks 1 → 2 → 3 → 4 in order.** Do not skip ahead.
3. **Run the verify step at the end of each task.** Do not move to the next task until verification passes.
4. **Update PLAN.md after each task.** See the progress format below.
5. **Do not add code comments** unless the code is genuinely non-obvious.
6. **Do not invent dependencies.** Only use packages listed in PLAN.md: `react`, `react-dom`, `js-yaml`, `dompurify`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`.
7. **Preserve existing files.** `cv-data.yaml`, `cv-template.html`, `prd.md` must not be modified. `build-cv.js` is modified only in Task 2 as described.

## Progress Tracking

After completing each task, append a status block to the bottom of that task's section in PLAN.md:

```
**Status**: ✅ Done
**Verified**: <what you ran and what happened>
**Notes**: <anything the human should review, or "None">
```

If a task fails verification, use:

```
**Status**: ❌ Blocked
**Verified**: <what you ran and what happened>
**Blocked on**: <what went wrong>
```

If you made a decision that deviates from PLAN.md (e.g., a package API is different than expected), use:

```
**Status**: ✅ Done (with deviations)
**Verified**: <what you ran and what happened>
**Deviations**: <what you changed and why>
**Notes**: <anything the human should review>
```

## Task-Specific Guidance

### Task 1: Project Scaffolding

- Check current Tailwind v4 / Vite plugin docs if unsure about config format. Tailwind v4 uses `@tailwindcss/vite` plugin and `@import "tailwindcss"` in CSS — there is no `tailwind.config.js` unless you need one.
- Verify by running `npm install && npm run dev`. Confirm no errors in terminal. You cannot open a browser, so verify the build succeeds and the dev server starts without errors.
- After verifying, kill the dev server (Ctrl+C) before proceeding.

### Task 2: Extract Renderer

- Read `build-cv.js` carefully before starting. Every render function must be moved, not copied-and-left-behind.
- The `renderCV` function must produce the **exact same HTML** as the inline content block in `build-cv.js` lines 56-68. Pay close attention to the order of sections and the exact arguments.
- The `sanitize` parameter on `renderSimpleList` and `renderCV` must be optional. When not provided, items are inserted raw (current behavior). This is critical — `build-cv.js` does not have DOMPurify.
- To verify: save the current `cv.html` as `cv.html.bak`, run `node build-cv.js`, then diff `cv.html` against `cv.html.bak`. The only acceptable difference is the `&amp;` → `&` fix in the "Language & Technical Skills" title.

### Task 3: Iframe Preview Skeleton

- The CSS string in `cv-styles.js` must be extracted verbatim from `cv-template.html` lines 8-158 (everything between `<style>` and `</style>` tags, not including the tags themselves).
- The iframe HTML must include the `postMessage` listener and the `frame-ready` signal exactly as shown in PLAN.md.
- No verification command to run — just ensure the exports are correct and the HTML is well-formed.

### Task 4: Editor Page

- The `?raw` import for `cv-data.yaml` gives you the file contents as a string. Vite handles this natively — no special config beyond what was set up in Task 1.
- The `sandbox="allow-scripts"` attribute on the iframe is important for security. `postMessage` works within sandboxed iframes.
- DOMPurify sanitize function to pass to `renderCV`: `(html) => DOMPurify.sanitize(html, { ALLOWED_TAGS: ['b', 'i', 'a', 'span'], ALLOWED_ATTR: ['class', 'href'] })`
- The debounce must use `setTimeout`/`clearTimeout` in a `useEffect`. Do not install a debounce library.
- Verify by running `npm run dev` (confirm it starts) and `npm run build` (confirm it succeeds with no errors).

## When You're Done

After all 4 tasks are complete and verified, add a final section to the bottom of PLAN.md:

```
---

## Completion

**All tasks complete.** Run `npm run dev` to start the editor.

**Human review needed**:
- <list anything flagged in Notes across tasks, or "Nothing">
```

Using jj-vcs, commit the change with meaningful commit message
