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
)

// TwitterFetcher handles fetching tweets from X/Twitter
type TwitterFetcher struct {
	logger *Logger
	client *http.Client
}

// NewTwitterFetcher creates a new Twitter fetcher
func NewTwitterFetcher(logger *Logger) *TwitterFetcher {
	return &TwitterFetcher{
		logger: logger,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// FetchThread fetches a complete thread starting from a given tweet URL
func (f *TwitterFetcher) FetchThread(ctx context.Context, tweetURL string) (*Thread, error) {
	// Extract tweet ID from URL
	tweetID, username, err := f.extractTweetID(tweetURL)
	if err != nil {
		return nil, fmt.Errorf("invalid URL format: %w", err)
	}

	f.logger.Info("Extracted tweet ID: %s, username: %s", tweetID, username)

	// Try to fetch using guest client approach (requires bearer token)
	thread, err := f.fetchThreadViaGuest(ctx, tweetID, username)
	if err != nil {
		// Fallback to scraping
		f.logger.Warn("API fetch failed (no bearer token?), attempting fallback: %v", err)
		thread, err = f.fetchThreadViaHTML(ctx, tweetURL)
		if err != nil {
			return nil, err
		}
	}

	// Ensure tweets are in chronological order
	f.sortTweets(thread)

	return thread, nil
}

// extractTweetID extracts the tweet ID and username from a URL
func (f *TwitterFetcher) extractTweetID(tweetURL string) (string, string, error) {
	// Parse URL like https://x.com/username/status/1234567890
	pattern := `(?:https?://)?(?:www\.)?(?:twitter\.com|x\.com)/([^/]+)/status/(\d+)`
	re := regexp.MustCompile(pattern)

	matches := re.FindStringSubmatch(tweetURL)
	if len(matches) < 3 {
		return "", "", fmt.Errorf("invalid tweet URL: %s", tweetURL)
	}

	username := matches[1]
	tweetID := matches[2]

	return tweetID, username, nil
}

// fetchThreadViaGuest attempts to fetch thread using guest authentication
func (f *TwitterFetcher) fetchThreadViaGuest(ctx context.Context, tweetID, username string) (*Thread, error) {
	// Construct API endpoint for fetching conversation thread
	// Using the guest token approach (this is a common pattern in 2026)
	
	apiURL := fmt.Sprintf("https://api.x.com/2/tweets/search/recent?query=conversation_id:%s&tweet.fields=created_at,public_metrics,author_id&user.fields=username,verified,public_metrics,profile_image_url&expansions=author_id,quoted_status_id&max_results=100", tweetID)

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}

	// Set headers to mimic browser request (guest client)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
	req.Header.Set("Accept", "application/json")

	f.logger.Info("Fetching thread metadata from API: %s", apiURL)

	// Attempt the request (will likely need guest token in real world)
	resp, err := f.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch from API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Return error indicating fallback needed
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var apiResp TwitterAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, fmt.Errorf("failed to decode API response: %w", err)
	}

	thread := f.buildThreadFromAPI(&apiResp, tweetID, username)
	return thread, nil
}

// fetchThreadViaHTML fetches thread by scraping the webpage
func (f *TwitterFetcher) fetchThreadViaHTML(ctx context.Context, tweetURL string) (*Thread, error) {
	f.logger.Info("Scraping thread from URL: %s", tweetURL)

	// Try public API endpoint as alternative (doesn't need auth but returns minimal data)
	thread, err := f.tryPublicAPIEndpoint(ctx, tweetURL)
	if err == nil && len(thread.Tweets) > 0 {
		return thread, nil
	}

	req, fetchErr := http.NewRequestWithContext(ctx, "GET", tweetURL, nil)
	err = fetchErr
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	resp, err := f.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch URL: %w", err)
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, fmt.Errorf("failed to read response: %w", readErr)
	}

	parsedThread := f.parseThreadFromHTML(string(body), tweetURL)
	return parsedThread, nil
}

