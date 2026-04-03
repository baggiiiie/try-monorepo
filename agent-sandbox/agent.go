package main

import (
	"agent-sandbox/tools"
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
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

type loopConfig struct {
	Runtime       *Runtime
	Messages      *[]ChatMessage
	Registry      *tools.Registry
	Hooks         *EventHooks
	MaxIterations int
}

func runLoop(cfg loopConfig) error {
	for range cfg.MaxIterations {
		reqBody := ChatRequest{
			Model:               cfg.Runtime.Model,
			Messages:            *cfg.Messages,
			Tools:               cfg.Registry.Definitions(),
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

		req, err := http.NewRequest("POST", cfg.Runtime.BaseURL+"/chat/completions", bytes.NewReader(reqJSON))
		if err != nil {
			return fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+cfg.Runtime.APIKey)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return fmt.Errorf("API request failed: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
		}

		var contentBuf strings.Builder
		var toolCalls []ToolCall
		hasReasoning := false
		hasContent := false
		hooks := cfg.Hooks

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

		*cfg.Messages = append(*cfg.Messages, ChatMessage{
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
				result := cfg.Registry.Execute(tc.Function.Name, parseArgs(tc.Function.Arguments))
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
			*cfg.Messages = append(*cfg.Messages, r.msg)
		}
	}

	return nil
}

func handleTurn(app *App) error {
	if compacted, err := compactIfNeeded(app); err != nil {
		fmt.Fprintf(os.Stderr, "\n[compaction failed: %v]\n", err)
	} else if compacted {
		fmt.Printf("\n[compacted context: %d messages, ~%d tokens]\n", len(app.Messages), estimateTokens(app.Messages))
	}

	if app.ConsumeReloadPending() {
		if err := app.Reload(); err != nil {
			return fmt.Errorf("failed to apply queued reload: %w", err)
		}
		fmt.Printf("\n[reloaded runtime: %s]\n", app.Runtime.Summary())
	}

	return runLoop(loopConfig{
		Runtime:       app.Runtime,
		Messages:      &app.Messages,
		Registry:      buildToolRegistry(app),
		Hooks:         app.Hooks,
		MaxIterations: 20,
	})
}

func runSubagent(app *App, prompt string) (string, error) {
	messages := []ChatMessage{
		{Role: "system", Content: "You are a subagent. Complete the task and respond with a concise summary of what you did."},
		{Role: "user", Content: prompt},
	}

	reg := buildToolRegistry(app)

	err := runLoop(loopConfig{
		Runtime:       app.Runtime,
		Messages:      &messages,
		Registry:      reg,
		Hooks:         &EventHooks{},
		MaxIterations: 10,
	})
	if err != nil {
		return "", err
	}

	// After the subagent's agent loop finishes, walks backward through
	// messages to find the last assistant response and returns it as the tool
	// result string back to the parent agent. If the subagent only made tool
	// calls and never produced text, it returns a fallback message.
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "assistant" && messages[i].Content != "" {
			return messages[i].Content, nil
		}
	}
	return "Subagent completed but produced no response.", nil
}

func parseArgs(raw string) map[string]any {
	var args map[string]any
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return map[string]any{}
	}
	return args
}
