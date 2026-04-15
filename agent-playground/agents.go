package main

import (
	"agent-playground/tools"
)

// Agent holds the configuration that varies between agent types:
// prompt, tools, hooks, iteration limit.
type Agent struct {
	Prompt        string
	Tools         *tools.Tools
	Hooks         *EventHooks
	MaxIterations int
}

func runSubagent(app *App, prompt string) (string, error) {
	agent := NewSubAgent(app)
	messages := []ChatMessage{
		{Role: "system", Content: agent.Prompt},
		{Role: "user", Content: prompt},
	}

	if err := runAgentTurn(app.Runtime, agent, &messages); err != nil {
		return "", err
	}

	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "assistant" && messages[i].Content != "" {
			return messages[i].Content, nil
		}
	}
	return "Subagent completed but produced no response.", nil
}

func NewMainAgent(app *App) *Agent {
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

	return &Agent{
		Prompt:        "", // managed by App.Messages[0]
		Tools:         reg,
		Hooks:         DefaultHooks(),
		MaxIterations: 20,
	}
}

func NewSubAgent(app *App) *Agent {
	reg := tools.NewRegistry()
	registerCoreTools(reg, app)

	return &Agent{
		Prompt:        "You are a subagent. Complete the task and respond with a concise summary of what you did.",
		Tools:         reg,
		Hooks:         &EventHooks{},
		MaxIterations: 10,
	}
}
