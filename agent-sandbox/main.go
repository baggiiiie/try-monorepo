package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	fmt.Println("Agent ready. Type your message (Ctrl+C to quit).")

	messages := []ChatMessage{
		{
			Role:    "system",
			Content: "You are a helpful coding assistant. You have access to a few tools.",
		},
	}

	scanner := bufio.NewScanner(os.Stdin)
	for {
		fmt.Printf("\nYou> ")
		if !scanner.Scan() {
			break
		}
		line := scanner.Text()
		if line == "" {
			continue
		}

		messages = append(messages, ChatMessage{
			Role:    "user",
			Content: line,
		})

		if err := handleTurn(&messages); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		}
	}
}
