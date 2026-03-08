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

const groqEndpoint = "https://api.groq.com/openai/v1/chat/completions"

type chatMessage struct {
	Role       string     `json:"role"`
	Content    string     `json:"content,omitempty"`
	ToolCalls  []toolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

type toolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function functionCall `json:"function"`
}

type functionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
	Tools    []toolDef     `json:"tools"`
}

type toolDef struct {
	Type     string          `json:"type"`
	Function toolFunctionDef `json:"function"`
}

type toolFunctionDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type chatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
}

var shellTool = toolDef{
	Type: "function",
	Function: toolFunctionDef{
		Name:        "run_command",
		Description: "Run a shell command in the sandbox. Allowed commands: echo, ls, pwd, cat, curl. The working directory is /workspace.",
		Parameters: json.RawMessage(`{
			"type": "object",
			"properties": {
				"command": {
					"type": "string",
					"description": "The full command to run, e.g. 'ls -la' or 'cat note.txt'"
				}
			},
			"required": ["command"]
		}`),
	},
}

func initHistory() []chatMessage {
	return []chatMessage{
		{Role: "system", Content: "You are a sandboxed coding agent. You can run commands in a Linux container using the run_command tool. Available commands: echo, ls, pwd, cat, curl."},
	}
}

// handleTurn processes one user message: appends it to history, calls the LLM
// in a tool-call loop (up to maxSteps), and returns the updated history and
// the agent's final text reply.
func handleTurn(apiKey string, history []chatMessage, userMsg string, containerName string, cfg Config, auditor *Auditor, scanner *bufio.Scanner) ([]chatMessage, string, error) {
	history = append(history, chatMessage{Role: "user", Content: userMsg})

	const maxSteps = 10
	for range maxSteps {
		resp, err := callGroq(apiKey, history)
		if err != nil {
			return history, "", fmt.Errorf("groq API error: %w", err)
		}
		if len(resp.Choices) == 0 {
			return history, "", fmt.Errorf("no choices in response")
		}

		msg := resp.Choices[0].Message
		history = append(history, msg)

		if len(msg.ToolCalls) == 0 {
			return history, msg.Content, nil
		}

		// fmt.Printf("  [step %d] %d tool call(s)\n", step+1, len(msg.ToolCalls))
		for _, tc := range msg.ToolCalls {
			result := executeToolCall(tc, containerName, cfg, auditor, scanner)
			history = append(history, chatMessage{
				Role:       "tool",
				ToolCallID: tc.ID,
				Content:    result,
			})
		}
	}

	return history, "(agent reached max steps without a final answer)", nil
}

func executeToolCall(tc toolCall, containerName string, cfg Config, auditor *Auditor, scanner *bufio.Scanner) string {
	var args struct {
		Command string `json:"command"`
	}
	if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
		return fmt.Sprintf("error parsing arguments: %v", err)
	}

	fmt.Printf("  [agent wants to call] `%s`\n", args.Command)

	decision := evaluatePolicy(args.Command, cfg)
	if !decision.Allowed {
		auditor.LogBlocked(args.Command, decision.BlockReason)
		fmt.Printf("    BLOCKED: %s\n", decision.BlockReason)
		return "BLOCKED: " + decision.BlockReason
	}

	if decision.RequiresApproval {
		fmt.Printf("    ⚠ %s\n", decision.ApprovalReason)
		fmt.Print("    Allow? [y/N]: ")
		approved := scanner.Scan() && strings.ToLower(strings.TrimSpace(scanner.Text())) == "y"
		if !approved {
			auditor.LogBlocked(args.Command, "user denied: "+decision.ApprovalReason)
			return "DENIED: user rejected — " + decision.ApprovalReason
		}
	}

	start := time.Now()
	res := runInSandbox(containerName, decision.Parts, 3*time.Second)
	auditor.LogExecution(args.Command, start, res)

	if res.Timeout {
		fmt.Println("    TIMEOUT")
		return "TIMEOUT"
	}
	if res.Err != nil {
		fmt.Printf("    ERROR: %s\n", res.Output)
		return "ERROR: " + res.Output
	}
	fmt.Printf("    Execution output: %s", res.Output)
	return res.Output
}

func callGroq(apiKey string, messages []chatMessage) (*chatResponse, error) {
	reqBody := chatRequest{
		Model:    "openai/gpt-oss-20b",
		Messages: messages,
		Tools:    []toolDef{shellTool},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", groqEndpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var chatResp chatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}
	return &chatResp, nil
}
