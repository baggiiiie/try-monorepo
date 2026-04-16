package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync/atomic"

	"agent-playground/tools"
)

const (
	defaultSystemPrompt = "You are a helpful coding assistant. You have access to a few tools."
	systemPromptPath    = "AGENTS_PLAYGROUND.md"
	runtimeConfigPath   = "agent.json"
)

type RuntimeConfig struct {
	Provider         string   `json:"provider"`
	Model            string   `json:"model"`
	BaseURL          string   `json:"base_url"`
	APIKey           string   `json:"api_key"`
	AllowedCommands  []string `json:"allowed_commands"`
	MaxContextTokens int      `json:"max_context_tokens"`
	Sandbox          *bool    `json:"sandbox"`
}

type Runtime struct {
	Provider         string
	SystemPrompt     string
	BaseURL          string
	APIKey           string
	Model            string
	AllowedCommands  []string
	MaxContextTokens int
	Sandbox          bool
}

type App struct {
	Runtime       *Runtime
	Messages      []ChatMessage
	Todo          *tools.TodoTool
	reloadPending atomic.Bool
}

const todoFilePath = ".todo.json"

func NewApp() (*App, error) {
	runtime, err := LoadRuntime()
	if err != nil {
		return nil, err
	}

	todo := &tools.TodoTool{}
	todo.SetSavePath(todoFilePath)
	if err := todo.Load(); err != nil {
		return nil, fmt.Errorf("failed to load todos: %w", err)
	}

	return &App{
		Runtime: runtime,
		Todo:    todo,
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
		allowedCommands = cloneStrings(tools.DefaultAllowedCommands)
	}

	maxContextTokens := cfg.MaxContextTokens
	if maxContextTokens <= 0 {
		maxContextTokens = 8192
	}

	sandbox := true
	if cfg.Sandbox != nil {
		sandbox = *cfg.Sandbox
	}

	return &Runtime{
		Provider:         provider,
		SystemPrompt:     systemPrompt,
		BaseURL:          baseURL,
		APIKey:           apiKey,
		Model:            model,
		AllowedCommands:  allowedCommands,
		MaxContextTokens: maxContextTokens,
		Sandbox:          sandbox,
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
	return fmt.Sprintf("provider=%s model=%s sandbox=%v", r.Provider, r.Model, r.Sandbox)
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
