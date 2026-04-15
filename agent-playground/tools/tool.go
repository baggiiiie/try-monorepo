package tools

import "encoding/json"

// Tool is the interface every tool must implement.
type Tool interface {
	// Name returns the tool's identifier used in function calling.
	Name() string

	// Description returns a human-readable description of the tool.
	Description() string

	// Schema returns the full JSON-schema "parameters" object
	// (including "type", "required", and "properties").
	Schema() map[string]any

	// Execute runs the tool with the given arguments and returns the result.
	Execute(args map[string]any) string
}

// Registry holds all registered tools.
type Registry struct {
	tools []Tool
}

// NewRegistry creates an empty tool registry.
func NewRegistry() *Registry {
	return &Registry{}
}

// Register adds a tool to the registry.
func (r *Registry) Register(t Tool) {
	r.tools = append(r.tools, t)
}

// Execute dispatches a tool call by name.
func (r *Registry) Execute(name string, args map[string]any) string {
	for _, t := range r.tools {
		if t.Name() == name {
			return t.Execute(args)
		}
	}
	return "Unknown tool: " + name
}

// Param describes a single tool parameter.
type Param struct {
	Name        string
	Type        string
	Description string
	Required    bool
}

// BuildSchema builds a JSON-schema "parameters" object from a list of Params.
func BuildSchema(params []Param) map[string]any {
	properties := make(map[string]any, len(params))
	var required []string
	for _, p := range params {
		properties[p.Name] = map[string]any{
			"type":        p.Type,
			"description": p.Description,
		}
		if p.Required {
			required = append(required, p.Name)
		}
	}
	schema := map[string]any{
		"type":       "object",
		"properties": properties,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

// Definitions returns the OpenAI-compatible tool definitions as JSON.
func (r *Registry) Definitions() json.RawMessage {
	defs := make([]map[string]any, 0, len(r.tools))
	for _, t := range r.tools {
		defs = append(defs, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        t.Name(),
				"description": t.Description(),
				"parameters":  t.Schema(),
			},
		})
	}
	b, _ := json.Marshal(defs)
	return json.RawMessage(b)
}
