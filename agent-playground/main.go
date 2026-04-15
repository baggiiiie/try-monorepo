package main

import (
	"bufio"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
)

func main() {
	app, err := NewApp()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load runtime: %v\n", err)
		os.Exit(1)
	}

	stopWatcher := startRuntimeWatcher(app)
	defer stopWatcher()

	// Clean up the sandbox container on exit.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		stopWatcher()
		destroyContainer()
		os.Exit(0)
	}()
	defer destroyContainer()

	fmt.Printf("Agent ready (%s). Type your message (Ctrl+C to quit, /reload to reload runtime, /resume to restore last session).\n", app.Runtime.Summary())

	scanner := bufio.NewScanner(os.Stdin)
	for {
		fmt.Printf("\nYou> ")
		if !scanner.Scan() {
			break
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		if line == "/reload" {
			if err := app.Reload(); err != nil {
				fmt.Fprintf(os.Stderr, "Reload failed: %v\n", err)
			} else {
				fmt.Printf("Reloaded runtime (%s).\n", app.Runtime.Summary())
			}
			continue
		}

		if line == "/resume" {
			msgs, err := loadSession()
			if err != nil {
				fmt.Fprintf(os.Stderr, "Resume failed: %v\n", err)
			} else {
				app.Messages = msgs
				// Update system prompt to current runtime.
				if len(app.Messages) > 0 && app.Messages[0].Role == "system" {
					app.Messages[0].Content = app.Runtime.SystemPrompt
				}
				fmt.Printf("Session restored (%d messages). You may continue the conversation.\n", len(app.Messages))
			}
			continue
		}

		app.Messages = append(app.Messages, ChatMessage{
			Role:    "user",
			Content: line,
		})

		if err := handleTurn(app); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		}

		if err := saveSession(app.Messages); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to save session: %v\n", err)
		}
	}
}
