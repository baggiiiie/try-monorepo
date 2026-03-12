package main

import (
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

var (
	baseURL string
	apiKey  string
	model   string
)

func init() {
	provider := os.Getenv("PROVIDER")
	if provider == "" {
		provider = "groq"
	}
	model = os.Getenv("OLLAMA_MODEL")

	switch provider {
	case "ollama":
		baseURL = "http://localhost:11434/v1"
		apiKey = "ollama"
		if model == "" {
			model = "gpt-oss:20b"
		}
	default:
		baseURL = "https://api.groq.com/openai/v1"
		apiKey = os.Getenv("GROQ_API_KEY")
		if model == "" {
			model = "openai/gpt-oss-20b"
		}
	}
}

func handleTurn(messages *[]ChatMessage) error {
	const maxIterations = 20

	for iterations := 0; iterations < maxIterations; iterations++ {
		reqBody := ChatRequest{
			Model:               model,
			Messages:            *messages,
			Tools:               getToolDefinitions(),
			ToolChoice:          "auto",
			Temperature:         0.6,
			MaxCompletionTokens: 4096,
			Stream:              true,
		}

		reqJSON, err := json.Marshal(reqBody)
		if err != nil {
			return fmt.Errorf("failed to marshal request: %w", err)
		}

		req, err := http.NewRequest("POST", baseURL+"/chat/completions", bytes.NewReader(reqJSON))
		if err != nil {
			return fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+apiKey)

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
		contentStarted := false
		reasoningStarted := false

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
				if !reasoningStarted {
					fmt.Print("\n<REASONING>\n")
					reasoningStarted = true
				}
				fmt.Print(delta.Reasoning)
			}

			if delta.Content != "" {
				if reasoningStarted && !contentStarted {
					fmt.Print("\n</REASONING>\n")
				}
				if !contentStarted {
					fmt.Print("\nAgent> ")
					contentStarted = true
				}
				fmt.Print(delta.Content)
				contentBuf.WriteString(delta.Content)
			}

			for _, tc := range delta.ToolCalls {
				// Grow the slice as needed.
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
			}
		}
		resp.Body.Close()

		if reasoningStarted && !contentStarted {
			fmt.Print("\n</REASONING>\n")
		}
		if contentStarted {
			fmt.Println()
		}

		// Append the fully-assembled assistant message.
		assistantMsg := ChatMessage{
			Role:      "assistant",
			Content:   contentBuf.String(),
			ToolCalls: toolCalls,
		}
		*messages = append(*messages, assistantMsg)

		if len(toolCalls) == 0 {
			break
		}

		// Execute tool calls in parallel.
		type toolResult struct {
			msg ChatMessage
		}
		results := make([]toolResult, len(toolCalls))
		var wg sync.WaitGroup

		for i, tc := range toolCalls {
			wg.Add(1)
			go func(i int, tc ToolCall) {
				defer wg.Done()

				var args map[string]any
				if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
					args = map[string]any{}
				}

				logMsg("TOOL CALL: "+tc.Function.Name, args)
				result := executeTool(tc.Function.Name, args)
				logMsg("TOOL RESULT: "+tc.Function.Name, result)

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
			*messages = append(*messages, r.msg)
		}
	}

	return nil
}
