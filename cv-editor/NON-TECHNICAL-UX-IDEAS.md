# Making the CV Editor Accessible to Non-Technical Users

## What we have now

Split-pane app: YAML code editor on the right, live A4 preview on the left. PDF import via LLM. The YAML schema is well-structured but assumes understanding of indentation, keys like `bullets`/`details`, nested object variants (`italic`/`text`/`coursework`), and inline HTML. This is a power-user tool.

---

## 1. Form-Based Editing (highest impact, most practical)

Structured form that mirrors the YAML schema. The data model is already clean enough to drive a form directly.

- **Header section**: Simple text inputs for name, phone, email, LinkedIn URL/label, availability.
- **Section cards** (Education, Experience, Other Experience): Each entry becomes an expandable card with fields for dates, institution, location, degree/role. Details and bullets become sub-lists with "add" buttons.
- **Detail type picker**: Instead of the `italic`/`text`/`coursework` YAML variants, offer a dropdown: "Plain text", "Italic note", "Relevant coursework". Hides schema complexity entirely.
- **Skills & Distinctions**: Simple list of text inputs with a rich-text toggle (bold, italic, links) instead of raw HTML.
- **Drag-and-drop reordering** for entries within sections and for bullet points.
- **Two-way sync**: Form edits update the YAML, YAML edits update the form. A tab toggle lets power users switch to raw YAML. The form is just an alternative way to produce the same YAML string.

**Why this is the best starting point**: The existing `cv-data.yaml` structure _already is_ a form schema. Each section has a fixed shape. The renderer's expectations define the form fields.

> **Review**: Agree this is highest-impact. A few observations from the actual code:
>
> - The data shape has subtle polymorphism that complicates form generation: `details` entries can be plain strings, `{ italic }`, `{ text }`, or `{ coursework }` — and entries optionally have `degree` _or_ `role` (never both). The "detail type picker" dropdown is the right abstraction, but make sure the form handles the string-shorthand case too (currently `renderDetail` accepts raw strings).
> - `skills` and `distinctions` allow inline HTML (`<b>`, `<a>`, `<span>`) sanitized by DOMPurify. A simple text input won't cut it — you'll need either a small rich-text widget (e.g., Tiptap with a minimal toolbar for bold/italic/link) or a markdown-style input with preview. This is a meaningful sub-project on its own.
> - "Two-way sync" is trickier than it sounds. `js-yaml.dump()` won't preserve comments, quoting style, or key order from hand-edited YAML. If a power user tweaks the YAML, switches to form mode, and switches back, their formatting will be gone. Consider treating YAML as the source of truth and only generating it from the form (not round-tripping back). Or accept the formatting loss and document it.
> - Drag-and-drop reordering is nice-to-have but adds significant complexity (library choice, keyboard accessibility, mobile touch). Defer it to a later phase; simple up/down arrow buttons achieve 80% of the value.

---

## 2. Dual-Mode Toggle (Form + YAML)

Instead of replacing the YAML editor, add a mode switcher in the right panel:

- **"Visual" mode** (default for new users): The form-based editor.
- **"Code" mode**: The existing CodeMirror editor for power users.
- Switching modes round-trips through `js-yaml.load()` / `js-yaml.dump()`. YAML stays the single source of truth.
- First-time users land in Visual mode. A subtle "Switch to code" link is available but not prominent.

> **Review**: Clean idea. Implementation-wise, `CvEditor.jsx` currently owns all state and mounts CodeMirror directly. To add a mode toggle:
>
> - Extract the CodeMirror setup into its own `<YamlEditor>` component that accepts `value` and `onChange`. Then the form view becomes a sibling component that also accepts `value` (parsed) and `onChange` (serialized back to YAML string).
> - The toggle should conditionally render one or the other — don't keep CodeMirror mounted while hidden, because it doesn't resize correctly when invisible. Destroy and recreate on switch, seeding it with the current `yamlString`.
> - Default mode (form vs. code) could be persisted to `localStorage` alongside the YAML content.
> - One risk: if the YAML is malformed, you can't parse it into the form. You'll need a fallback — force code mode with an error banner saying "Fix YAML errors before switching to Visual mode."

---

## 3. Inline/Direct Editing on the Preview

Click on the preview to edit — the most intuitive approach.

- Click on the name → inline text input appears.
- Click on a bullet point → edit it in place.
- Click on a section → "add entry" option expands.
- The preview iframe already renders as HTML. Overlay transparent contenteditable regions or detect clicks via `postMessage` and map them back to YAML paths.
- More complex to implement but feels magical — "I see my CV, I click what I want to change."

