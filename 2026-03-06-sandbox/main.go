package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	networkMode := flag.String("network-mode", "none", "network mode: none or allowlist")
	networkAllow := flag.String("network-allow", "", "comma-separated allowed hosts for allowlist mode")
	auditLogPath := flag.String("audit-log", "", "path to JSONL audit log (optional)")
	flag.Parse()

	apiKey := os.Getenv("GROQ_API_KEY")
	if apiKey == "" {
		fmt.Println("error: GROQ_API_KEY environment variable not set")
		return
	}

	cfg, err := parseConfig(*networkMode, *networkAllow)
	if err != nil {
		fmt.Println("config error:", err)
		return
	}

	auditor, err := newAuditor(*auditLogPath)
	if err != nil {
		fmt.Println("audit logger error:", err)
		return
	}
	defer auditor.Close()

	workDir, err := os.MkdirTemp("", "agent-sandbox-*")
	if err != nil {
		fmt.Println("failed to create sandbox dir:", err)
		return
	}
	defer os.RemoveAll(workDir)

	_ = os.WriteFile(filepath.Join(workDir, "note.txt"), []byte("hello from sandbox\n"), 0o644)

	containerName, err := startSandboxContainer(workDir, cfg)
	if err != nil {
		fmt.Println("failed to start sandbox container:", err)
		return
	}
	defer cleanupSandboxContainer(containerName)

	fmt.Println("Mini Agent Sandbox (Go)")
	fmt.Println("Network mode:", cfg.NetworkMode)
	fmt.Println("Sandbox directory:", workDir)
	fmt.Println("Type a message to chat with the agent. Type 'exit' to quit.")

	history := initHistory()
	scanner := bufio.NewScanner(os.Stdin)

	for {
		fmt.Print("\nyou> ")
		if !scanner.Scan() {
			break
		}

		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if line == "exit" {
			fmt.Println("bye!")
			return
		}

		var reply string
		history, reply, err = handleTurn(apiKey, history, line, containerName, cfg, auditor, scanner)
		if err != nil {
			fmt.Println("error:", err)
			continue
		}

		fmt.Println("\nagent>", reply)
	}
}