// tryPublicAPIEndpoint tries to fetch from public oEmbed endpoint
func (f *TwitterFetcher) tryPublicAPIEndpoint(ctx context.Context, tweetURL string) (*Thread, error) {
	// X/Twitter oEmbed endpoint (public, no auth required)
	oembedURL := fmt.Sprintf("https://publish.twitter.com/oembed?url=%s&hide_thread=false", tweetURL)

	oembedReq, err := http.NewRequestWithContext(ctx, "GET", oembedURL, nil)
	if err != nil {
		return nil, err
	}

	oembedResp, err := f.client.Do(oembedReq)
	if err != nil {
		return nil, err
	}
	defer oembedResp.Body.Close()

	if oembedResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oEmbed API returned status %d", oembedResp.StatusCode)
	}

	var oembedData map[string]interface{}
	if err := json.NewDecoder(oembedResp.Body).Decode(&oembedData); err != nil {
		return nil, err
	}

	// Parse the returned HTML
	if html, ok := oembedData["html"].(string); ok {
		_, username, _ := f.extractTweetID(tweetURL)
		thread := &Thread{
			Tweets: make([]*Tweet, 0),
			URL:    tweetURL,
			Author: User{
				Username: username,
			},
		}

		// Extract text from blockquote
		textPattern := regexp.MustCompile(`<p lang="[^"]*" dir="[^"]*">([^<]+)</p>`)
		if matches := textPattern.FindStringSubmatch(html); len(matches) > 1 {
			tweet := &Tweet{
				Text: matches[1],
				Author: User{
					Username: username,
				},
				CreatedAt: time.Now(),
			}
			thread.Tweets = append(thread.Tweets, tweet)
		}

		return thread, nil
	}

	return nil, fmt.Errorf("no html in oEmbed response")
}

// parseThreadFromHTML extracts thread data from HTML
func (f *TwitterFetcher) parseThreadFromHTML(html, tweetURL string) *Thread {
	// Extract basic information from meta tags
	thread := &Thread{
		Tweets: make([]*Tweet, 0),
		URL:    tweetURL,
	}

	// Parse username from URL
	_, username, _ := f.extractTweetID(tweetURL)

	// Try multiple methods to extract tweet data
	
	// Method 1: Extract from JSON-LD or next.js data
	jsonPattern := regexp.MustCompile(`<script id="__NEXT_DATA__" type="application/json">([^<]+)</script>`)
	matches := jsonPattern.FindStringSubmatch(html)

	if len(matches) > 1 {
		var nextData map[string]interface{}
		if err := json.Unmarshal([]byte(matches[1]), &nextData); err == nil {
			f.logger.Debugf("Successfully parsed Next.js data from HTML")
			thread = f.extractThreadFromNextJS(nextData, username, thread)
		}
	}

	// Method 2: Extract from initial state script
	if len(thread.Tweets) == 0 {
		initialStatePattern := regexp.MustCompile(`window\.__initialState__\s*=\s*({.+?});`)
		if matches := initialStatePattern.FindStringSubmatch(html); len(matches) > 1 {
			var initialState map[string]interface{}
			if err := json.Unmarshal([]byte(matches[1]), &initialState); err == nil {
				f.logger.Debugf("Successfully parsed initial state from HTML")
				// Could extract from initial state here
			}
		}
	}

	// Method 3: Extract from meta tags and fallback with minimal tweet
	if len(thread.Tweets) == 0 {
		thread = f.extractThreadFromMeta(html, username, thread)
	}

	return thread
}

// extractThreadFromNextJS extracts thread data from Next.js embedded JSON
func (f *TwitterFetcher) extractThreadFromNextJS(data map[string]interface{}, username string, thread *Thread) *Thread {
	// This is a simplified extraction - in reality you'd traverse the complex structure
	// For now, return empty thread as placeholder
	thread.Author.Username = username
	return thread
}