> **Review**: Agree it feels magical, but the implementation cost is high and the iframe sandbox makes it harder:
>
> - The preview iframe uses `sandbox="allow-scripts allow-modals"` — it can't communicate with the parent except via `postMessage`. You'd need to wire click events in the iframe to send back a YAML path (e.g., `education[0].bullets[1]`), and the parent would need to map that back to a cursor position or form field.
> - The current renderer (`cv-renderer.js`) outputs flat HTML strings with no data attributes or IDs linking elements back to their YAML source. You'd need to annotate every rendered element with `data-path="education.0.institution"` etc., which is a significant rewrite of the renderer.
> - `contentEditable` inside the iframe is fragile — rich text pasting, undo/redo, and cursor behavior all have browser quirks. And edits would need to be reverse-mapped back to the correct YAML field, which is non-trivial for nested structures.
> - A pragmatic middle ground: make preview elements _clickable_ (not editable) — clicking a bullet scrolls the YAML editor to that line, or opens the form to that field. This gives "click what you want to change" without the contentEditable complexity.

---

## 4. Natural Language / AI-Powered Input

Extend the existing LLM pattern from PDF import:

- **"Describe your experience" box**: User types _"I worked at Google as a software engineer from 2022-2024 in Mountain View. I built internal tools and led a team of 3."_ LLM structures it into a YAML entry.
- **AI bullet point rewriter**: Select a bullet, click "Improve", LLM rewrites it (action verbs, quantified results). Show before/after.
- **"Add from LinkedIn"**: Paste LinkedIn profile text, LLM extracts and structures the data.
- **Section-level AI assistant**: Small chat bubble per section for guided Q&A.
- **Tone/style adjuster**: Slider for "concise vs. detailed", "formal vs. conversational". LLM rewrites bullets to match.

> **Review**: The existing `server/convert-resume.js` already shells out to `opencode` CLI as the LLM backend. This is a local-only, non-portable approach — it won't work in any deployment beyond your dev machine. Before expanding AI features:
>
> - Decide on an LLM integration strategy. Options: (a) keep it server-side with a proper API key (OpenAI/Anthropic), (b) use a browser-side LLM API (e.g., WebLLM, or direct API calls from the client with user-provided keys), or (c) keep the current `opencode` approach but accept it's dev-only.
> - "AI bullet rewriter" is the best bang-for-buck AI feature. It's a single-input → single-output transform, easy to prompt, and high perceived value. Build this first.
> - "Describe your experience" free-text → YAML is essentially what PDF import already does. You could reuse `buildPrompt()` from `convert-resume.js` with minor changes.
> - The tone/style slider is gimmicky and hard to make reliable. LLMs don't have a consistent "formal-o-meter." Skip this unless you find it actually useful in practice.
> - "Add from LinkedIn" has a legal gray area (scraping ToS). Paste-and-parse is fine; auto-fetching is not.

---

## 5. Templates and Wizards

### Onboarding wizard (first-time users with no existing CV)

1. **Pick a template**: 3-4 visual previews ("Academic", "Corporate", "Creative", "Minimal"). Each is a different YAML + style combo. Requires making `CV_STYLES` configurable.
2. **Basic info**: Name, contact, availability (simple form).
3. **Add sections**: Checkboxes — Education? Experience? Volunteer work? Skills?
4. **Fill in details**: Guided form for each enabled section, one at a time.
5. **Review & polish**: Show preview, offer AI suggestions.

### Starter templates by profession

"Marketing Graduate", "Software Engineer", "Designer", "Recent Graduate" — pre-filled with placeholder content and guiding comments.

### Section templates

When adding a new entry, offer templates: "Internship", "Full-time role", "Volunteer position", "University degree", "Online course" — each pre-fills the right fields.

> **Review**: Templates are low-effort and useful, but there are a couple of constraints in the current architecture:
>
> - `CV_STYLES` is a hardcoded string constant in `cv-styles.js`, and the renderer has no concept of style variants. "Pick a template" with different visual styles means either (a) multiple `CV_STYLES` constants and a way to select between them, or (b) CSS custom properties in the styles that a theme system can override. Option (b) is cleaner and easier to extend, but the current styles use hardcoded `pt` values and `Times New Roman` everywhere — refactoring to custom properties is non-trivial.
> - Starter YAML templates are trivial — just multiple `.yaml` files and a picker UI. This is the easiest win in this whole section. Ship it before touching styles.
> - The onboarding wizard (5 steps) is a full feature. Don't build this until the form mode is solid, because the wizard _is_ the form mode with guided sequencing.
> - Section-level templates ("Internship", "Full-time role") pair naturally with the form mode's "add entry" button. Plan them together.

