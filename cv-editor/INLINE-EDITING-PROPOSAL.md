# Inline Editing Proposal: Rich Text Support for Preview Panel

## Current State

The current inline editing uses native `contentEditable` with two modes:
- `data-editable="true"` — plain text only (reads `textContent`)
- `data-editable="html"` — raw HTML (reads `innerHTML`, only used for skills/distinctions)

### Key Problems

1. **No formatting UI** — users must type raw `<b>` tags manually
2. **No keyboard shortcuts** (Ctrl+B, Ctrl+I)
3. **Inconsistent** — bullets and most fields don't support HTML at all
4. **`contentEditable` quirks**: paste brings unwanted formatting, browser-specific undo/redo
5. **Iframe limitations**: Can't easily load external libraries (like Tiptap) inside the sandboxed iframe

### Files Involved

| File | Purpose |
|------|---------|
| `src/lib/cv-preview-frame.js` | Iframe HTML/JS handling contentEditable, click detection, postMessage |
| `src/lib/cv-renderer.js` | Renders CV data to HTML, adds `data-yaml-path` and `data-editable` attributes |
| `src/lib/yaml-inline-edit.js` | Applies inline edits by parsing YAML, updating nested value, re-serializing |
| `src/pages/CvEditor.jsx` | Main component handling `inline-edit` messages from iframe |

---

## Evaluated Options

### Option 1: Add Keyboard Shortcuts to Existing contentEditable

**Effort: Low | Impact: Medium**

Enhance current `contentEditable` by adding:
- `Ctrl/Cmd+B` → wrap selection in `<b>` / remove `<b>`
- `Ctrl/Cmd+I` → wrap selection in `<i>` / remove `<i>`
- Paste handler to strip formatting

**Pros:**
- Minimal code change (~30 lines)
- No new dependencies
- Works with existing architecture

**Cons:**
- No visual indication of formatting (no toolbar)
- Users must know keyboard shortcuts
- Still fighting `contentEditable` quirks

---

### Option 2: Markdown-Style Input with Live Preview

**Effort: Medium | Impact: High**

Store content as markdown (`**bold**`, `*italic*`) in YAML, render to HTML on display.

**Pros:**
- Intuitive syntax many users know
- Clean YAML (no HTML tags)
- Easy to extend (links: `[text](url)`)
- No `contentEditable` formatting issues — it's plain text

**Cons:**
- Requires a markdown parser (~5KB)
- Edit mode shows raw markdown, not WYSIWYG
- May confuse users who expect WYSIWYG

---

### Option 3: Mini Rich-Text Editor (Tiptap/ProseMirror)

**Effort: High | Impact: Very High**

Replace `contentEditable` with Tiptap. On click:
1. Mount a minimal Tiptap instance in-place
2. Show a floating toolbar with B/I/Link buttons
3. On blur, serialize to HTML/markdown and save

**Pros:**
- True WYSIWYG experience
- Proper undo/redo stack
- Clean paste handling built-in
- Extensible (links, lists, etc.)

**Cons:**
- Adds ~40-80KB to bundle
- Iframe sandbox complicates loading external libraries
- Significant architectural change needed

---

### Option 4: Hybrid — Popover Editor Outside Iframe

**Effort: Medium-High | Impact: High**

Keep preview in iframe, but editing happens in a popover rendered by the parent:
1. Click in iframe sends `postMessage` with position and value
2. Parent renders floating popover with Tiptap editor
3. On save, value sent back to iframe

**Pros:**
- Sidesteps iframe sandbox limitations
- Can use any editor library

**Cons:**
- Positioning popover over iframe is tricky
- Feels less "inline"

---

## Recommendation: Tiptap + Markdown + Remove Iframe

Based on our discussion, the recommended approach combines:
- **Remove the iframe** for direct library access
- **Use Shadow DOM** for CSS isolation
- **Tiptap** for WYSIWYG editing
- **Markdown** for storage format in YAML

---

## Iframe vs Direct DOM: Trade-offs

### Why the Iframe Exists

1. **Print isolation**: Iframe has its own document with `@media print` styles. `window.print()` inside iframe only prints CV content.
2. **Style encapsulation**: CV styles isolated from Tailwind — no CSS conflicts.
3. **Security sandbox**: Restricts what scripts can do.

### Problems It Causes

1. **Library loading is hard**: Can't easily import Tiptap inside the iframe.
2. **Communication overhead**: Everything goes through async `postMessage`.
3. **Editing limitations**: `contentEditable` can't be replaced with proper editor.

### Removing the Iframe

