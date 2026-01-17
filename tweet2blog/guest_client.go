package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// GuestClient handles guest authentication with X API
type GuestClient struct {
	logger     *Logger
	client     *http.Client
	guestToken string
	bearerToken string
}

// NewGuestClient creates a new guest client
func NewGuestClient(logger *Logger, bearerToken string) *GuestClient {
	return &GuestClient{
		logger:      logger,
		bearerToken: bearerToken,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// FetchTweet fetches a single tweet with details
func (gc *GuestClient) FetchTweet(ctx context.Context, tweetID string) (*TwitterTweetData, error) {
	// Build API request for fetching tweet with expansion
	// This endpoint is publicly available even without auth
	apiURL := fmt.Sprintf(
		"https://api.x.com/2/tweets/%s?tweet.fields=created_at,public_metrics,author_id,conversation_id&user.fields=username,verified,public_metrics,profile_image_url,description&expansions=author_id,quoted_status_id",
		tweetID,
	)

	req, err := gc.buildRequest(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := gc.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var apiResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return nil, nil // Placeholder
}

// FetchConversation fetches all tweets in a conversation
func (gc *GuestClient) FetchConversation(ctx context.Context, conversationID string) ([]TwitterTweetData, error) {
	// Search for tweets in this conversation
	apiURL := fmt.Sprintf(
		"https://api.x.com/2/tweets/search/recent?query=conversation_id:%s&tweet.fields=created_at,public_metrics,author_id&user.fields=username,verified,public_metrics,profile_image_url&expansions=author_id&max_results=100&sort_order=asc",
		conversationID,
	)

	req, err := gc.buildRequest(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := gc.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		gc.logger.Warn("API request failed with status %d: %s", resp.StatusCode, string(body))
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var apiResp TwitterAPIResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return apiResp.Data, nil
}

// buildRequest builds an HTTP request with proper headers
func (gc *GuestClient) buildRequest(ctx context.Context, method, url string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}

	// Set headers
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	// Use bearer token if available
	if gc.bearerToken != "" {
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", gc.bearerToken))
	}

	return req, nil
}
