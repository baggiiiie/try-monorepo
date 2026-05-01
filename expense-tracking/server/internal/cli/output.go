package cli

import (
	"encoding/json"
	"os"
)

func writeJson(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
