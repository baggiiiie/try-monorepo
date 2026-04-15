package tools

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type GlobTool struct {
	Workspace string
}

func (t *GlobTool) Name() string { return "glob" }
func (t *GlobTool) Description() string {
	return "Find files matching a glob pattern within the workspace. Returns matching file paths, one per line."
}

func (t *GlobTool) Schema() map[string]any {
	return BuildSchema([]Param{
		{Name: "pattern", Type: "string", Description: "Glob pattern to match files (e.g. \"**/*.go\", \"src/**/*.ts\", \"*.json\")", Required: true},
	})
}

func (t *GlobTool) Execute(args map[string]any) string {
	pattern, _ := args["pattern"].(string)
	if pattern == "" {
		return "Error: pattern is required"
	}

	ws, _ := filepath.Abs(t.Workspace)

	// If pattern is not absolute, root it to the workspace.
	if !filepath.IsAbs(pattern) {
		pattern = filepath.Join(ws, pattern)
	} else {
		// Validate that an absolute pattern stays inside the workspace.
		if !strings.HasPrefix(pattern, ws+string(filepath.Separator)) && pattern != ws {
			return fmt.Sprintf("Error: access denied: pattern %s is outside workspace %s", pattern, ws)
		}
	}

	var matches []string
	if strings.Contains(pattern, "**") {
		// Split on the first "**" to get a directory prefix and a file suffix.
		// e.g. "/workspace/src/**/*.go" → prefix="/workspace/src", suffix="*.go"
		parts := strings.SplitN(pattern, "**", 2)
		prefix := filepath.Clean(parts[0])
		suffix := strings.TrimLeft(parts[1], string(filepath.Separator))

		err := filepath.WalkDir(prefix, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				return nil
			}
			if suffix == "" {
				rel, _ := filepath.Rel(ws, path)
				matches = append(matches, rel)
				return nil
			}
			matched, matchErr := filepath.Match(suffix, d.Name())
			if matchErr != nil {
				return matchErr
			}
			if matched {
				rel, _ := filepath.Rel(ws, path)
				matches = append(matches, rel)
			}
			return nil
		})
		if err != nil {
			return fmt.Sprintf("Error: %v", err)
		}
	} else {
		globMatches, err := filepath.Glob(pattern)
		if err != nil {
			return fmt.Sprintf("Error: %v", err)
		}
		for _, m := range globMatches {
			rel, _ := filepath.Rel(ws, m)
			matches = append(matches, rel)
		}
	}

	if len(matches) == 0 {
		return "No files matched the pattern."
	}
	return strings.Join(matches, "\n")
}