// extractThreadFromMeta extracts basic info from meta tags and page content
func (f *TwitterFetcher) extractThreadFromMeta(html, username string, thread *Thread) *Thread {
	// Extract title from og:title
	titlePattern := regexp.MustCompile(`<meta property="og:title" content="([^"]+)"`)
	if matches := titlePattern.FindStringSubmatch(html); len(matches) > 1 {
		thread.Title = matches[1]
	}

	// Extract description from og:description
	descPattern := regexp.MustCompile(`<meta property="og:description" content="([^"]+)"`)
	var firstTweetText string
	if matches := descPattern.FindStringSubmatch(html); len(matches) > 1 {
		firstTweetText = matches[1]
	}

	// Try to extract tweet data from the page
	// Look for conversation threads in the markup
	conversationPattern := regexp.MustCompile(`<article[^>]*>(.*?)</article>`)
	articles := conversationPattern.FindAllStringSubmatch(html, -1)

	if len(articles) > 0 {
		// Process each article as a tweet
		for _, article := range articles {
			if len(article) > 1 {
				tweet := f.extractTweetFromArticle(article[1], username)
				if tweet.Text != "" || tweet.CreatedAt.Year() > 2000 {
					thread.Tweets = append(thread.Tweets, tweet)
				}
			}
		}
	}

	// If no tweets found from articles, create minimal tweet from meta description
	if len(thread.Tweets) == 0 && firstTweetText != "" {
		tweet := &Tweet{
			ID:   "",
			Text: firstTweetText,
			Author: User{
				Username: username,
			},
			CreatedAt: time.Now(),
		}
		thread.Tweets = append(thread.Tweets, tweet)
	} else if len(thread.Tweets) == 0 {
		// Fallback: empty tweet with username
		tweet := &Tweet{
			Author: User{
				Username: username,
			},
			CreatedAt: time.Now(),
		}
		thread.Tweets = append(thread.Tweets, tweet)
	}

	thread.Author.Username = username
	if len(thread.Tweets) > 0 {
		thread.CreatedAt = thread.Tweets[0].CreatedAt
	}

	return thread
}

// extractTweetFromArticle extracts tweet data from an article element
func (f *TwitterFetcher) extractTweetFromArticle(articleHTML, username string) *Tweet {
	tweet := &Tweet{
		Author: User{
			Username: username,
		},
		CreatedAt: time.Now(),
	}

	// Extract tweet text from span elements with data-testid="tweetText"
	textPattern := regexp.MustCompile(`<span[^>]*data-testid="tweetText"[^>]*>([^<]+)</span>`)
	if matches := textPattern.FindStringSubmatch(articleHTML); len(matches) > 1 {
		tweet.Text = matches[1]
	}

	// Extract time/date from time element
	timePattern := regexp.MustCompile(`<time[^>]+datetime="([^"]+)"`)
	if matches := timePattern.FindStringSubmatch(articleHTML); len(matches) > 1 {
		if t, err := time.Parse(time.RFC3339, matches[1]); err == nil {
			tweet.CreatedAt = t
		}
	}

	// Extract author name
	namePattern := regexp.MustCompile(`<a[^>]*>[^<]*<div[^>]*>([^<]+)</div>`)
	if matches := namePattern.FindStringSubmatch(articleHTML); len(matches) > 1 {
		tweet.Author.Name = matches[1]
	}

	// Extract images (simplified)
	imgPattern := regexp.MustCompile(`<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"`)
	for _, match := range imgPattern.FindAllStringSubmatch(articleHTML, -1) {
		if len(match) > 1 && strings.Contains(match[1], "pbs.twimg.com") {
			tweet.Attachments.Media = append(tweet.Attachments.Media, Media{
				Type:    "photo",
				URL:     match[1],
				AltText: match[2],
			})
		}
	}

	// Extract URLs
	linkPattern := regexp.MustCompile(`href="(https?://[^"]+)"`)
	for _, match := range linkPattern.FindAllStringSubmatch(articleHTML, -1) {
		if len(match) > 1 && !strings.Contains(match[1], "x.com") && !strings.Contains(match[1], "twitter.com") {
			tweet.Attachments.URLs = append(tweet.Attachments.URLs, match[1])
		}
	}

	return tweet
}

