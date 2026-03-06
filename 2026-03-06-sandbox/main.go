package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"math/rand"
	"net/url"
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

type Config struct {
	NetworkMode  string
	AllowedHosts map[string]bool
}

func main() {
	networkMode := flag.String("network-mode", "none", "network mode: none or allowlist")
	networkAllow := flag.String("network-allow", "", "comma-separated allowed hosts for allowlist mode")
	flag.Parse()

	cfg, err := parseConfig(*networkMode, *networkAllow)
	if err != nil {
		fmt.Println("config error:", err)
		return
	}

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

		ok, reason := needsApproval(line)
		if ok {
			if !askForApproval(scanner, reason) {
				fmt.Println("skipped.")
				continue
			}
		}

		res := runInSandbox(containerName, line, 3*time.Second, cfg)
		printResult(res)
	}
}

func parseConfig(mode, allowCSV string) (Config, error) {
	cfg := Config{
		NetworkMode:  mode,
		AllowedHosts: map[string]bool{},
	}

	if cfg.NetworkMode != "none" && cfg.NetworkMode != "allowlist" {
		return cfg, fmt.Errorf("invalid network mode %q (use none or allowlist)", cfg.NetworkMode)
	}

	for host := range strings.SplitSeq(allowCSV, ",") {
		h := strings.TrimSpace(strings.ToLower(host))
		if h != "" {
			cfg.AllowedHosts[h] = true
		}
	}
	return cfg, nil
}

func startSandboxContainer(workDir string, cfg Config) (string, error) {
	containerName := fmt.Sprintf("agent-sandbox-%d-%d", time.Now().Unix(), rand.Intn(100000))
	networkValue := "bridge"
	bootCmd := "while true; do sleep 3600; done"
	image := "alpine:3.20"
	if cfg.NetworkMode == "none" {
		networkValue = "none"
	} else {
		image = "curlimages/curl:8.12.1"
	}

	args := []string{
		"run", "-d",
		"--name", containerName,
		"--network", networkValue,
		"--memory", "128m",
		"--cpus", "0.5",
		"--pids-limit", "64",
		"--read-only",
		"--cap-drop", "ALL",
		"--security-opt", "no-new-privileges",
		"--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
		"-v", workDir + ":/workspace:rw",
		"-w", "/workspace",
		image,
		"sh", "-lc", bootCmd,
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

func runInSandbox(containerName, input string, timeout time.Duration, cfg Config) Result {
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
		"curl": true,
	}

	cmdName := parts[0]
	if !allowed[cmdName] {
		res.Err = fmt.Errorf("command not allowed: %s", cmdName)
		return res
	}

	if err := validatePaths(parts); err != nil {
		res.Err = err
		return res
	}

	if err := validateNetwork(parts, cfg); err != nil {
		res.Err = err
		return res
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	args := []string{"exec", containerName, cmdName}
	args = append(args, parts[1:]...)

	cmd := exec.CommandContext(ctx, "docker", args...)
	out, err := cmd.CombinedOutput()

	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		res.Timeout = true
	}

	res.Stdout = string(out)
	res.Err = err
	return res
}

func validatePaths(parts []string) error {
	if len(parts) == 0 {
		return nil
	}
	cmdName := parts[0]
	if cmdName != "ls" && cmdName != "cat" {
		return nil
	}

	for _, arg := range parts[1:] {
		if arg == "" || strings.HasPrefix(arg, "-") {
			continue
		}
		if !isPathWithinWorkspace(arg) {
			return fmt.Errorf("path not allowed: %s (only /workspace)", arg)
		}
	}
	return nil
}

func isPathWithinWorkspace(arg string) bool {
	base := "/workspace"
	var full string
	if filepath.IsAbs(arg) {
		full = filepath.Clean(arg)
	} else {
		full = filepath.Clean(filepath.Join(base, arg))
	}
	return full == base || strings.HasPrefix(full, base+"/")
}

func validateNetwork(parts []string, cfg Config) error {
	if len(parts) == 0 || parts[0] != "curl" {
		return nil
	}
	if cfg.NetworkMode == "none" {
		return fmt.Errorf("network mode is none: curl is blocked")
	}

	hosts, err := extractCurlHosts(parts[1:])
	if err != nil {
		return err
	}
	for _, h := range hosts {
		host := strings.ToLower(h)
		if !cfg.AllowedHosts[host] {
			return fmt.Errorf("host not allowed in allowlist mode: %s", host)
		}
	}
	return nil
}

func extractCurlHosts(args []string) ([]string, error) {
	var hosts []string
	for _, a := range args {
		if a == "" || strings.HasPrefix(a, "-") {
			continue
		}
		raw := a
		if !strings.Contains(raw, "://") {
			raw = "http://" + raw
		}
		u, err := url.Parse(raw)
		if err != nil || u.Hostname() == "" {
			continue
		}
		hosts = append(hosts, u.Hostname())
	}
	if len(hosts) == 0 {
		return nil, fmt.Errorf("curl command must include a URL host")
	}
	return hosts, nil
}

func needsApproval(input string) (bool, string) {
	if strings.ContainsAny(input, ";|&<>`") || strings.Contains(input, "$(") {
		return true, "contains shell metacharacters"
	}
	parts := strings.Fields(input)
	if len(parts) > 0 && parts[0] == "curl" {
		return true, "network command"
	}
	return false, ""
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
