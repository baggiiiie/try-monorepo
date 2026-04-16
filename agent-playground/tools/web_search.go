package tools

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type WebSearchTool struct{}

func (t *WebSearchTool) Name() string { return "web_search" }

func (t *WebSearchTool) Description() string {
	return "Search the web using the Exa API. Returns titles, URLs, and relevant highlights for each result."
}

func (t *WebSearchTool) Schema() map[string]any {
	return BuildSchema([]Param{
		{Name: "query", Type: "string", Description: "The search query", Required: true},
		{Name: "num_results", Type: "number", Description: "Number of results to return (default: 5, max: 10)"},
	})
}

func (t *WebSearchTool) Execute(args map[string]any) string {
	query, _ := args["query"].(string)
	if query == "" {
		return "Error: query is required"
	}

	apiKey := os.Getenv("EXA_API_KEY")
	if apiKey == "" {
		return "Error: EXA_API_KEY environment variable is not set"
	}

	numResults := 5
	if n, ok := args["num_results"].(float64); ok && n > 0 {
		numResults = min(int(n), 10)
	}

	reqBody := map[string]any{
		"query":      query,
		"type":       "auto",
		"numResults": numResults,
		"contents": map[string]any{
			"highlights": map[string]any{
				"maxCharacters": 4000,
			},
		},
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Sprintf("Error: failed to marshal request: %v", err)
	}

	req, err := http.NewRequest("POST", "https://api.exa.ai/search", bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Sprintf("Error: failed to create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Sprintf("Error: request failed: %v", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Sprintf("Error: failed to read response: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Sprintf("Error: Exa API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Results []struct {
			Title      string   `json:"title"`
			URL        string   `json:"url"`
			Highlights []string `json:"highlights"`
		} `json:"results"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return fmt.Sprintf("Error: failed to parse response: %v", err)
	}

	if len(result.Results) == 0 {
		return "No results found."
	}

	var sb strings.Builder
	for i, r := range result.Results {
		fmt.Fprintf(&sb, "[%d] %s\n    %s\n", i+1, r.Title, r.URL)
		for _, h := range r.Highlights {
			fmt.Fprintf(&sb, "    > %s\n", h)
		}
		sb.WriteByte('\n')
	}
	return sb.String()
}
