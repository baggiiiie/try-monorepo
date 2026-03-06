package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type Result struct {
	Command string
	Stdout  string
	Stderr  string
	Err     error
	Timeout bool
}

func main() {
	fmt.Println("Mini Agent Sandbox (Go)")
	fmt.Println("Type commands. Type 'exit' to quit.")
	fmt.Println("Allowed commands: echo, ls, pwd, cat")

	workDir, err := os.MkdirTemp("", "agent-sandbox-*")
	if err != nil {
		fmt.Println("failed to create sandbox dir:", err)
		return
	}
	defer os.RemoveAll(workDir)

	_ = os.WriteFile(filepath.Join(workDir, "note.txt"), []byte("hello from sandbox\n"), 0o644)

	fmt.Println("Sandbox directory:", workDir)

	containerName, err := startSandboxContainer(workDir)
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

		res := runInSandbox(containerName, line, 3*time.Second)
		printResult(res)
	}
}

func startSandboxContainer(workDir string) (string, error) {
	containerName := fmt.Sprintf("agent-sandbox-%d-%d", time.Now().Unix(), rand.Intn(100000))

	args := []string{
		"run", "-d",
		"--name", containerName,
		"--network", "none",
		"--memory", "128m",
		"--cpus", "0.5",
		"--pids-limit", "64",
		"--read-only",
		"--cap-drop", "ALL",
		"--security-opt", "no-new-privileges",
		"--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
		"-v", workDir + ":/workspace:rw",
		"-w", "/workspace",
		"alpine:3.20",
		"sh", "-lc", "while true; do sleep 3600; done",
	}

	cmd := exec.Command("docker", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return containerName, nil
}

func cleanupSandboxContainer(containerName string) {
	_ = exec.Command("docker", "rm", "-f", containerName).Run()
}

func runInSandbox(containerName, input string, timeout time.Duration) Result {
	res := Result{Command: input}

	parts := strings.Fields(input)
	if len(parts) == 0 {
		return res
	}

	allowed := map[string]bool{
		"echo": true,
		"ls":   true,
		"pwd":  true,
		"cat":  true,
	}

	cmdName := parts[0]
	if !allowed[cmdName] {
		res.Err = fmt.Errorf("command not allowed: %s", cmdName)
		return res
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	args := []string{"exec", containerName, "sh", "-lc", input}

	cmd := exec.CommandContext(ctx, "docker", args...)
	out, err := cmd.CombinedOutput()

	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		res.Timeout = true
	}

	res.Stdout = string(out)
	res.Err = err
	return res
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
