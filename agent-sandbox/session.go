package main

import (
	"encoding/json"
	"fmt"
	"os"
)

const sessionFilePath = ".session.json"

func saveSession(messages []ChatMessage) error {
	data, err := json.MarshalIndent(messages, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal session: %w", err)
	}
	if err := os.WriteFile(sessionFilePath, data, 0o644); err != nil {
		return fmt.Errorf("failed to write session file: %w", err)
	}
	return nil
}

func loadSession() ([]ChatMessage, error) {
	data, err := os.ReadFile(sessionFilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read session file: %w", err)
	}
	var messages []ChatMessage
	if err := json.Unmarshal(data, &messages); err != nil {
		return nil, fmt.Errorf("failed to parse session file: %w", err)
	}
	return messages, nil
}
