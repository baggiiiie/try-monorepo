package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

func readFileTool(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Sprintf("Error reading file: %v", err)
	}
	return string(data)
}

func writeFileTool(path, content string) string {
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return fmt.Sprintf("Error writing file: %v", err)
	}
	return fmt.Sprintf("File written to %s", path)
}

func editFileTool(path, oldStr, newStr string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Sprintf("Error reading file: %v", err)
	}
	content := string(data)
	count := strings.Count(content, oldStr)
	if count == 0 {
		return "Error: old_str not found in file"
	}
	if count > 1 {
		return fmt.Sprintf("Error: old_str found %d times in file, expected exactly 1", count)
	}
	newContent := strings.Replace(content, oldStr, newStr, 1)
	if err := os.WriteFile(path, []byte(newContent), 0644); err != nil {
		return fmt.Sprintf("Error writing file: %v", err)
	}
	return "File edited successfully"
}

func bashTool(command string, timeoutMs int) string {
	if timeoutMs <= 0 {
		timeoutMs = 30000
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	cmd := exec.CommandContext(ctx, "/bin/bash", "-c", command)
	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return fmt.Sprintf("Command timed out after %dms", timeoutMs)
	}
	if err != nil {
		return fmt.Sprintf("%s\nError: %v", string(output), err)
	}
	return string(output)
}

func executeTool(name string, args map[string]any) string {
	switch name {
	case "read_file":
		path, _ := args["path"].(string)
		return readFileTool(path)
	case "write_file":
		path, _ := args["path"].(string)
		content, _ := args["content"].(string)
		return writeFileTool(path, content)
	case "edit_file":
		path, _ := args["path"].(string)
		oldStr, _ := args["old_str"].(string)
		newStr, _ := args["new_str"].(string)
		return editFileTool(path, oldStr, newStr)
	case "bash":
		command, _ := args["command"].(string)
		timeoutMs := 30000
		if t, ok := args["timeout"].(float64); ok {
			timeoutMs = int(t)
		}
		return bashTool(command, timeoutMs)
	default:
		return fmt.Sprintf("Unknown tool: %s", name)
	}
}

func getToolDefinitions() json.RawMessage {
	tools := []map[string]any{
		{
			"type": "function",
			"function": map[string]any{
				"name":        "read_file",
				"description": "Read the contents of a file at the given path.",
				"parameters": map[string]any{
					"type":     "object",
					"required": []string{"path"},
					"properties": map[string]any{
						"path": map[string]any{
							"type":        "string",
							"description": "The path of the file to read",
						},
					},
				},
			},
		},
		{
			"type": "function",
			"function": map[string]any{
				"name":        "write_file",
				"description": "Write content to a file at the given path.",
				"parameters": map[string]any{
					"type":     "object",
					"required": []string{"path", "content"},
					"properties": map[string]any{
						"path": map[string]any{
							"type":        "string",
							"description": "The path of the file to write",
						},
						"content": map[string]any{
							"type":        "string",
							"description": "The content to write to the file",
						},
					},
				},
			},
		},
		{
			"type": "function",
			"function": map[string]any{
				"name":        "edit_file",
				"description": "Edit a file by replacing old_str with new_str. The old_str must appear exactly once in the file.",
				"parameters": map[string]any{
					"type":     "object",
					"required": []string{"path", "old_str", "new_str"},
					"properties": map[string]any{
						"path": map[string]any{
							"type":        "string",
							"description": "The path of the file to edit",
						},
						"old_str": map[string]any{
							"type":        "string",
							"description": "The string to search for in the file",
						},
						"new_str": map[string]any{
							"type":        "string",
							"description": "The string to replace old_str with",
						},
					},
				},
			},
		},
		{
			"type": "function",
			"function": map[string]any{
				"name":        "bash",
				"description": "Run a bash command and return its output.",
				"parameters": map[string]any{
					"type":     "object",
					"required": []string{"command"},
					"properties": map[string]any{
						"command": map[string]any{
							"type":        "string",
							"description": "The bash command to run",
						},
						"timeout": map[string]any{
							"type":        "number",
							"description": "Timeout in milliseconds (default: 30000)",
						},
					},
				},
			},
		},
	}
	b, _ := json.Marshal(tools)
	return json.RawMessage(b)
}
