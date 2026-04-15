package tools

// ReloadCallback is called when the reload tool is executed.
type ReloadCallback func()

type ReloadRuntimeTool struct {
	OnReload ReloadCallback
}

func (t *ReloadRuntimeTool) Name() string { return "reload_runtime" }
func (t *ReloadRuntimeTool) Description() string {
	return "Reload the runtime after the current turn. This re-reads AGENTS.md and agent.json and refreshes tool settings."
}

func (t *ReloadRuntimeTool) Schema() map[string]any {
	return BuildSchema(nil)
}

func (t *ReloadRuntimeTool) Execute(args map[string]any) string {
	if t.OnReload == nil {
		return "Error: app runtime is unavailable"
	}
	t.OnReload()
	return "Queued runtime reload after the current turn."
}
