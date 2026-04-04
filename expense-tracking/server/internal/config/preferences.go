package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Preferences struct {
	Currency   string `json:"currency"`
	Timezone   string `json:"timezone"`
	DateFormat string `json:"date_format"`
}

func DefaultPreferences() Preferences {
	return Preferences{
		Currency:   "SGD",
		Timezone:   "Asia/Singapore",
		DateFormat: "2006-01-02",
	}
}

func LoadPreferences(path string) (Preferences, error) {
	p := DefaultPreferences()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return p, SavePreferences(path, p)
		}
		return p, err
	}
	if err := json.Unmarshal(data, &p); err != nil {
		return DefaultPreferences(), err
	}
	return p, nil
}

func SavePreferences(path string, p Preferences) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
