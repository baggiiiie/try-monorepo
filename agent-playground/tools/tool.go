package tools

import "encoding/json"

type Tool interface {
	Name() string
	Description() string
	Schema() map[string]any
	Execute(args map[string]any) string
}

type Tools struct {
	tools []Tool
}

func NewRegistry() *Tools {
	return &Tools{}
}

func (r *Tools) Register(t Tool) {
	r.tools = append(r.tools, t)
}

func (r *Tools) Execute(name string, args map[string]any) string {
	for _, t := range r.tools {
		if t.Name() == name {
			return t.Execute(args)
		}
	}
	return "Unknown tool: " + name
}

type Param struct {
	Name        string
	Type        string
	Description string
	Required    bool
}

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
func (r *Tools) Definitions() json.RawMessage {
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
