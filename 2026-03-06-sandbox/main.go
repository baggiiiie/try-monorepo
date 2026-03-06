package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
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

		res := runInSandbox(workDir, line, 3*time.Second)
		printResult(res)
	}
}

func runInSandbox(workDir, input string, timeout time.Duration) Result {
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

	cmd := exec.CommandContext(ctx, cmdName, parts[1:]...)
	cmd.Dir = workDir

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		res.Err = err
		return res
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		res.Err = err
		return res
	}

	if err := cmd.Start(); err != nil {
		res.Err = err
		return res
	}

	outBytes, _ := io.ReadAll(stdout)
	errBytes, _ := io.ReadAll(stderr)

	waitErr := cmd.Wait()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		res.Timeout = true
	}

	res.Stdout = string(outBytes)
	res.Stderr = string(errBytes)
	res.Err = waitErr
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