**Pros:**
1. Full library access — mount Tiptap, use React components directly
2. Simpler state management — no `postMessage` dance
3. Better DX — easier debugging
4. Richer interactions — tooltips, popovers, drag-and-drop work natively

**Cons:**
1. **CSS isolation lost** — CV styles might conflict with Tailwind
   - *Mitigation*: Use Shadow DOM or CSS Layers (`@layer`)
2. **Print requires extra work**:
   - Use `@media print` to hide editor, show only preview
   - Or open new window/popup with just CV for printing
   - Or generate PDF via library
3. **Pagination logic changes** — measurement div moves to main DOM

---

## Proposed Architecture

### High-Level Changes

1. **Remove iframe** — render CV preview directly in React component tree
2. **Use Shadow DOM** for preview container to isolate CV styles from Tailwind
3. **Mount Tiptap mini-editors** on click for editable elements
4. **Support markdown**: Tiptap parses markdown on paste, serializes to markdown
5. **Store as markdown in YAML**: `**bold**` and `*italic*` in source, rendered to HTML for display
6. **Floating toolbar**: When editing, show B/I/Link toolbar above selection

### Component Changes

| Component | Current | After |
|-----------|---------|-------|
| Preview container | `<iframe>` with embedded HTML | `<div>` with Shadow DOM |
| CV styles | Injected into iframe `<style>` | Injected into Shadow DOM `<style>` |
| Editable fields | Native `contentEditable` | Tiptap mini-editor (mounted on click) |
| Data format for rich fields | Raw HTML (`<b>text</b>`) | Markdown (`**text**`) |
| Print | `iframe.contentWindow.print()` | `@media print` or popup window |
| Pagination | Measurement div inside iframe | Measurement div in Shadow DOM |

---

## Implementation Phases

### Phase 1: Remove iframe, use Shadow DOM
- Refactor `PreviewPane` to render into Shadow DOM
- Move pagination logic to work within Shadow DOM
- Verify print still works via `@media print`

### Phase 2: Add markdown support to renderer
- Add lightweight markdown parser (e.g., `marked` or `micromark`)
- Modify `cv-renderer.js` to parse markdown → HTML for designated fields
- Update `yaml-inline-edit.js` to store markdown as-is

### Phase 3: Integrate Tiptap for inline editing
- Install Tiptap core + extensions (StarterKit, Link)
- Create `<InlineEditor>` React component:
  - Mounts when user clicks editable element
  - Shows floating toolbar (B, I, Link)
  - Serializes to markdown on blur
  - Sends update via callback
- Replace `contentEditable` logic with Tiptap

### Phase 4: Polish and edge cases
- Handle paste (strip unwanted formatting, parse markdown)
- Keyboard shortcuts (Ctrl+B, Ctrl+I, Escape to cancel)
- Undo/redo integration
- Click-outside-to-save behavior

---

## Open Questions

### 1. Shadow DOM vs CSS Scoping

**Shadow DOM:**
- True style isolation
- Slightly more complex (can't style from outside)
- Native browser feature

**CSS Scoping (alternative):**
- Use CSS reset + prefixed classes (`.cv-preview *`)
- Easier to work with
- Less strict isolation

*Need decision: Which approach?*

### 2. Markdown Flavor

Proposed minimal support:
- `**bold**` / `__bold__`
- `*italic*` / `_italic_`
- `[link text](url)`

*Need decision: Is this sufficient, or add more (strikethrough, inline code)?*

### 3. Which Fields Support Formatting

Options:
- **All text fields** (bullets, details, skills, section titles, etc.)
- **Selective** (only bullets and skills — current HTML fields)

*Need decision: Enable everywhere or keep selective?*

### 4. Print Strategy

Options:
1. **`@media print` CSS** — hide editor, show only preview (simplest)
2. **Popup window** — open new window for printing (cleaner UX, extra step)
3. **Client-side PDF generation** — most control, adds dependencies

*Need decision: Which approach?*

---

## Future Considerations

- **Bundle size**: Tiptap adds 40-80KB. Acceptable for now, but note for optimization later.
- **Mobile editing**: Tiptap works on mobile but toolbar positioning needs care.
- **Collaborative editing**: Tiptap supports Yjs for real-time collab if ever needed.

---

## References

- [Tiptap Documentation](https://tiptap.dev/)
- [Shadow DOM MDN](https://developer.mozilla.org/en-US/docs/Web/Web_Components/Using_shadow_DOM)
- [marked.js](https://marked.js.org/) — lightweight markdown parser
- Current implementation notes in `NON-TECHNICAL-UX-IDEAS.md`
