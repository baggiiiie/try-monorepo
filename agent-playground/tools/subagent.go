package tools

type SubagentTool struct {
	Run func(prompt string) (string, error)
}

func (t *SubagentTool) Name() string { return "subagent" }
func (t *SubagentTool) Description() string {
	return "Spawn a subagent to perform a task independently. The subagent has its own context and tools. Returns a summary of the work done."
}

func (t *SubagentTool) Schema() map[string]any {
	return BuildSchema([]Param{
		{Name: "prompt", Type: "string", Description: "The task for the subagent to complete", Required: true},
	})
}

func (t *SubagentTool) Execute(args map[string]any) string {
	prompt, _ := args["prompt"].(string)
	if prompt == "" {
		return "error: prompt is required"
	}
	result, err := t.Run(prompt)
	if err != nil {
		return "error: " + err.Error()
	}
	return result
}
