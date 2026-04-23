package tools

import (
	"encoding/json"
	"strings"

	"agent-playground/mcp"
)

type MCPTool struct {
	QualifiedName   string         // namespaced name: "servername__toolname"
	RemoteName      string         // original tool name on the MCP server
	DescriptionText string
	InputSchema     map[string]any
	Client          *mcp.Client
}

func (t *MCPTool) Name() string {
	return t.QualifiedName
}

func (t *MCPTool) Description() string {
	return t.DescriptionText
}

func (t *MCPTool) Schema() map[string]any {
	if t.InputSchema != nil {
		return t.InputSchema
	}
	return map[string]any{
		"type":       "object",
		"properties": map[string]any{},
	}
}

func (t *MCPTool) Execute(args map[string]any) string {
	result, err := t.Client.CallTool(t.RemoteName, args)
	if err != nil {
		return "MCP error: " + err.Error()
	}

	var parts []string
	for _, item := range result.Content {
		if item.Type == "text" {
			parts = append(parts, item.Text)
		} else {
			b, _ := json.Marshal(item)
			parts = append(parts, string(b))
		}
	}

	if len(parts) == 0 {
		return "Tool returned no content"
	}

	output := strings.Join(parts, "\n")
	if result.IsError {
		return "Error: " + output
	}
	return output
}
