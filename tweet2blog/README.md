# tweet2blog

A command-line tool to convert X/Twitter threads into clean, readable blog-style HTML or Markdown files.

## Features

- ✅ Converts any tweet in a thread (automatically discovers the full thread)
- ✅ Beautiful, responsive HTML output with dark mode support
- ✅ Markdown output for easy import to other platforms
- ✅ Extracts text, images, videos, links, and quoted tweets
- ✅ Preserves author information, timestamps, and metadata
- ✅ No API keys required (uses web scraping)
- ✅ Standalone HTML files with optional embedded images

## Installation

### From Source

```bash
git clone https://github.com/yourusername/tweet2blog.git
cd tweet2blog
go build -o tweet2blog
```

### Using Go Install

```bash
go install github.com/yourusername/tweet2blog@latest
```

## Usage

### Basic Usage

Convert a Twitter thread to HTML (outputs to stdout):

```bash
tweet2blog https://x.com/username/status/1234567890123456789
```

### Save to File

```bash
tweet2blog -o output.html https://x.com/username/status/1234567890123456789
```

### Output Markdown

```bash
tweet2blog -format markdown -o thread.md https://x.com/username/status/1234567890123456789
```

### Custom Title

```bash
tweet2blog -t "My Awesome Thread Title" -o output.html https://x.com/username/status/1234567890123456789
```

### Embed Images (Standalone HTML)

Download and embed images as data URLs for a truly standalone HTML file:

```bash
tweet2blog --embed-images -o standalone.html https://x.com/username/status/1234567890123456789
```

### Debug: View Raw JSON

```bash
tweet2blog --json https://x.com/username/status/1234567890123456789
```

## CLI Options

```
  -format string
        Output format: html or markdown (default "html")
  -json
        Output raw JSON instead of HTML
  -o string
        Output file (default: stdout or auto-generated name)
  -t string
        Custom title for the blog post
  -embed-images
        Download and embed images as data URLs (for standalone HTML)
```

## Examples

### Convert a Thread to HTML

```bash
tweet2blog -o my-thread.html https://x.com/patio11/status/2011884933258887572
```

### Convert Multiple Threads

```bash
for url in $(cat urls.txt); do
  slug=$(echo $url | grep -o '[0-9]*$')
  tweet2blog -o "thread-$slug.html" "$url"
done
```

## Output Formats

### HTML Output

The HTML output includes:
- Beautiful, responsive design
- Dark mode support (follows system preference)
- Clean typography optimized for reading
- Properly formatted media
- Clickable links, mentions, and hashtags
- Metadata for each tweet (date, link to original)

### Markdown Output

The Markdown output is optimized for:
- Importing into other platforms (Medium, Dev.to, etc.)
- Version control systems (Git)
- Further processing with other tools

## How It Works

1. **URL Parsing**: Extracts the tweet ID from various Twitter URL formats
2. **Tweet Fetching**: Fetches the tweet page using HTTP requests (no API required)
3. **Thread Discovery**: Attempts to find the root tweet and all replies in the thread
4. **Data Extraction**: Parses HTML/JSON to extract:
   - Tweet text
   - Author information (name, username, avatar)
   - Media (images, videos)
   - Quoted tweets
   - Timestamps
   - Links and mentions
5. **Rendering**: Formats the data into beautiful HTML or clean Markdown

## Limitations

- **Thread Discovery**: Full thread discovery relies on scraping, which has limitations. The tool will fetch the provided tweet and attempt to find related tweets in the thread.
- **Rate Limiting**: Twitter may rate limit requests. If you encounter issues, wait a few minutes and try again.
- **Protected Tweets**: Protected/private accounts cannot be accessed without authentication.
- **Deleted Tweets**: Deleted tweets cannot be fetched.

## Troubleshooting

### "Tweet not found in HTML"

This usually means:
- The tweet doesn't exist or was deleted
- Twitter changed their HTML structure (please open an issue)
- The URL format is incorrect

### "HTTP 429 Too Many Requests"

Twitter is rate limiting your requests. Wait a few minutes before trying again.

### Empty or Incomplete Threads

If only one tweet is returned:
- The tweet might not be part of a thread
- Twitter's structure may have changed
- Try using the `--json` flag to see what data is being extracted

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Credits

Built with Go and inspired by the need for better long-form content reading experiences.