---

## 6. Contextual Guidance & Guardrails

Small UX additions that help even without a full form mode:

- **Friendly error messages**: Instead of `YAMLException: bad indentation at line 12`, show "Line 12 has a spacing issue — make sure it aligns with the lines above."
- **Field-level tooltips**: Cursor on a YAML key shows "dates: The time period, e.g., 'Jan-May 2024'".
- **Autocomplete/snippets**: Type `- dates:` and offer to scaffold a full entry.
- **Validation warnings**: "Your experience section has no bullet points" or "This bullet is 180 characters and may wrap awkwardly."
- **Visual schema reference**: Collapsible sidebar with expected structure and examples.

> **Review**: These are small, high-ROI improvements that can be shipped incrementally alongside or before the form mode:
>
> - **Friendly error messages**: Currently `CvEditor.jsx` just dumps `e.message` from `js-yaml`. The `js-yaml` library throws `YAMLException` with `.mark` (line/column info). You can parse this and show a human-readable message like "Indentation error on line 12" with a button to jump to that line in CodeMirror. Cheap win.
> - **Autocomplete/snippets**: CodeMirror 6 has a completion API (`@codemirror/autocomplete`). You could register a completion source that, when the cursor is inside an `education` or `experience` array, offers to scaffold a full entry. Medium effort but very useful for the code-mode audience.
> - **Validation warnings**: This is essentially a linter on the parsed YAML object (not the YAML syntax). Check for missing `bullets` on experience entries, overly long strings, sections with zero entries, etc. Display as non-blocking warnings below the error banner. This is independent of the form mode and valuable on its own.
> - **Field-level tooltips**: Would need a CodeMirror tooltip extension that maps YAML keys to descriptions. Not hard but requires maintaining a tooltip map. Could auto-generate it from the schema.
> - **Visual schema reference**: The simplest version is a collapsible `<pre>` showing `cv-data.yaml` with annotations. Almost zero code.

---

## Recommended Build Order

Priority by impact vs. effort:

| Priority | Idea                                         | Effort | Impact    |
| -------- | -------------------------------------------- | ------ | --------- |
| 1        | **Form mode + dual-mode toggle** (ideas 1+2) | Medium | Very High |
| 2        | **AI bullet rewriter** (idea 4, partial)     | Low    | High      |
| 3        | **Starter templates** (idea 5, partial)      | Low    | Medium    |
| 4        | **Better error messages** (idea 6, partial)  | Low    | Medium    |
| 5        | **Inline preview editing** (idea 3)          | High   | High      |
| 6        | **Full onboarding wizard** (idea 5)          | Medium | Medium    |

### Key architectural insight

YAML is already structured data — the gap is just the UI layer. The form mode doesn't require changing the renderer, preview iframe, pagination, or export. It's purely an alternative input mechanism that produces the same YAML string.

> **Review — overall**:
>
> The architectural insight is correct — YAML as the single source of truth means these UI ideas are additive, not disruptive. The priority table is also solid. A few adjustments I'd suggest:
>
> - **Move "Better error messages" (idea 6) to priority 1.** It's the cheapest win and immediately helps all users, including those who will never leave code mode. A one-hour change to parse `YAMLException.mark` and show a friendly message with a "go to line" button.
> - **The unstated prerequisite for ideas 1+2 is a component refactor.** `CvEditor.jsx` is a 155-line monolith that owns CodeMirror setup, YAML parsing, iframe communication, and layout. Before adding a form mode, extract `<YamlEditor>`, `<PreviewPane>`, and `<Toolbar>` components. This refactor is maybe 2 hours and makes everything else cleaner.
> - **Missing idea: "Reset to default" / "Load example."** A button that loads `cv-data.yaml` back into the editor. Trivial to implement (already imported as `defaultYaml`), useful for users who break things.
> - **Missing idea: Undo/redo.** CodeMirror has it built in, but the form mode will need its own undo stack. Consider this early — it's much harder to bolt on later.
> - **The section list in `renderCV` is hardcoded** (`education`, `experience`, `other_experience`, `skills`, `distinctions`). If you ever want users to add/remove/reorder sections, the renderer needs to become data-driven. Not urgent, but worth noting as a future constraint.
