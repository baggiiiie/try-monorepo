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
		userInput := strings.TrimSpace(scanner.Text())
		if userInput == "" {
			continue
		}

		if handled := handleCommand(app, userInput); handled {
			// command handled by app, go to next iteration
			// e.g., user types `/reload`
			continue
		}

		app.Messages = append(app.Messages, ChatMessage{
			Role:    "user",
			Content: userInput,
		})

		if err := respondToUser(app); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		}

		if err := saveSession(app.Messages); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to save session: %v\n", err)
		}
	}
}

// handleCommand processes slash commands. Returns true if the input was a command.
func handleCommand(app *App, line string) bool {
	switch line {
	case "/reload":
		if err := app.Reload(); err != nil {
			fmt.Fprintf(os.Stderr, "Reload failed: %v\n", err)
		} else {
			fmt.Printf("Reloaded runtime (%s).\n", app.Runtime.Summary())
		}
		return true

	case "/resume":
		msgs, err := loadSession()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Resume failed: %v\n", err)
		} else {
			app.Messages = msgs
			if len(app.Messages) > 0 && app.Messages[0].Role == "system" {
				app.Messages[0].Content = app.Runtime.SystemPrompt
			}
			fmt.Printf("Session restored (%d messages). You may continue the conversation.\n", len(app.Messages))
		}
		return true
	}

	return false
}

// respondToUser runs compaction, applies pending reloads, and executes the agent loop.
func respondToUser(app *App) error {
	if compacted, err := compactIfNeeded(app); err != nil {
		fmt.Fprintf(os.Stderr, "\n[compaction failed: %v]\n", err)
	} else if compacted {
		fmt.Printf("\n[compacted context: %d messages, ~%d tokens]\n", len(app.Messages), estimateTokens(app.Messages))
	}

	if app.ConsumeReloadPending() {
		if err := app.Reload(); err != nil {
			return fmt.Errorf("failed to apply queued reload: %w", err)
		}
		fmt.Printf("\n[reloaded runtime: %s]\n", app.Runtime.Summary())
	}

	return runAgentTurn(app.Runtime, NewMainAgent(app), &app.Messages)
}
