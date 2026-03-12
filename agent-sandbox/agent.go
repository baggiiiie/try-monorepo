package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
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
			// model = "qwen2.5-coder:7b"
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
	iterations := 0

	for iterations < maxIterations {
		iterations++

		reqBody := ChatRequest{
			Model:               model,
			Messages:            *messages,
			Tools:               getToolDefinitions(),
			ToolChoice:          "auto",
			Temperature:         0.6,
			MaxCompletionTokens: 4096,
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

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return fmt.Errorf("failed to read response: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
		}

		var chatResp ChatResponse
		if err := json.Unmarshal(body, &chatResp); err != nil {
			return fmt.Errorf("failed to parse response: %w", err)
		}

		if len(chatResp.Choices) == 0 {
			return fmt.Errorf("no choices in response")
		}

		msg := chatResp.Choices[0].Message

		if msg.Reasoning != "" {
			logMsg("REASONING", msg.Reasoning)
		}

		if msg.Content != "" {
			fmt.Printf("\nAgent> %s\n", msg.Content)
		}

		assistantMsg := ChatMessage{
			Role:      msg.Role,
			Content:   msg.Content,
			ToolCalls: msg.ToolCalls,
		}
		*messages = append(*messages, assistantMsg)

		if len(msg.ToolCalls) == 0 {
			break
		}

		for _, tc := range msg.ToolCalls {
			var args map[string]any
			if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
				args = map[string]any{}
			}

			logMsg("TOOL CALL: "+tc.Function.Name, args)

			result := executeTool(tc.Function.Name, args)

			logMsg("TOOL RESULT: "+tc.Function.Name, result)

			*messages = append(*messages, ChatMessage{
				Role:       "tool",
				ToolCallID: tc.ID,
				Content:    result,
			})
		}
	}

	if iterations > maxIterations {
		fmt.Println("\n⚠️  Max iterations reached, stopping.")
	}

	return nil
}
