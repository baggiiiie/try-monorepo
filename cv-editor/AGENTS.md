# CV Editor

## Commands
- `npm run dev` — Start Vite dev server (frontend on :5173, proxies /api to :3001)
- `npm run build` — Production build
- `cd server && go build -o server .` — Build Go backend
- No test framework configured.

## Architecture
- **Frontend**: React 19 + Vite + Tailwind CSS 4. Single-page app in `src/`.
  - `src/pages/` — Page components (CvEditor). `src/components/` — Reusable components.
  - `src/lib/` — Pure logic: YAML↔CV rendering, PDF extraction, CSS styles.
- **Backend**: Go HTTP server (`server/main.go`, port 3001). Single endpoint `POST /api/convert-resume` calls `opencode` CLI to convert PDF text to YAML via LLM.
- **Data**: `cv-data.yaml` is the CV content schema/source. `cv-template.html` is the HTML template.

## Code Style
- ES modules (`"type": "module"`). JSX in `.jsx` files, plain JS in `.js` files.
- Imports: CSS first, then local modules (relative paths). No TypeScript.
- Components: function declarations with default export. No semicolons inconsistently—match surrounding code.
- Tailwind v4 for styling (via Vite plugin, not class-based config).
- Go backend: standard library style, `log.Fatal` for startup errors, inline struct types for small request/response shapes.
