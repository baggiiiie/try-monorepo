package tools

import (
	"fmt"
	"path/filepath"
	"strings"
)

// ValidatePath ensures the path is within the given workspace directory.
func ValidatePath(path, workspace string) (string, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("invalid path: %w", err)
	}
	ws, _ := filepath.Abs(workspace)
	if !strings.HasPrefix(absPath, ws+string(filepath.Separator)) && absPath != ws {
		return "", fmt.Errorf("access denied: path %s is outside workspace %s", absPath, ws)
	}
	return absPath, nil
}
