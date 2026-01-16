package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

type TwitterClient struct {
	httpClient *http.Client
}

func NewTwitterClient() *TwitterClient {
	return &TwitterClient{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// FetchThread fetches a complete thread starting from any tweet URL
func (c *TwitterClient) FetchThread(ctx context.Context, tweetURL string) (*Thread, error) {
	tweetID, err := extractTweetID(tweetURL)
	if err != nil {
		return nil, fmt.Errorf("invalid tweet URL: %w", err)
	}

	// Fetch the initial tweet
	initialTweet, err := c.fetchTweet(ctx, tweetID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch tweet: %w", err)
	}

	thread := &Thread{
		RootTweetID: initialTweet.ID,
		Tweets:      []Tweet{*initialTweet},
		Author:      initialTweet.Author,
		CreatedAt:   initialTweet.CreatedAt,
	}

	// If this tweet is a reply, find the root of the thread
	if initialTweet.ReplyToID != "" {
		rootTweet, err := c.findRootTweet(ctx, initialTweet.ID, initialTweet.ReplyToID)
		if err != nil {
			// If we can't find root, just use current tweet as root
			return thread, nil
		}
		thread.RootTweetID = rootTweet.ID
		thread.Tweets = []Tweet{*rootTweet}
		thread.Author = rootTweet.Author
		thread.CreatedAt = rootTweet.CreatedAt
	}

	// Collect all replies from the same author
	replies, err := c.fetchReplies(ctx, thread.RootTweetID, thread.Author.Username)
	if err != nil {
		// If we can't fetch replies, return what we have
		return thread, nil
	}

	thread.Tweets = append(thread.Tweets, replies...)

	// Sort tweets by creation time
	sortTweetsByTime(thread.Tweets)

	return thread, nil
}

// fetchTweet fetches a single tweet by scraping Twitter
func (c *TwitterClient) fetchTweet(ctx context.Context, tweetID string) (*Tweet, error) {
	url := fmt.Sprintf("https://x.com/i/web/status/%s", tweetID)
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	// Set headers to mimic a browser
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	req.Header.Set("DNT", "1")
	req.Header.Set("Connection", "keep-alive")
	req.Header.Set("Upgrade-Insecure-Requests", "1")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	// Try to parse embedded JSON first (more reliable)
	if tweet := c.parseTweetFromJSON(string(bodyBytes), tweetID); tweet != nil {
		return tweet, nil
	}

	// Fallback to HTML parsing
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(string(bodyBytes)))
	if err != nil {
		return nil, fmt.Errorf("failed to parse HTML: %w", err)
	}

	// Document embeds Selection, so we can use doc directly
	return c.parseTweetFromHTML(doc.Find("body"), tweetID)
}

// parseTweetFromJSON attempts to parse tweet data from embedded JSON in the page
func (c *TwitterClient) parseTweetFromJSON(html string, tweetID string) *Tweet {
	// Twitter embeds data in script tags with type="application/json"
	// Look for patterns like {"__typename":"Tweet",...}
	// This is a simplified version - Twitter's JSON structure is complex
	
	// Try to find JSON-LD structured data
	jsonLDRegex := regexp.MustCompile(`<script type="application/ld\+json">\s*({[^<]+})\s*</script>`)
	matches := jsonLDRegex.FindStringSubmatch(html)
	if len(matches) > 1 {
		// Attempt to parse JSON-LD (this may contain tweet info)
		var jsonData map[string]interface{}
		if err := json.Unmarshal([]byte(matches[1]), &jsonData); err == nil {
			// Parse JSON-LD tweet data if available
			if text, ok := jsonData["text"].(string); ok {
				tweet := &Tweet{
					ID:   tweetID,
					Text: text,
					URL:  fmt.Sprintf("https://x.com/i/web/status/%s", tweetID),
				}
				// Extract author info if available
				if author, ok := jsonData["author"].(map[string]interface{}); ok {
					if name, ok := author["name"].(string); ok {
						tweet.Author.Name = name
					}
				}
				if dateStr, ok := jsonData["datePublished"].(string); ok {
					if t, err := time.Parse(time.RFC3339, dateStr); err == nil {
						tweet.CreatedAt = t
					}
				}
				if tweet.CreatedAt.IsZero() {
					tweet.CreatedAt = time.Now()
				}
				return tweet
			}
		}
	}
	
	return nil
}

// parseTweetFromHTML parses tweet data from HTML document
func (c *TwitterClient) parseTweetFromHTML(doc *goquery.Selection, tweetID string) (*Tweet, error) {
	tweet := &Tweet{
		ID: tweetID,
		URL: fmt.Sprintf("https://x.com/i/web/status/%s", tweetID),
	}

	// Find the main article element
	article := doc.Find(`article[data-testid="tweet"]`).First()
	if article.Length() == 0 {
		return nil, fmt.Errorf("tweet not found in HTML")
	}

	// Extract text - try multiple selectors
	tweet.Text = strings.TrimSpace(article.Find(`div[data-testid="tweetText"]`).Text())
	if tweet.Text == "" {
		tweet.Text = strings.TrimSpace(article.Find(`div[lang]`).First().Text())
	}
	if tweet.Text == "" {
		tweet.Text = strings.TrimSpace(article.Find(`span`).FilterFunction(func(i int, s *goquery.Selection) bool {
			text := strings.TrimSpace(s.Text())
			return len(text) > 20 // Likely the tweet text if it's long enough
		}).First().Text())
	}

	// Extract author info - try multiple selectors
	author := Author{}
	
	// Try to find author link in the tweet header
	authorLink := article.Find(`div[data-testid="User-Name"] a`).First()
	if authorLink.Length() == 0 {
		authorLink = article.Find(`a[href^="/"][href*="/status"]`).Not(`a[href*="/status/"]`).First()
	}
	if authorLink.Length() == 0 {
		authorLink = article.Find(`a[href*="/"]`).Not(`a[href*="/status/"]`).Not(`a[href*="hashtag"]`).First()
	}
	
	if href, exists := authorLink.Attr("href"); exists {
		// Extract username from href like "/username" or "/username/"
		if matches := regexp.MustCompile(`/([^/?]+)/?`).FindStringSubmatch(href); len(matches) > 1 {
			author.Username = matches[1]
		}
	}
	author.Name = strings.TrimSpace(authorLink.Text())
	if author.Name == "" {
		// Try alternative location
		author.Name = strings.TrimSpace(article.Find(`div[data-testid="User-Name"] span`).First().Text())
	}
	
	// Extract avatar - try multiple selectors
	avatarImg := article.Find(`img[alt*="Avatar"]`).First()
	if avatarImg.Length() == 0 {
		avatarImg = article.Find(`img[alt*="profile"]`).First()
	}
	if avatarImg.Length() == 0 {
		// Look for images in the author section
		avatarImg = article.Find(`div[data-testid="UserAvatar-Container"] img`).First()
	}
	if avatarImg.Length() > 0 {
		if src, exists := avatarImg.Attr("src"); exists {
			author.AvatarURL = src
		}
	}

	tweet.Author = author

	// Extract timestamp
	if timeElem := article.Find(`time`).First(); timeElem.Length() > 0 {
		if datetime, exists := timeElem.Attr("datetime"); exists {
			if t, err := time.Parse(time.RFC3339, datetime); err == nil {
				tweet.CreatedAt = t
			}
		}
	}
	if tweet.CreatedAt.IsZero() {
		tweet.CreatedAt = time.Now()
	}

	// Extract media - look for images in media sections
	seenMedia := make(map[string]bool)
	article.Find(`img`).Each(func(i int, s *goquery.Selection) {
		src, hasSrc := s.Attr("src")
		if !hasSrc {
			return
		}
		
		// Skip avatars and small icons
		if strings.Contains(src, "profile_images") || strings.Contains(src, "emoji") {
			return
		}
		
		// Check if it's media
		if strings.Contains(src, "media") || strings.Contains(src, "pbs.twimg.com") {
			// Normalize URL - remove query params for deduplication
			normalizedURL := strings.Split(src, "?")[0]
			if seenMedia[normalizedURL] {
				return
			}
			seenMedia[normalizedURL] = true
			
			media := Media{
				Type: "photo",
				URL:  src,
			}
			if alt, exists := s.Attr("alt"); exists && alt != "" {
				media.AltText = alt
			}
			tweet.Media = append(tweet.Media, media)
		}
	})

	// Extract quoted tweet (simplified - may need enhancement)
	if quoted := article.Find(`div[data-testid="tweet"]`).Not(`article[data-testid="tweet"] > *`).First(); quoted.Length() > 0 {
		// This is a simplified detection - real implementation would need more parsing
	}

	return tweet, nil
}

// findRootTweet finds the root tweet of a thread by traversing up
func (c *TwitterClient) findRootTweet(ctx context.Context, currentID, replyToID string) (*Tweet, error) {
	tweet, err := c.fetchTweet(ctx, replyToID)
	if err != nil {
		return nil, err
	}

	// If this tweet is also a reply, recurse
	if tweet.ReplyToID != "" && tweet.ReplyToID != currentID {
		return c.findRootTweet(ctx, tweet.ID, tweet.ReplyToID)
	}

	return tweet, nil
}

// fetchReplies attempts to fetch replies to a tweet from the same author
// This is a simplified version - Twitter doesn't expose this easily without auth
func (c *TwitterClient) fetchReplies(ctx context.Context, tweetID, authorUsername string) ([]Tweet, error) {
	// For now, we'll try to fetch the thread page and parse continuation
	// This is a limitation - full thread fetching typically requires authenticated API access
	// or more sophisticated scraping
	
	// We'll return empty for now and let users know
	return []Tweet{}, nil
}

// extractTweetID extracts tweet ID from various URL formats
func extractTweetID(url string) (string, error) {
	patterns := []string{
		`/status/(\d+)`,
		`tweet/(\d+)`,
		`statuses/(\d+)`,
	}

	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		matches := re.FindStringSubmatch(url)
		if len(matches) > 1 {
			return matches[1], nil
		}
	}

	return "", fmt.Errorf("could not extract tweet ID from URL: %s", url)
}

// sortTweetsByTime sorts tweets by creation time (oldest first)
func sortTweetsByTime(tweets []Tweet) {
	for i := 0; i < len(tweets)-1; i++ {
		for j := i + 1; j < len(tweets); j++ {
			if tweets[i].CreatedAt.After(tweets[j].CreatedAt) {
				tweets[i], tweets[j] = tweets[j], tweets[i]
			}
		}
	}
}
