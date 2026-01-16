package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"text/template"
	"time"
)

type HTMLRenderer struct {
	EmbedImages bool
}

func NewHTMLRenderer() *HTMLRenderer {
	return &HTMLRenderer{EmbedImages: false}
}

func (r *HTMLRenderer) Render(thread *Thread, customTitle string) string {
	title := customTitle
	if title == "" {
		if len(thread.Tweets) > 0 {
			firstTweetText := thread.Tweets[0].Text
			if len(firstTweetText) > 80 {
				title = firstTweetText[:80] + "..."
			} else {
				title = firstTweetText
			}
		}
		if title == "" {
			title = fmt.Sprintf("Thread by @%s", thread.Author.Username)
		}
	}

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>`)
	sb.WriteString(escapeHTML(title))
	sb.WriteString(`</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            color: #1a1a1a;
            background-color: #ffffff;
            padding: 2rem 1rem;
            max-width: 680px;
            margin: 0 auto;
            transition: background-color 0.3s, color 0.3s;
        }
        
        @media (prefers-color-scheme: dark) {
            body {
                background-color: #0d1117;
                color: #c9d1d9;
            }
            
            .tweet {
                background-color: #161b22;
                border-color: #30363d;
            }
            
            .tweet-meta {
                color: #8b949e;
            }
            
            a {
                color: #58a6ff;
            }
            
            .quoted-tweet {
                background-color: #0d1117;
                border-color: #30363d;
            }
        }
        
        h1 {
            font-size: 2rem;
            margin-bottom: 1.5rem;
            line-height: 1.2;
            font-weight: 700;
        }
        
        .author-header {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 2rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid #e1e4e8;
        }
        
        .author-avatar {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            object-fit: cover;
        }
        
        .author-info h2 {
            font-size: 1.25rem;
            margin-bottom: 0.25rem;
        }
        
        .author-meta {
            color: #6a737d;
            font-size: 0.9rem;
        }
        
        .tweet {
            margin-bottom: 2rem;
            padding: 1.5rem;
            background-color: #f6f8fa;
            border-radius: 12px;
            border: 1px solid #e1e4e8;
        }
        
        .tweet-text {
            font-size: 1.125rem;
            margin-bottom: 1rem;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        
        .tweet-meta {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.875rem;
            color: #6a737d;
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 1px solid #e1e4e8;
        }
        
        .tweet-meta a {
            text-decoration: none;
            color: inherit;
        }
        
        .tweet-meta a:hover {
            text-decoration: underline;
        }
        
        .tweet-number {
            font-weight: 600;
            color: #0366d6;
        }
        
        .media-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 0.5rem;
            margin: 1rem 0;
        }
        
        .media-item {
            border-radius: 8px;
            overflow: hidden;
        }
        
        .media-item img {
            width: 100%;
            height: auto;
            display: block;
        }
        
        .quoted-tweet {
            margin-top: 1rem;
            padding: 1rem;
            background-color: #ffffff;
            border-left: 4px solid #0366d6;
            border-radius: 8px;
            border: 1px solid #e1e4e8;
        }
        
        .quoted-tweet-header {
            font-weight: 600;
            margin-bottom: 0.5rem;
            font-size: 0.9rem;
        }
        
        .quoted-tweet-text {
            font-size: 0.95rem;
            color: #586069;
        }
        
        footer {
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid #e1e4e8;
            text-align: center;
            font-size: 0.875rem;
            color: #6a737d;
        }
        
        @media (max-width: 600px) {
            body {
                padding: 1rem;
            }
            
            h1 {
                font-size: 1.5rem;
            }
            
            .tweet {
                padding: 1rem;
            }
        }
    </style>
</head>
<body>
    <h1>`)
	sb.WriteString(escapeHTML(title))
	sb.WriteString(`</h1>
    
    <div class="author-header">
        `)
	if thread.Author.AvatarURL != "" {
		avatarURL := thread.Author.AvatarURL
		if r.EmbedImages {
			if dataURL := r.embedImage(avatarURL); dataURL != "" {
				avatarURL = dataURL
			}
		}
		sb.WriteString(fmt.Sprintf(`<img src="%s" alt="%s" class="author-avatar">`, escapeHTML(avatarURL), escapeHTML(thread.Author.Name)))
	}
	sb.WriteString(`
        <div class="author-info">
            <h2>`)
	sb.WriteString(escapeHTML(thread.Author.Name))
	if thread.Author.Verified {
		sb.WriteString(` ✓`)
	}
	sb.WriteString(`</h2>
            <div class="author-meta">@`)
	sb.WriteString(escapeHTML(thread.Author.Username))
	sb.WriteString(`</div>
        </div>
    </div>
    
    <div class="thread-content">
