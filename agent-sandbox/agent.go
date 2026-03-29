package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
)

type ChatMessage struct {
	Role       string     `json:"role"`
	Content    string     `json:"content,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function ToolFunction `json:"function"`
}

type ToolFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type ChatRequest struct {
	Model               string          `json:"model"`
	Messages            []ChatMessage   `json:"messages"`
	Tools               json.RawMessage `json:"tools,omitempty"`
	ToolChoice          string          `json:"tool_choice,omitempty"`
	Temperature         float64         `json:"temperature"`
	MaxCompletionTokens int             `json:"max_completion_tokens,omitempty"`
	ReasoningEffort     string          `json:"reasoning_effort,omitempty"`
	Stream              bool            `json:"stream"`
}

type ChatResponse struct {
	Choices []struct {
		Message struct {
			Role      string     `json:"role"`
			Content   string     `json:"content"`
			Reasoning string     `json:"reasoning"`
			ToolCalls []ToolCall `json:"tool_calls"`
		} `json:"message"`
	} `json:"choices"`
}

type StreamChunk struct {
	Choices []struct {
		Delta struct {
			Role      string                `json:"role,omitempty"`
			Content   string                `json:"content,omitempty"`
			Reasoning string                `json:"reasoning,omitempty"`
			ToolCalls []StreamToolCallDelta `json:"tool_calls,omitempty"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

type StreamToolCallDelta struct {
	Index    int    `json:"index"`
	ID       string `json:"id,omitempty"`
	Type     string `json:"type,omitempty"`
	Function struct {
		Name      string `json:"name,omitempty"`
		Arguments string `json:"arguments,omitempty"`
	} `json:"function,omitempty"`
}

func handleTurn(app *App) error {
	const maxIterations = 20

	for iterations := 0; iterations < maxIterations; iterations++ {
		if app.ConsumeReloadPending() {
			if err := app.Reload(); err != nil {
				return fmt.Errorf("failed to apply queued reload: %w", err)
			}
			fmt.Printf("\n[reloaded runtime: %s]\n", app.Runtime.Summary())
		}

		reqBody := ChatRequest{
			Model:               app.Runtime.Model,
			Messages:            app.Messages,
			Tools:               getToolDefinitions(app.Runtime),
			ToolChoice:          "auto",
			Temperature:         0.6,
			MaxCompletionTokens: 4096,
			ReasoningEffort:     "high",
			Stream:              true,
		}

		reqJSON, err := json.Marshal(reqBody)
		if err != nil {
			return fmt.Errorf("failed to marshal request: %w", err)
		}

		req, err := http.NewRequest("POST", app.Runtime.BaseURL+"/chat/completions", bytes.NewReader(reqJSON))
		if err != nil {
			return fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+app.Runtime.APIKey)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return fmt.Errorf("API request failed: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
		}

		// Accumulate the streamed response.
		var contentBuf strings.Builder
		var toolCalls []ToolCall
		hasReasoning := false
		hasContent := false
		hooks := app.Hooks

		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				break
			}

			var chunk StreamChunk
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				continue
			}
			if len(chunk.Choices) == 0 {
				continue
			}

			delta := chunk.Choices[0].Delta

			if delta.Reasoning != "" {
				hasReasoning = true
				if hooks.OnReasoningDelta != nil {
					hooks.OnReasoningDelta(delta.Reasoning)
				}
			}

			if delta.Content != "" {
				if hasReasoning && !hasContent {
					if hooks.OnReasoningDone != nil {
						hooks.OnReasoningDone()
					}
				}
				hasContent = true
				if hooks.OnContentDelta != nil {
					hooks.OnContentDelta(delta.Content)
				}
				contentBuf.WriteString(delta.Content)
			}

			for _, tc := range delta.ToolCalls {
				for tc.Index >= len(toolCalls) {
					toolCalls = append(toolCalls, ToolCall{Type: "function"})
				}
				if tc.ID != "" {
					toolCalls[tc.Index].ID = tc.ID
				}
				if tc.Function.Name != "" {
					toolCalls[tc.Index].Function.Name += tc.Function.Name
				}
				if tc.Function.Arguments != "" {
					toolCalls[tc.Index].Function.Arguments += tc.Function.Arguments
				}
				if hooks.OnToolCallDelta != nil {
					hooks.OnToolCallDelta(tc.Index, tc)
				}
			}
		}
		resp.Body.Close()

		if hasReasoning && !hasContent {
			if hooks.OnReasoningDone != nil {
				hooks.OnReasoningDone()
			}
		}
		if hooks.OnContentDone != nil {
			hooks.OnContentDone(contentBuf.String())
		}

		app.Messages = append(app.Messages, ChatMessage{
			Role:      "assistant",
			Content:   contentBuf.String(),
			ToolCalls: toolCalls,
		})

		if len(toolCalls) == 0 {
			break
		}

		type toolResult struct {
			msg ChatMessage
		}
		results := make([]toolResult, len(toolCalls))
		var wg sync.WaitGroup

		for i, tc := range toolCalls {
			wg.Add(1)
			go func(i int, tc ToolCall) {
				defer wg.Done()

				if hooks.OnToolCallReady != nil {
					hooks.OnToolCallReady(tc)
				}
				result := executeTool(tc.Function.Name, parseArgs(tc.Function.Arguments), app)
				if hooks.OnToolResult != nil {
					hooks.OnToolResult(tc.Function.Name, result)
				}

				results[i] = toolResult{
					msg: ChatMessage{
						Role:       "tool",
						ToolCallID: tc.ID,
						Content:    result,
					},
				}
			}(i, tc)
		}
		wg.Wait()

		for _, r := range results {
			app.Messages = append(app.Messages, r.msg)
		}
	}

	return nil
}

func parseArgs(raw string) map[string]any {
	var args map[string]any
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return map[string]any{}
	}
	return args
}
