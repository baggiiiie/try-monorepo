package main

import (
	"agent-sandbox/tools"
	"fmt"
	"os"
)

// MainAgent is the interactive top-level agent with full tool access.
type MainAgent struct {
	registry *tools.Registry
	hooks    *EventHooks
}

func NewMainAgent(app *App) *MainAgent {
	reg := tools.NewRegistry()
	registerCoreTools(reg, app)

	reg.Register(&tools.ReloadRuntimeTool{
		OnReload: app.QueueReload,
	})
	reg.Register(&tools.SubagentTool{
		Run: func(prompt string) (string, error) {
			return runSubagent(app, prompt)
		},
	})

	return &MainAgent{
		registry: reg,
		hooks:    DefaultHooks(),
	}
}

func (a *MainAgent) SystemPrompt() string  { return "" } // managed by App.Messages[0]
func (a *MainAgent) Tools() *tools.Registry { return a.registry }
func (a *MainAgent) Hooks() *EventHooks     { return a.hooks }
func (a *MainAgent) MaxIterations() int     { return 20 }

func handleTurn(app *App) error {
	if compacted, err := compactIfNeeded(app); err != nil {
		fmt.Fprintf(os.Stderr, "\n[compaction failed: %v]\n", err)
	} else if compacted {
		fmt.Printf("\n[compacted context: %d messages, ~%d tokens]\n", len(app.Messages), estimateTokens(app.Messages))
	}

	if app.ConsumeReloadPending() {
		if err := app.Reload(); err != nil {
			return fmt.Errorf("failed to apply queued reload: %w", err)
		}
		fmt.Printf("\n[reloaded runtime: %s]\n", app.Runtime.Summary())
	}

	return runLoop(app.Runtime, NewMainAgent(app), &app.Messages)
}
