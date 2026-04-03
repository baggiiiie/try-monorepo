package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"agent-sandbox/tools"
)

// buildToolRegistry creates and populates the tool registry with all tools,
// wired to the app's sandbox and policy configuration.
func buildToolRegistry(app *App) *tools.Registry {
	workspace := hostWorkDir()

	reg := tools.NewRegistry()

	reg.Register(&tools.ReadFileTool{Workspace: workspace})
	reg.Register(&tools.WriteFileTool{Workspace: workspace})
	reg.Register(&tools.EditFileTool{Workspace: workspace})
	reg.Register(&tools.GlobTool{Workspace: workspace})

	allowedCommands := tools.DefaultAllowedCommands
	if app.Runtime != nil && len(app.Runtime.AllowedCommands) > 0 {
		allowedCommands = app.Runtime.AllowedCommands
	}

	descSuffix := ""
	if len(allowedCommands) > 0 {
		descSuffix = "These command prefixes run without approval: " + strings.Join(allowedCommands, ", ") + "."
	}

	reg.Register(&tools.BashTool{
		Executor: dockerExec,
		Policy: func(command string) bool {
			if tools.IsCommandAllowed(command, allowedCommands) {
				return true
			}
			return askApproval(command)
		},
		DescriptionSuffix: descSuffix,
	})

	reg.Register(&tools.TodoTool{})

	reg.Register(&tools.ReloadRuntimeTool{
		OnReload: app.QueueReload,
	})

	return reg
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
