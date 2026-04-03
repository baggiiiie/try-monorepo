package tools

import (
	"fmt"
	"os"
	"strings"
)

type EditFileTool struct {
	Workspace string
}

func (t *EditFileTool) Name() string { return "edit_file" }
func (t *EditFileTool) Description() string {
	return "Edit a file by replacing old_str with new_str. The old_str must appear exactly once in the file."
}

func (t *EditFileTool) Schema() map[string]any {
	return BuildSchema([]Param{
		{Name: "path", Type: "string", Description: "The path of the file to edit", Required: true},
		{Name: "old_str", Type: "string", Description: "The string to search for in the file", Required: true},
		{Name: "new_str", Type: "string", Description: "The string to replace old_str with", Required: true},
	})
}

func (t *EditFileTool) Execute(args map[string]any) string {
	path, _ := args["path"].(string)
	oldStr, _ := args["old_str"].(string)
	newStr, _ := args["new_str"].(string)

	safe, err := ValidatePath(path, t.Workspace)
	if err != nil {
		return fmt.Sprintf("Error: %v", err)
	}
	data, err := os.ReadFile(safe)
	if err != nil {
		return fmt.Sprintf("Error reading file: %v", err)
	}
	content := string(data)
	count := strings.Count(content, oldStr)
	if count == 0 {
		return "Error: old_str not found in file"
	}
	if count > 1 {
		return fmt.Sprintf("Error: old_str found %d times in file, expected exactly 1", count)
	}
	newContent := strings.Replace(content, oldStr, newStr, 1)
	if err := os.WriteFile(safe, []byte(newContent), 0o644); err != nil {
		return fmt.Sprintf("Error writing file: %v", err)
	}
	return "File edited successfully"
}
