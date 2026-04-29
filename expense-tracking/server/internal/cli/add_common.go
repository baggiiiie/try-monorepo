package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
)

// readJSONArg fetches JSON bytes from an inline string, an @path/to/file
// reference, or stdin when arg is "-".
func readJSONArg(arg string) ([]byte, error) {
	switch {
	case arg == "-":
		return io.ReadAll(os.Stdin)
	case strings.HasPrefix(arg, "@"):
		return os.ReadFile(arg[1:])
	default:
		return []byte(arg), nil
	}
}

// parseJSONInputs decodes a single JSON object or an array of objects into
// []T, rejecting unknown fields. A single object is returned as a one-element
// slice so callers can use a single processing path.
func parseJSONInputs[T any](raw []byte) ([]T, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return nil, fmt.Errorf("empty JSON input")
	}
	dec := json.NewDecoder(strings.NewReader(trimmed))
	dec.DisallowUnknownFields()
	if strings.HasPrefix(trimmed, "[") {
		var arr []T
		if err := dec.Decode(&arr); err != nil {
			return nil, err
		}
		return arr, nil
	}
	var single T
	if err := dec.Decode(&single); err != nil {
		return nil, err
	}
	return []T{single}, nil
}

func int64Ptr(v int64) *int64 { return &v }
