package tools

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ValidatePath ensures the path is within the given workspace directory,
// resolving symlinks to prevent traversal attacks.
func ValidatePath(path, workspace string) (string, error) {
	ws, err := filepath.Abs(workspace)
	if err != nil {
		return "", fmt.Errorf("invalid workspace: %w", err)
	}

	// Resolve relative paths against workspace, not process cwd.
	if !filepath.IsAbs(path) {
		path = filepath.Join(ws, path)
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("invalid path: %w", err)
	}

	// Resolve symlinks on the parent directory (the file itself may not exist yet).
	dir := filepath.Dir(absPath)
	realDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		if os.IsNotExist(err) {
			// Parent doesn't exist; fall back to string check on the unresolved path.
			if !strings.HasPrefix(absPath, ws+string(filepath.Separator)) && absPath != ws {
				return "", fmt.Errorf("access denied: path %s is outside workspace %s", absPath, ws)
			}
			return absPath, nil
		}
		return "", fmt.Errorf("failed to resolve path: %w", err)
	}

	realPath := filepath.Join(realDir, filepath.Base(absPath))
	realWs, err := filepath.EvalSymlinks(ws)
	if err != nil {
		return "", fmt.Errorf("failed to resolve workspace: %w", err)
	}

	if !strings.HasPrefix(realPath, realWs+string(filepath.Separator)) && realPath != realWs {
		return "", fmt.Errorf("access denied: path %s resolves outside workspace %s", path, ws)
	}

	return absPath, nil
}
