package tools

import (
	"agent-playground/mcp"
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// MCPRegistry is the slice of MCPManager functionality the code-mode tools
// need. Defined here as an interface so the tools package does not depend on
// main.
type MCPRegistry interface {
	AllTools() []QualifiedTool
	CallTool(server, tool string, args map[string]any) (*mcp.CallResult, error)
}

// QualifiedTool pairs a server name with a tool definition.
type QualifiedTool struct {
	Server string
	Tool   mcp.ToolDef
}

// ----- search_tools -----

type SearchToolsTool struct {
	Registry MCPRegistry
}

func (t *SearchToolsTool) Name() string { return "search_tools" }
func (t *SearchToolsTool) Description() string {
	return strings.TrimSpace(`
Search MCP tools by keyword. Returns JSDoc-style signatures you can call from
execute_code (e.g. example.greet({ name: "Bob" })). Pass an empty query to list
every available tool.
`)
}
func (t *SearchToolsTool) Schema() map[string]any {
	return BuildSchema([]Param{
		{Name: "query", Type: "string", Description: "keyword(s) to match against tool name or description; empty for all", Required: false},
	})
}
func (t *SearchToolsTool) Execute(args map[string]any) string {
	query, _ := args["query"].(string)
	q := strings.ToLower(strings.TrimSpace(query))

	var matched []QualifiedTool
	for _, qt := range t.Registry.AllTools() {
		if q == "" ||
			strings.Contains(strings.ToLower(qt.Tool.Name), q) ||
			strings.Contains(strings.ToLower(qt.Tool.Description), q) {
			matched = append(matched, qt)
		}
	}

	if len(matched) == 0 {
		return "No tools match. Call search_tools with an empty query to list everything."
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "// %d matching tool(s). Call from execute_code as `<server>.<tool>(args)`.\n", len(matched))
	sb.WriteString("// Each call returns a Promise that resolves to { content: [{type, text}], isError? }.\n\n")
	for _, qt := range matched {
		sb.WriteString(formatToolAsJSDoc(qt))
		sb.WriteString("\n")
	}
	return sb.String()
}

func formatToolAsJSDoc(qt QualifiedTool) string {
	var sb strings.Builder
	desc := strings.TrimSpace(qt.Tool.Description)
	if desc != "" {
		fmt.Fprintf(&sb, "/** %s */\n", desc)
	}
	fmt.Fprintf(&sb, "%s.%s(args: %s): Promise<{ content: {type:string,text:string}[], isError?: boolean }>\n",
		qt.Server, qt.Tool.Name, schemaToTSType(qt.Tool.InputSchema))
	return sb.String()
}

func schemaToTSType(schema map[string]any) string {
	if schema == nil {
		return "{}"
	}
	props, _ := schema["properties"].(map[string]any)
	if len(props) == 0 {
		return "{}"
	}

	requiredSet := map[string]bool{}
	if reqs, ok := schema["required"].([]any); ok {
		for _, r := range reqs {
			if s, ok := r.(string); ok {
				requiredSet[s] = true
			}
		}
	}

	parts := make([]string, 0, len(props))
	for name, p := range props {
		pm, _ := p.(map[string]any)
		ty, _ := pm["type"].(string)
		marker := "?"
		if requiredSet[name] {
			marker = ""
		}
		parts = append(parts, fmt.Sprintf("%s%s: %s", name, marker, jsonTypeToTSType(ty)))
	}
	return "{ " + strings.Join(parts, ", ") + " }"
}

func jsonTypeToTSType(t string) string {
	switch t {
	case "string":
		return "string"
	case "number", "integer":
		return "number"
	case "boolean":
		return "boolean"
	case "object":
		return "object"
	case "array":
		return "any[]"
	default:
		return "any"
	}
}

// ----- execute_code -----

type ExecuteCodeTool struct {
	Registry  MCPRegistry
	Workspace string
}

func (t *ExecuteCodeTool) Name() string { return "execute_code" }
func (t *ExecuteCodeTool) Description() string {
	return strings.TrimSpace(`
Run JavaScript (Node.js, ESM) that can call MCP tools. Each MCP server is
exposed as a global namespace (e.g. example.greet({ name: "Bob" }) returns a
Promise resolving to { content: [...] }). Top-level await is supported.
console.log output is captured and returned. If you don't know what's
available, call search_tools first.
`)
}
func (t *ExecuteCodeTool) Schema() map[string]any {
	return BuildSchema([]Param{
		{Name: "source", Type: "string", Description: "JavaScript ESM source to execute. Use top-level await.", Required: true},
	})
}

// codeModeRuntimePrelude is prepended to the user's source to form a single
// ESM module. We avoid dynamic import of a separate user file because that
// kept node's event loop alive and prevented clean exit.
const codeModeRuntimePrelude = `import net from "node:net";
import readline from "node:readline";

// Use net.Socket on the inherited pipe fds. fs.createReadStream gets stuck on
// libuv's threadpool and blocks process.exit() in some node versions.
const __rpcOut = new net.Socket({ fd: 3, readable: false, writable: true });
const __rpcInRaw = new net.Socket({ fd: 4, readable: true, writable: false });
const __rpcIn = readline.createInterface({ input: __rpcInRaw });

let __rpcId = 0;
const __pending = new Map();
__rpcIn.on("line", (line) => {
    try {
        const msg = JSON.parse(line);
        const p = __pending.get(msg.id);
        if (!p) return;
        __pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
    } catch {}
});

function __rpcCall(server, tool, args) {
    return new Promise((resolve, reject) => {
        const id = ++__rpcId;
        __pending.set(id, { resolve, reject });
        __rpcOut.write(JSON.stringify({ id, server, tool, args: args || {} }) + "\n");
    });
}

for (const [__s, __ts] of Object.entries(JSON.parse(process.env.MCP_SERVERS || "{}"))) {
    const __ns = {};
    for (const __t of __ts) __ns[__t] = (args) => __rpcCall(__s, __t, args);
    globalThis[__s] = __ns;
}

try {
    await (async () => {
// ---- user code below ----
`

const codeModeRuntimePostlude = `
// ---- user code above ----
    })();
} catch (e) {
    console.error(e && e.stack || String(e));
    process.exit(1);
}
process.exit(0);
`

func (t *ExecuteCodeTool) Execute(args map[string]any) string {
	source, _ := args["source"].(string)
	if strings.TrimSpace(source) == "" {
		return "Error: source is empty"
	}

	cmDir := filepath.Join(t.Workspace, ".code-mode")
	if err := os.MkdirAll(cmDir, 0o755); err != nil {
		return "Error creating .code-mode dir: " + err.Error()
	}
	runtimePath := filepath.Join(cmDir, "run.mjs")
	full := codeModeRuntimePrelude + source + codeModeRuntimePostlude
	if err := os.WriteFile(runtimePath, []byte(full), 0o644); err != nil {
		return "Error writing runtime: " + err.Error()
	}

	servers := map[string][]string{}
	for _, qt := range t.Registry.AllTools() {
		servers[qt.Server] = append(servers[qt.Server], qt.Tool.Name)
	}
	serversJSON, _ := json.Marshal(servers)

	// fd3 = child→parent (RPC requests), fd4 = parent→child (RPC responses)
	rpcOutR, rpcOutW, err := os.Pipe()
	if err != nil {
		return "Error pipe: " + err.Error()
	}
	rpcInR, rpcInW, err := os.Pipe()
	if err != nil {
		rpcOutR.Close()
		rpcOutW.Close()
		return "Error pipe: " + err.Error()
	}

	cmd := exec.Command("node", runtimePath)
	cmd.Env = append(os.Environ(), "MCP_SERVERS="+string(serversJSON))
	cmd.ExtraFiles = []*os.File{rpcOutW, rpcInR}

	var outBuf, errBuf strings.Builder
	cmd.Stdout = &lockedWriter{w: &outBuf}
	cmd.Stderr = &lockedWriter{w: &errBuf}

	if err := cmd.Start(); err != nil {
		rpcOutR.Close()
		rpcOutW.Close()
		rpcInR.Close()
		rpcInW.Close()
		return "Error starting node: " + err.Error()
	}
	// Close child ends in the parent.
	rpcOutW.Close()
	rpcInR.Close()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer rpcInW.Close()

		scanner := bufio.NewScanner(rpcOutR)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			var req struct {
				ID     int            `json:"id"`
				Server string         `json:"server"`
				Tool   string         `json:"tool"`
				Args   map[string]any `json:"args"`
			}
			if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
				continue
			}
			res, callErr := t.Registry.CallTool(req.Server, req.Tool, req.Args)
			resp := map[string]any{"id": req.ID}
			if callErr != nil {
				resp["error"] = callErr.Error()
			} else {
				resp["result"] = res
			}
			data, _ := json.Marshal(resp)
			data = append(data, '\n')
			if _, werr := rpcInW.Write(data); werr != nil {
				return
			}
		}
	}()

	timer := time.AfterFunc(30*time.Second, func() { _ = cmd.Process.Kill() })
	waitErr := cmd.Wait()
	timer.Stop()
	rpcOutR.Close()
	wg.Wait()

	var result strings.Builder
	if outBuf.Len() > 0 {
		result.WriteString("--- stdout ---\n")
		result.WriteString(outBuf.String())
	}
	if errBuf.Len() > 0 {
		if result.Len() > 0 {
			result.WriteString("\n")
		}
		result.WriteString("--- stderr ---\n")
		result.WriteString(errBuf.String())
	}
	if waitErr != nil {
		if result.Len() > 0 {
			result.WriteString("\n")
		}
		fmt.Fprintf(&result, "(node exited with error: %v)", waitErr)
	}
	if result.Len() == 0 {
		return "(no output)"
	}
	return result.String()
}

type lockedWriter struct {
	mu sync.Mutex
	w  *strings.Builder
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}
