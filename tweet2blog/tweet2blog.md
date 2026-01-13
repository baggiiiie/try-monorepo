You are an expert Go backend/full-stack developer with deep experience in Twitter/X API, web scraping (when API is not sufficient), static site generation, and clean CLI tools.

### Project Goal

Create a tool that converts any X/Twitter thread into a clean, readable blog-style webpage (or set of static HTML files).

### Core workflow

1. User provides the URL of **any tweet in the thread** (most commonly the last tweet)
2. The tool discovers the complete thread (all tweets in correct order, including replies in the self-thread)
3. Extracts: text, images, videos (at least thumbnails or links), links, quoted tweets, polls (if possible), dates, author info
4. Renders it as a beautiful, readable, blog-like page (markdown structure, good typography, responsive)
5. First milestone: excellent CLI tool
6. Second milestone: static website generator (multiple threads → nice static blog)

### Requirements - CLI Tool (first priority - must be excellent)

- Language: Go (latest stable version)
- Output binary name suggestion: tweet2blog

### CLI interface examples

#### Basic usage

tweet2blog <https://x.com/username/status/1234567890123456789>

#### With options

```
tweet2blog -o output.html https://x.com/elonmusk/status/999999999999999999
tweet2blog --json https://x.com/... # debug/raw json
tweet2blog -t "My Awesome Thread" https://x.com/... # custom title
tweet2blog --embed-images https://x.com/... # download & embed images as data URLs (for standalone html)
```

### Must-have features in CLI

- Automatically detect the whole thread even if URL is in the middle or the last tweet
- Correct chronological order (oldest → newest)
- Handle very long threads (50+ tweets)
- Extract author name, username, avatar, post date/time for each tweet
- Handle media: images (multiple per tweet), video thumbnails or first frame + link
- Handle quoted tweets (at minimum show as blockquote with author)
- Reasonable error handling & user-friendly messages
- Use proper rate limiting / backoff when using API

### Implementation approaches (choose the most reliable combination in 2025/2026 reality)

Preferred order of methods (try in this sequence):

1. Official Twitter/X API v2 (if possible with free/basic access or user provides bearer token)
2. Guest authentication + reverse-engineered API endpoints (many libraries do this)
3. HTML scraping / headless browser approach as last resort (but prefer API)

### Recommended Go libraries (pick best combination)

- github.com/g8rswimmer/go-twitter/v2 (official API v2)
- github.com/dghubble/go-twitter (older but still used)
- github.com/mvdan/xgo (or similar modern guest auth clients)
- github.com/chromedp/chromedp (only if everything else fails)
- github.com/PuerkitoBio/goquery for HTML parsing if needed

### Deliverables for CLI phase

1. Clean, well-structured Go project with modules
2. Good README.md with installation, usage examples, auth setup instructions
3. Good separation of concerns (fetcher, thread builder, renderer)
4. Support at least two output formats:
   - Standalone HTML (single file, nice blog style, responsive, dark mode support)
   - Markdown (for easy import to other platforms)
5. Use modern Go practices (go:embed, context, structured logging, etc.)

### Bonus goals for CLI (nice to have)

- Option to download images locally + relative paths
- Basic template customization (--template custom.html)
- Progress bar for long threads
- Color output in terminal when showing summary

## Phase 2 - Static Site Generator (after CLI works well)

Extend the tool to work as a static blog generator:

```sh
tweet2blog generate \
 --config threads.yaml \
 --output-dir ./blog \
 --theme simple-dark
```

Where threads.yaml example:

```yaml
site:
  title: "Interesting X Threads Collection"
  description: "Curated long-form Twitter threads turned into blogs"
  base_url: "https://mythreads.example.com"

threads:
  - url: https://x.com/levelsio/status/184xxx
    slug: how-i-built-nomad-list
    title: "How I Built Nomad List (20-part thread)"
    tags: [startups, indie, business]

  - url: https://x.com/shl/status/175xxx
    slug: startup-equity-for-engineers
    title: "A Founder’s Guide to Startup Equity for Engineers"
```

### Generated output

- index.html → beautiful list of all threads (card/grid view recommended)
- /thread/slug/index.html → each thread as full blog post
- assets/ → css, js, images (if not embedded)
- Use good static site practices: clean URLs, semantic HTML, fast loading

### Styling requirements

- Clean, modern, very readable typography (system fonts or nice web font)
- Mobile responsive
- Dark/light mode (auto or toggle)
- Images lazy loaded
- Nice blockquote styling for quoted tweets
- Tweet metadata line (author, date, tweet link)

Please provide the complete project structure, main.go, important files content, and clear next steps after the CLI is working.
Start with the CLI tool first — make it really good quality before moving to the static generator part.
Current date context: January 2026 — please take into account the current state of X/Twitter API access, guest tokens, rate limits, and common working methods in early 2026.
