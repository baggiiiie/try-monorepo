package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

const (
	sessionFilePath   = ".session.json"
	compactThreshold  = 0.8
	recentTurnsToKeep = 4
)

func saveSession(messages []ChatMessage) error {
	data, err := json.MarshalIndent(messages, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal session: %w", err)
	}
	if err := os.WriteFile(sessionFilePath, data, 0o644); err != nil {
		return fmt.Errorf("failed to write session file: %w", err)
	}
	return nil
}

func loadSession() ([]ChatMessage, error) {
	data, err := os.ReadFile(sessionFilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read session file: %w", err)
	}
	var messages []ChatMessage
	if err := json.Unmarshal(data, &messages); err != nil {
		return nil, fmt.Errorf("failed to parse session file: %w", err)
	}
	return messages, nil
}

// estimateTokens returns a rough token count (~4 chars per token).
func estimateTokens(messages []ChatMessage) int {
	total := 0
	for _, m := range messages {
		total += len(m.Content)/4 + 4 // +4 per-message overhead
		for _, tc := range m.ToolCalls {
			total += len(tc.Function.Name)/4 + len(tc.Function.Arguments)/4
		}
	}
	return total
}

// compactIfNeeded checks token usage and summarizes old messages if over threshold.
// Returns true if compaction was performed.
func compactIfNeeded(app *App) (bool, error) {
	maxTokens := app.Runtime.MaxContextTokens
	threshold := int(float64(maxTokens) * compactThreshold)
	estimated := estimateTokens(app.Messages)

	if estimated <= threshold {
		return false, nil
	}

	// Find the split point: keep system prompt + last N user turns.
	splitIdx := findSplitIndex(app.Messages, recentTurnsToKeep)
	if splitIdx <= 1 {
		// Nothing meaningful to compact (only system prompt + recent).
		return false, nil
	}

	oldMessages := app.Messages[1:splitIdx] // skip system prompt
	if len(oldMessages) == 0 {
		return false, nil
	}

	summary, err := summarizeMessages(app, oldMessages)
	if err != nil {
		return false, fmt.Errorf("compaction summarization failed: %w", err)
	}

	// Rebuild: [system] [summary] [recent...]
	compacted := make([]ChatMessage, 0, 2+len(app.Messages)-splitIdx)
	compacted = append(compacted, app.Messages[0]) // system prompt
	compacted = append(compacted, ChatMessage{
		Role:    "system",
		Content: "[Summary of earlier conversation]\n" + summary,
	})
	compacted = append(compacted, app.Messages[splitIdx:]...)
	app.Messages = compacted

	return true, nil
}

// findSplitIndex walks backward to find the Nth user message from the end,
// and returns the index to split at (everything before this is "old").
func findSplitIndex(messages []ChatMessage, keepTurns int) int {
	userCount := 0
	for i := len(messages) - 1; i >= 1; i-- {
		if messages[i].Role == "user" {
			userCount++
			if userCount >= keepTurns {
				return i
			}
		}
	}
	return 1 // can't split further
}

// summarizeMessages sends old messages to the LLM and asks for a concise summary.
func summarizeMessages(app *App, messages []ChatMessage) (string, error) {
	prompt := []ChatMessage{
		{
			Role:    "system",
			Content: "You are a summarizer. Condense the following conversation into a concise summary that preserves all key facts, decisions, file paths, code changes, and action items. Be thorough but brief.",
		},
	}

	// Flatten messages into a single user message for the summary request.
	var buf bytes.Buffer
	for _, m := range messages {
		fmt.Fprintf(&buf, "[%s]: %s\n", m.Role, m.Content)
		for _, tc := range m.ToolCalls {
			fmt.Fprintf(&buf, "[tool_call %s]: %s(%s)\n", tc.ID, tc.Function.Name, tc.Function.Arguments)
		}
	}
	prompt = append(prompt, ChatMessage{
		Role:    "user",
		Content: buf.String(),
	})

	reqBody := ChatRequest{
		Model:               app.Runtime.Model,
		Messages:            prompt,
		Temperature:         0.3,
		MaxCompletionTokens: 1024,
		Stream:              false,
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", app.Runtime.BaseURL+"/chat/completions", bytes.NewReader(reqJSON))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+app.Runtime.APIKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	var chatResp ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return "", err
	}
	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("no choices in summarization response")
	}
	return chatResp.Choices[0].Message.Content, nil
}