`)

	for i, tweet := range thread.Tweets {
		sb.WriteString(`        <div class="tweet">
            <div class="tweet-number">Tweet `)
		sb.WriteString(fmt.Sprintf("%d/%d", i+1, len(thread.Tweets)))
		sb.WriteString(`</div>
            <div class="tweet-text">`)
		sb.WriteString(formatTweetText(tweet.Text))
		sb.WriteString(`</div>
`)

		// Media
		if len(tweet.Media) > 0 {
			sb.WriteString(`            <div class="media-grid">
`)
			for _, media := range tweet.Media {
				mediaURL := media.URL
				if r.EmbedImages && media.Type == "photo" {
					if dataURL := r.embedImage(mediaURL); dataURL != "" {
						mediaURL = dataURL
					}
				}
				sb.WriteString(fmt.Sprintf(`                <div class="media-item">
                    <img src="%s" alt="%s" loading="lazy">
                </div>
`, escapeHTML(mediaURL), escapeHTML(media.AltText)))
			}
			sb.WriteString(`            </div>
`)
		}

		// Quoted tweet
		if tweet.QuotedTweet != nil {
			sb.WriteString(`            <div class="quoted-tweet">
                <div class="quoted-tweet-header">`)
			sb.WriteString(escapeHTML(tweet.QuotedTweet.Author.Name))
			sb.WriteString(` (@`)
			sb.WriteString(escapeHTML(tweet.QuotedTweet.Author.Username))
			sb.WriteString(`)</div>
                <div class="quoted-tweet-text">`)
			sb.WriteString(formatTweetText(tweet.QuotedTweet.Text))
			sb.WriteString(`</div>
            </div>
`)
		}

		sb.WriteString(`            <div class="tweet-meta">
                <a href="`)
		sb.WriteString(escapeHTML(tweet.URL))
		sb.WriteString(`" target="_blank">`)
		sb.WriteString(formatDate(tweet.CreatedAt))
		sb.WriteString(`</a>
            </div>
        </div>
`)
	}

	sb.WriteString(`    </div>
    
    <footer>
        <p>Converted by <a href="https://github.com/yourusername/tweet2blog">tweet2blog</a></p>
    </footer>
</body>
</html>`)

	return sb.String()
}

func (r *HTMLRenderer) embedImage(url string) string {
	resp, err := http.Get(url)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ""
	}

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		return ""
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return ""
	}

	encoded := base64.StdEncoding.EncodeToString(data)
	return fmt.Sprintf("data:%s;base64,%s", contentType, encoded)
}

func escapeHTML(s string) string {
	return template.HTMLEscapeString(s)
}

func formatTweetText(text string) string {
	// Convert URLs to links
	text = linkify(text)
	// Convert mentions to links
	text = mentionify(text)
	// Convert hashtags to links
	text = hashtagify(text)
	return text
}

func linkify(text string) string {
	// Simple URL regex
	urlRegex := regexp.MustCompile(`(https?://[^\s]+)`)
	return urlRegex.ReplaceAllStringFunc(text, func(url string) string {
		return fmt.Sprintf(`<a href="%s" target="_blank" rel="noopener">%s</a>`, escapeHTML(url), escapeHTML(url))
	})
}

func mentionify(text string) string {
	mentionRegex := regexp.MustCompile(`@(\w+)`)
	return mentionRegex.ReplaceAllStringFunc(text, func(mention string) string {
		username := mention[1:]
		return fmt.Sprintf(`<a href="https://x.com/%s" target="_blank" rel="noopener">%s</a>`, username, mention)
	})
}

func hashtagify(text string) string {
	hashtagRegex := regexp.MustCompile(`#(\w+)`)
	return hashtagRegex.ReplaceAllStringFunc(text, func(hashtag string) string {
		tag := hashtag[1:]
		return fmt.Sprintf(`<a href="https://x.com/hashtag/%s" target="_blank" rel="noopener">%s</a>`, tag, hashtag)
	})
}

func formatDate(t time.Time) string {
	return t.Format("January 2, 2006 at 3:04 PM")
}
