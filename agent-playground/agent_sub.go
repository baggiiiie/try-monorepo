package main

import "agent-sandbox/tools"

// SubAgent is a headless agent spawned to complete a focused task.
type SubAgent struct {
	registry *tools.Registry
}

func NewSubAgent(app *App) *SubAgent {
	reg := tools.NewRegistry()
	registerCoreTools(reg, app)

	return &SubAgent{
		registry: reg,
	}
}

func (a *SubAgent) SystemPrompt() string {
	return "You are a subagent. Complete the task and respond with a concise summary of what you did."
}
func (a *SubAgent) Tools() *tools.Registry { return a.registry }
func (a *SubAgent) Hooks() *EventHooks     { return &EventHooks{} }
func (a *SubAgent) MaxIterations() int     { return 10 }

func runSubagent(app *App, prompt string) (string, error) {
	agent := NewSubAgent(app)
	messages := []ChatMessage{
		{Role: "system", Content: agent.SystemPrompt()},
		{Role: "user", Content: prompt},
	}

	if err := runLoop(app.Runtime, agent, &messages); err != nil {
		return "", err
	}

	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "assistant" && messages[i].Content != "" {
			return messages[i].Content, nil
		}
	}
	return "Subagent completed but produced no response.", nil
}
