package tools

import (
	"fmt"
	"os"
)

type WriteFileTool struct {
	Workspace string
}

func (t *WriteFileTool) Name() string        { return "write_file" }
func (t *WriteFileTool) Description() string { return "Write content to a file at the given path." }

func (t *WriteFileTool) Schema() map[string]any {
	return BuildSchema([]Param{
		{Name: "path", Type: "string", Description: "The path of the file to write", Required: true},
		{Name: "content", Type: "string", Description: "The content to write to the file", Required: true},
	})
}

func (t *WriteFileTool) Execute(args map[string]any) string {
	path, _ := args["path"].(string)
	content, _ := args["content"].(string)
	safe, err := ValidatePath(path, t.Workspace)
	if err != nil {
		return fmt.Sprintf("Error: %v", err)
	}
	if err := os.WriteFile(safe, []byte(content), 0o644); err != nil {
		return fmt.Sprintf("Error writing file: %v", err)
	}
	return fmt.Sprintf("File written to %s", safe)
}
