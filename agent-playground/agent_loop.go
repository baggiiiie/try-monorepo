package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
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

var httpClient = &http.Client{Timeout: 120 * time.Second}

// httpRequest sends a chat completion request and returns the response body.
func httpRequest(runtime *Runtime, body ChatRequest) (io.ReadCloser, error) {
	reqJSON, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", runtime.BaseURL+"/chat/completions", bytes.NewReader(reqJSON))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+runtime.APIKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("API request failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	return resp.Body, nil
}

// streamResponse reads the SSE stream, dispatches hooks, and returns the
// assembled assistant content and tool calls.
func streamResponse(body io.ReadCloser, hooks *EventHooks) (string, []ToolCall, error) {
	defer func() { _ = body.Close() }()

	var contentBuf strings.Builder
	var toolCalls []ToolCall
	hasReasoning := false
	hasContent := false

	scanner := bufio.NewScanner(body)
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

	if hasReasoning && !hasContent {
		if hooks.OnReasoningDone != nil {
			hooks.OnReasoningDone()
		}
	}
	if hooks.OnContentDone != nil {
		hooks.OnContentDone(contentBuf.String())
	}

	if err := scanner.Err(); err != nil {
		return contentBuf.String(), toolCalls, fmt.Errorf("stream read error: %w", err)
	}

	return contentBuf.String(), toolCalls, nil
}

// handleToolCalls executes tool calls sequentially and returns the result messages.
func handleToolCalls(agent *Agent, toolCalls []ToolCall) []ChatMessage {
	results := make([]ChatMessage, len(toolCalls))

	for i, tc := range toolCalls {
		if agent.Hooks.OnToolCallReady != nil {
			agent.Hooks.OnToolCallReady(tc)
		}

		args, err := parseArgs(tc.Function.Arguments)
		var result string
		if err != nil {
			result = fmt.Sprintf("Error: invalid arguments: %v", err)
		} else {
			result = agent.Tools.Execute(tc.Function.Name, args)
		}

		if agent.Hooks.OnToolResult != nil {
			agent.Hooks.OnToolResult(tc.Function.Name, result)
		}

		results[i] = ChatMessage{
			Role:       "tool",
			ToolCallID: tc.ID,
			Content:    result,
		}
	}

	return results
}

// runAgentTurn keeps going until there are no more tool calls.
func runAgentTurn(runtime *Runtime, agent *Agent, messages *[]ChatMessage) error {
	for range agent.MaxIterations {
		reqBody := ChatRequest{
			Model:               runtime.Model,
			Messages:            *messages,
			Tools:               agent.Tools.Definitions(),
			ToolChoice:          "auto",
			Temperature:         0.6,
			MaxCompletionTokens: 4096,
			ReasoningEffort:     "high",
			Stream:              true,
		}

		body, err := httpRequest(runtime, reqBody)
		if err != nil {
			return err
		}

		content, toolCalls, err := streamResponse(body, agent.Hooks)
		if err != nil {
			return err
		}

		*messages = append(*messages, ChatMessage{
			Role:      "assistant",
			Content:   content,
			ToolCalls: toolCalls,
		})

		if len(toolCalls) == 0 {
			break
		}

		*messages = append(*messages, handleToolCalls(agent, toolCalls)...)
	}

	// Check if we exhausted iterations while still in a tool loop.
	if last := (*messages)[len(*messages)-1]; len(last.ToolCalls) > 0 {
		return fmt.Errorf("agent loop exceeded maximum iterations (%d)", agent.MaxIterations)
	}

	return nil
}

func parseArgs(raw string) (map[string]any, error) {
	var args map[string]any
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return nil, err
	}
	return args, nil
}
