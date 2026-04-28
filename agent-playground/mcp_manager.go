package main

import (
	"fmt"
	"os"
	"regexp"

	"agent-playground/mcp"
	"agent-playground/tools"
)

type MCPServer struct {
	Name   string
	Client *mcp.Client
	Tools  []mcp.ToolDef
}

type MCPManager struct {
	Servers []*MCPServer
}

func NewMCPManager(cfgs []MCPServerConfig) *MCPManager {
	mgr := &MCPManager{}

	// registering each MCP server defined in the agent.json config
	for _, cfg := range cfgs {
		if cfg.Name == "" || cfg.Command == "" {
			fmt.Fprintf(os.Stderr, "MCP: skipping server with missing name or command\n")
			continue
		}

		client := mcp.NewClient(cfg.Name, cfg.Command, cfg.Args)
		if err := client.Start(); err != nil {
			fmt.Fprintf(os.Stderr, "MCP: failed to start %q: %v\n", cfg.Name, err)
			continue
		}

		// as per MCP, there's a handshake needed in order to initialize the connection
		if err := client.Initialize(); err != nil {
			fmt.Fprintf(os.Stderr, "MCP: failed to initialize %q: %v\n", cfg.Name, err)
			client.Close()
			continue
		}

		toolDefs, err := client.ListTools()
		if err != nil {
			fmt.Fprintf(os.Stderr, "MCP: failed to list tools for %q: %v\n", cfg.Name, err)
			client.Close()
			continue
		}

		fmt.Fprintf(os.Stderr, "MCP: connected to %q (%d tools)\n", cfg.Name, len(toolDefs))

		mgr.Servers = append(mgr.Servers, &MCPServer{
			Name:   cfg.Name,
			Client: client,
			Tools:  toolDefs,
		})
	}

	return mgr
}

// Register registers the MCP tools with the agent's tools registry.
func (m *MCPManager) Register(reg *tools.Tools) {
	for _, s := range m.Servers {
		for _, td := range s.Tools {
			reg.Register(&tools.MCPTool{
				QualifiedName:   qualifyToolName(s.Name, td.Name),
				RemoteName:      td.Name,
				DescriptionText: td.Description,
				InputSchema:     td.InputSchema,
				Client:          s.Client,
			})
		}
	}
}

// AllTools returns every tool from every connected server, paired with its
// server name. Implements tools.MCPRegistry.
func (m *MCPManager) AllTools() []tools.QualifiedTool {
	var out []tools.QualifiedTool
	for _, s := range m.Servers {
		for _, td := range s.Tools {
			out = append(out, tools.QualifiedTool{Server: s.Name, Tool: td})
		}
	}
	return out
}

// CallTool dispatches a call to the named server's MCP client.
// Implements tools.MCPRegistry.
func (m *MCPManager) CallTool(serverName, toolName string, args map[string]any) (*mcp.CallResult, error) {
	for _, s := range m.Servers {
		if s.Name == serverName {
			return s.Client.CallTool(toolName, args)
		}
	}
	return nil, fmt.Errorf("unknown MCP server %q", serverName)
}

func (m *MCPManager) Close() {
	for _, s := range m.Servers {
		s.Client.Close()
	}
}

var nonAlphaNum = regexp.MustCompile(`[^a-zA-Z0-9_]`)

func qualifyToolName(serverName, toolName string) string {
	s := nonAlphaNum.ReplaceAllString(serverName, "_")
	t := nonAlphaNum.ReplaceAllString(toolName, "_")
	return s + "__" + t
}