// buildThreadFromAPI builds a Thread from API response
func (f *TwitterFetcher) buildThreadFromAPI(apiResp *TwitterAPIResponse, tweetID, username string) *Thread {
	thread := &Thread{
		Tweets: make([]*Tweet, 0),
		Author: User{
			Username: username,
		},
	}

	// Process tweets from API response
	if apiResp.Data != nil {
		for _, tweetData := range apiResp.Data {
			tweet := &Tweet{
				ID:        tweetData.ID,
				Text:      tweetData.Text,
				CreatedAt: parseTime(tweetData.CreatedAt),
			}

			// Find author from includes
			if apiResp.Includes != nil {
				for _, user := range apiResp.Includes.Users {
					if user.ID == tweetData.AuthorID {
						tweet.Author = User{
							ID:       user.ID,
							Username: user.Username,
							Name:     user.Name,
							Avatar:   user.ProfileImageURL,
						}
						break
					}
				}
			}

			thread.Tweets = append(thread.Tweets, tweet)
		}
	}

	if len(thread.Tweets) > 0 {
		thread.Title = "Twitter Thread"
		thread.CreatedAt = thread.Tweets[0].CreatedAt
	}

	return thread
}

// sortTweets ensures tweets are in chronological order
func (f *TwitterFetcher) sortTweets(thread *Thread) {
	// Simple bubble sort for chronological order
	for i := 0; i < len(thread.Tweets); i++ {
		for j := i + 1; j < len(thread.Tweets); j++ {
			if thread.Tweets[j].CreatedAt.Before(thread.Tweets[i].CreatedAt) {
				thread.Tweets[i], thread.Tweets[j] = thread.Tweets[j], thread.Tweets[i]
			}
		}
	}
}

// parseTime parses a timestamp string
func parseTime(ts string) time.Time {
	if ts == "" {
		return time.Now()
	}
	
	// Try RFC3339 format
	if t, err := time.Parse(time.RFC3339, ts); err == nil {
		return t
	}

	// Default to now
	return time.Now()
}

// TwitterAPIResponse represents the response from Twitter API v2
type TwitterAPIResponse struct {
	Data     []TwitterTweetData  `json:"data"`
	Includes *TwitterIncludes    `json:"includes"`
	Meta     *TwitterMeta        `json:"meta"`
}

// TwitterTweetData represents a tweet from the API
type TwitterTweetData struct {
	ID          string `json:"id"`
	Text        string `json:"text"`
	AuthorID    string `json:"author_id"`
	CreatedAt   string `json:"created_at"`
	PublicMetrics struct {
		Likes    int `json:"like_count"`
		Replies  int `json:"reply_count"`
		Retweets int `json:"retweet_count"`
		Quotes   int `json:"quote_count"`
	} `json:"public_metrics"`
}

// TwitterIncludes represents included data (users, tweets, etc.)
type TwitterIncludes struct {
	Users []TwitterUser `json:"users"`
	Tweets []TwitterTweetData `json:"tweets"`
}

// TwitterUser represents a user from the API
type TwitterUser struct {
	ID              string `json:"id"`
	Username        string `json:"username"`
	Name            string `json:"name"`
	ProfileImageURL string `json:"profile_image_url"`
}

// TwitterMeta represents metadata from the API response
type TwitterMeta struct {
	ResultCount int `json:"result_count"`
	NewestID    string `json:"newest_id"`
	OldestID    string `json:"oldest_id"`
}
