package tools

import (
	"fmt"
	"os"
)

type ReadFileTool struct {
	Workspace string
}

func (t *ReadFileTool) Name() string        { return "read_file" }
func (t *ReadFileTool) Description() string { return "Read the contents of a file at the given path." }

func (t *ReadFileTool) Schema() map[string]any {
	return BuildSchema([]Param{
		{Name: "path", Type: "string", Description: "The path of the file to read", Required: true},
	})
}

func (t *ReadFileTool) Execute(args map[string]any) string {
	path, _ := args["path"].(string)
	safe, err := ValidatePath(path, t.Workspace)
	if err != nil {
		return fmt.Sprintf("Error: %v", err)
	}
	data, err := os.ReadFile(safe)
	if err != nil {
		return fmt.Sprintf("Error reading file: %v", err)
	}
	return string(data)
}
