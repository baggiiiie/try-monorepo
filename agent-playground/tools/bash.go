package tools

import (
	"fmt"
	"strings"
)

// CommandExecutor runs a command and returns output.
type CommandExecutor func(command string, timeoutMs int) (string, error)

// CommandPolicy decides whether a command is allowed to run.
type CommandPolicy func(command string) (allowed bool)

type BashTool struct {
	Executor CommandExecutor
	Policy   CommandPolicy
	// DescriptionSuffix is appended to the description (e.g. listing allowed commands).
	DescriptionSuffix string
}

func (t *BashTool) Name() string { return "bash" }

func (t *BashTool) Description() string {
	desc := "Run a bash command and return its output."
	if t.DescriptionSuffix != "" {
		desc += " " + t.DescriptionSuffix
	}
	return desc
}

func (t *BashTool) Schema() map[string]any {
	return BuildSchema([]Param{
		{Name: "command", Type: "string", Description: "The bash command to run", Required: true},
		{Name: "timeout", Type: "number", Description: "Timeout in milliseconds (default: 30000)"},
	})
}

func (t *BashTool) Execute(args map[string]any) string {
	command, _ := args["command"].(string)
	timeoutMs := 30000
	if tm, ok := args["timeout"].(float64); ok {
		timeoutMs = int(tm)
	}

	if t.Policy != nil && !t.Policy(command) {
		return "Error: command rejected by policy"
	}

	output, err := t.Executor(command, timeoutMs)
	if err != nil {
		return fmt.Sprintf("%s\nError: %v", output, err)
	}
	return output
}

// DefaultAllowedCommands lists command prefixes that run without user approval.
var DefaultAllowedCommands = []string{
	"ls", "cat", "head", "tail", "grep", "find", "wc",
	"echo", "pwd", "whoami", "env", "printenv",
	"date", "uname", "file", "which", "type",
	"tree", "du", "df", "stat",
	"go build", "go test", "go run", "go fmt", "go vet",
	"python", "node",
}

// IsCommandAllowed checks every segment of a piped/chained command
// against the allowed list.
func IsCommandAllowed(command string, allowedCommands []string) bool {
	segments := splitCommand(command)
	for _, seg := range segments {
		if !isSegmentAllowed(seg, allowedCommands) {
			return false
		}
	}
	return true
}

func splitCommand(command string) []string {
	r := strings.NewReplacer("&&", "\x00", "||", "\x00", "|", "\x00", ";", "\x00")
	return strings.Split(r.Replace(command), "\x00")
}

func isSegmentAllowed(segment string, allowedCommands []string) bool {
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
