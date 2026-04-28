package tools

import (
	"agent-playground/mcp"
	"strings"
	"testing"
)

type fakeRegistry struct {
	tools []QualifiedTool
	calls []string
}

func (f *fakeRegistry) AllTools() []QualifiedTool { return f.tools }
func (f *fakeRegistry) CallTool(server, tool string, args map[string]any) (*mcp.CallResult, error) {
	f.calls = append(f.calls, server+"."+tool)
	switch tool {
	case "list_users":
		return &mcp.CallResult{Content: []mcp.ContentItem{{Type: "text", Text: `[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]`}}}, nil
	case "get_user":
		id, _ := args["id"].(float64)
		return &mcp.CallResult{Content: []mcp.ContentItem{{Type: "text", Text: `{"id":` + itoa(int(id)) + `,"role":"admin"}`}}}, nil
	}
	return &mcp.CallResult{Content: []mcp.ContentItem{{Type: "text", Text: "unknown"}}, IsError: true}, nil
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var b [20]byte
	pos := len(b)
	for i > 0 {
		pos--
		b[pos] = byte('0' + i%10)
		i /= 10
	}
	s := string(b[pos:])
	if neg {
		s = "-" + s
	}
	return s
}

func TestExecuteCode_ComposesMCPCalls(t *testing.T) {
	reg := &fakeRegistry{
		tools: []QualifiedTool{
			{Server: "example", Tool: mcp.ToolDef{Name: "list_users"}},
			{Server: "example", Tool: mcp.ToolDef{Name: "get_user"}},
		},
	}
	tool := &ExecuteCodeTool{Registry: reg, Workspace: t.TempDir()}

	src := `
const list = await example.list_users({});
const ids = JSON.parse(list.content[0].text).map(u => u.id);
const details = [];
for (const id of ids) {
    const r = await example.get_user({ id });
    details.push(JSON.parse(r.content[0].text));
}
console.log("count:", details.length);
console.log("roles:", details.map(d => d.role).join(","));
`
	out := tool.Execute(map[string]any{"source": src})
	t.Logf("output:\n%s", out)

	if !strings.Contains(out, "count: 2") {
		t.Errorf("expected count: 2 in output, got: %s", out)
	}
	if !strings.Contains(out, "roles: admin,admin") {
		t.Errorf("expected roles: admin,admin in output, got: %s", out)
	}

	// Bridge should have been hit 3 times: 1 list_users + 2 get_user.
	wantCalls := []string{"example.list_users", "example.get_user", "example.get_user"}
	if len(reg.calls) != len(wantCalls) {
		t.Fatalf("expected %d calls, got %d (%v)", len(wantCalls), len(reg.calls), reg.calls)
	}
	for i, c := range wantCalls {
		if reg.calls[i] != c {
			t.Errorf("call %d: want %s, got %s", i, c, reg.calls[i])
		}
	}
}

func TestSearchTools_FormatsAsJSDoc(t *testing.T) {
	reg := &fakeRegistry{
		tools: []QualifiedTool{
			{Server: "example", Tool: mcp.ToolDef{
				Name:        "greet",
				Description: "Greet a user by name",
				InputSchema: map[string]any{
					"type":       "object",
					"properties": map[string]any{"name": map[string]any{"type": "string"}},
					"required":   []any{"name"},
				},
			}},
		},
	}
	out := (&SearchToolsTool{Registry: reg}).Execute(map[string]any{"query": "greet"})
	if !strings.Contains(out, "example.greet") {
		t.Errorf("expected example.greet signature, got: %s", out)
	}
	if !strings.Contains(out, "name: string") {
		t.Errorf("expected name: string param, got: %s", out)
	}
	if !strings.Contains(out, "Greet a user by name") {
		t.Errorf("expected description, got: %s", out)
	}
}
