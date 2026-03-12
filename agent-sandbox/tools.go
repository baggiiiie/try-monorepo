package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var (
	READ_FILE_TOOL  = "read_file"
	WRITE_FILE_TOOL = "write_file"
	EDIT_FILE_TOOL  = "edit_file"
	BASH_TOOL       = "bash"
)

// validatePath ensures the path is within the workspace directory.
func validatePath(path string) (string, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("invalid path: %w", err)
	}
	workspace, _ := filepath.Abs(hostWorkDir())
	if !strings.HasPrefix(absPath, workspace+string(filepath.Separator)) && absPath != workspace {
		return "", fmt.Errorf("access denied: path %s is outside workspace %s", absPath, workspace)
	}
	return absPath, nil
}

func readFileTool(path string) string {
	safe, err := validatePath(path)
	if err != nil {
		return fmt.Sprintf("Error: %v", err)
	}
	data, err := os.ReadFile(safe)
	if err != nil {
		return fmt.Sprintf("Error reading file: %v", err)
	}
	return string(data)
}

func writeFileTool(path, content string) string {
	safe, err := validatePath(path)
	if err != nil {
		return fmt.Sprintf("Error: %v", err)
	}
	if err := os.WriteFile(safe, []byte(content), 0o644); err != nil {
		return fmt.Sprintf("Error writing file: %v", err)
	}
	return fmt.Sprintf("File written to %s", safe)
}

func editFileTool(path, oldStr, newStr string) string {
	safe, err := validatePath(path)
	if err != nil {
		return fmt.Sprintf("Error: %v", err)
	}
	data, err := os.ReadFile(safe)
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
	if err := os.WriteFile(safe, []byte(newContent), 0o644); err != nil {
		return fmt.Sprintf("Error writing file: %v", err)
	}
	return "File edited successfully"
}

// allowedCommands lists command prefixes that run without user approval.
var allowedCommands = []string{
	"ls", "cat", "head", "tail", "grep", "find", "wc",
	"echo", "pwd", "whoami", "env", "printenv",
	"date", "uname", "file", "which", "type",
	"tree", "du", "df", "stat",
	"go build", "go test", "go run", "go fmt", "go vet",
	"python", "node",
}

func isCommandAllowed(command string) bool {
	// Split on pipes and logical operators, check every segment.
	segments := splitCommand(command)
	for _, seg := range segments {
		if !isSegmentAllowed(seg) {
			return false
		}
	}
	return true
}

func splitCommand(command string) []string {
	// Split on |, &&, ||, ;
	// Use a simple replacer to normalize delimiters, then split.
	r := strings.NewReplacer("&&", "\x00", "||", "\x00", "|", "\x00", ";", "\x00")
	return strings.Split(r.Replace(command), "\x00")
}

func isSegmentAllowed(segment string) bool {
	cmd := strings.TrimSpace(segment)
	if cmd == "" {
		return true
	}
	for _, allowed := range allowedCommands {
		if cmd == allowed || strings.HasPrefix(cmd, allowed+" ") {
			return true
		}
	}
	return false
}

func askApproval(command string) bool {
	fmt.Printf("\n⚠️  Command needs approval: %s\nAllow? [y/N] ", command)
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		return false
	}
	answer := strings.TrimSpace(strings.ToLower(scanner.Text()))
	return answer == "y" || answer == "yes"
}

func bashTool(command string, timeoutMs int) string {
	if !isCommandAllowed(command) {
		if !askApproval(command) {
			return "Error: command rejected by user"
		}
	}
	output, err := dockerExec(command, timeoutMs)
	if err != nil {
		return fmt.Sprintf("%s\nError: %v", output, err)
	}
	return output
}

func executeTool(name string, args map[string]any) string {
	switch name {
	case READ_FILE_TOOL:
		path, _ := args["path"].(string)
		return readFileTool(path)
	case WRITE_FILE_TOOL:
		path, _ := args["path"].(string)
		content, _ := args["content"].(string)
		return writeFileTool(path, content)
	case EDIT_FILE_TOOL:
		path, _ := args["path"].(string)
		oldStr, _ := args["old_str"].(string)
		newStr, _ := args["new_str"].(string)
		return editFileTool(path, oldStr, newStr)
	case BASH_TOOL:
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
