package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	networkMode := flag.String("network-mode", "none", "network mode: none or allowlist")
	networkAllow := flag.String("network-allow", "", "comma-separated allowed hosts for allowlist mode")
	auditLogPath := flag.String("audit-log", "", "path to JSONL audit log (optional)")
	flag.Parse()

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

	fmt.Println("Mini Agent Sandbox (Go)")
	fmt.Println("Type commands. Type 'exit' to quit.")
	fmt.Println("Allowed commands: echo, ls, pwd, cat, curl")
	fmt.Println("Network mode:", cfg.NetworkMode)

	workDir, err := os.MkdirTemp("", "agent-sandbox-*")
	if err != nil {
		fmt.Println("failed to create sandbox dir:", err)
		return
	}
	defer os.RemoveAll(workDir)

	_ = os.WriteFile(filepath.Join(workDir, "note.txt"), []byte("hello from sandbox\n"), 0o644)

	fmt.Println("Sandbox directory:", workDir)

	containerName, err := startSandboxContainer(workDir, cfg)
	if err != nil {
		fmt.Println("failed to start sandbox container:", err)
		return
	}
	defer cleanupSandboxContainer(containerName)
	fmt.Println("Sandbox container:", containerName)

	scanner := bufio.NewScanner(os.Stdin)
	for {
		fmt.Print("\nagent> ")
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

		decision := evaluatePolicy(line, cfg)
		if !decision.Allowed {
			res := Result{
				Command:       line,
				Err:           errors.New(decision.BlockReason),
				PolicyBlocked: true,
				PolicyReason:  decision.BlockReason,
			}
			auditor.LogEvent(line, DecisionBlocked, decision.BlockReason, time.Time{}, nil)
			printResult(res)
			continue
		}

		if decision.RequiresApproval {
			if !askForApproval(scanner, decision.ApprovalReason) {
				fmt.Println("skipped.")
				auditor.LogEvent(line, DecisionDenied, "approval_rejected: "+decision.ApprovalReason, time.Time{}, nil)
				continue
			}
		}

		start := time.Now()
		res := runInSandbox(containerName, line, decision.Parts, 3*time.Second)
		auditor.LogEvent(line, DecisionExecuted, "", start, &res)
		printResult(res)
	}
}

func askForApproval(scanner *bufio.Scanner, reason string) bool {
	fmt.Printf("Approval required (%s). Run anyway? [y/N]: ", reason)
	if !scanner.Scan() {
		return false
	}
	answer := strings.TrimSpace(strings.ToLower(scanner.Text()))
	return answer == "y" || answer == "yes"
}

func printResult(r Result) {
	fmt.Println("----- result -----")
	fmt.Println("command:", r.Command)
	if r.Timeout {
		fmt.Println("status: TIMEOUT")
	}
	if r.Stdout != "" {
		fmt.Println("stdout:")
		fmt.Print(r.Stdout)
	}
	if r.Stderr != "" {
		fmt.Println("stderr:")
		fmt.Print(r.Stderr)
	}
	if r.Err != nil {
		fmt.Println("error:", r.Err)
	} else {
		fmt.Println("status: OK")
	}
}
