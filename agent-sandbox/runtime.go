package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
)

const (
	defaultSystemPrompt = "You are a helpful coding assistant. You have access to a few tools."
	systemPromptPath    = "AGENTS.md"
	runtimeConfigPath   = "agent.json"
)

type RuntimeConfig struct {
	Provider        string   `json:"provider"`
	Model           string   `json:"model"`
	BaseURL         string   `json:"base_url"`
	APIKey          string   `json:"api_key"`
	AllowedCommands []string `json:"allowed_commands"`
}

type Runtime struct {
	Provider        string
	SystemPrompt    string
	BaseURL         string
	APIKey          string
	Model           string
	AllowedCommands []string
}

type App struct {
	Runtime       *Runtime
	Messages      []ChatMessage
	reloadPending atomic.Bool
}

func NewApp() (*App, error) {
	runtime, err := LoadRuntime()
	if err != nil {
		return nil, err
	}

	return &App{
		Runtime: runtime,
		Messages: []ChatMessage{{
			Role:    "system",
			Content: runtime.SystemPrompt,
		}},
	}, nil
}

func LoadRuntime() (*Runtime, error) {
	systemPrompt := defaultSystemPrompt
	if data, err := os.ReadFile(systemPromptPath); err == nil {
		if strings.TrimSpace(string(data)) != "" {
			systemPrompt = string(data)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to read %s: %w", systemPromptPath, err)
	}

	var cfg RuntimeConfig
	if data, err := os.ReadFile(runtimeConfigPath); err == nil {
		if err := json.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("failed to parse %s: %w", runtimeConfigPath, err)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to read %s: %w", runtimeConfigPath, err)
	}

	provider := firstNonEmpty(cfg.Provider, os.Getenv("PROVIDER"), "groq")
	model := firstNonEmpty(cfg.Model, os.Getenv("MODEL"))
	baseURL := cfg.BaseURL
	apiKey := cfg.APIKey

	switch provider {
	case "ollama":
		if baseURL == "" {
			baseURL = "http://localhost:11434/v1"
		}
		if apiKey == "" {
			apiKey = "ollama"
		}
		if model == "" {
			model = "gpt-oss:20b"
		}
	default:
		if baseURL == "" {
			baseURL = "https://api.groq.com/openai/v1"
		}
		if apiKey == "" {
			apiKey = os.Getenv("GROQ_API_KEY")
		}
		if model == "" {
			model = "openai/gpt-oss-20b"
		}
	}

	allowedCommands := cloneStrings(cfg.AllowedCommands)
	if len(allowedCommands) == 0 {
		allowedCommands = cloneStrings(defaultAllowedCommands)
	}

	return &Runtime{
		Provider:        provider,
		SystemPrompt:    systemPrompt,
		BaseURL:         baseURL,
		APIKey:          apiKey,
		Model:           model,
		AllowedCommands: allowedCommands,
	}, nil
}

func (a *App) Reload() error {
	runtime, err := LoadRuntime()
	if err != nil {
		return err
	}

	a.Runtime = runtime
	if len(a.Messages) == 0 || a.Messages[0].Role != "system" {
		a.Messages = append([]ChatMessage{{
			Role:    "system",
			Content: runtime.SystemPrompt,
		}}, a.Messages...)
	} else {
		a.Messages[0].Content = runtime.SystemPrompt
	}

	return nil
}

func (a *App) QueueReload() {
	a.reloadPending.Store(true)
}

func (a *App) ConsumeReloadPending() bool {
	return a.reloadPending.Swap(false)
}

func (r *Runtime) Summary() string {
	return fmt.Sprintf("provider=%s model=%s", r.Provider, r.Model)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func cloneStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, len(values))
	copy(out, values)
	return out
}
