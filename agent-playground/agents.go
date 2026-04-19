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

func runSubagent(app *App, systemPrompt, taskPrompt string) (string, error) {
	agent := NewSubAgent(app, systemPrompt)
	messages := []ChatMessage{
		{Role: "system", Content: agent.Prompt},
		{Role: "user", Content: taskPrompt},
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
			return runSubagent(app, "", prompt)
		},
	})

	return &Agent{
		Prompt:        "", // managed by App.Messages[0]
		Tools:         reg,
		Hooks:         DefaultHooks(),
		MaxIterations: 20,
	}
}

func NewSubAgent(app *App, systemPrompt string) *Agent {
	if systemPrompt == "" {
		systemPrompt = "You are a subagent. Complete the task and respond with a concise summary of what you did."
	}

	reg := tools.NewRegistry()
	registerCoreTools(reg, app)

	return &Agent{
		Prompt:        systemPrompt,
		Tools:         reg,
		Hooks:         &EventHooks{},
		MaxIterations: 10,
	}
}
