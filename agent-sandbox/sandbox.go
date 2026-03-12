package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

const (
	containerName  = "agent-sandbox"
	containerImage = "ubuntu:22.04"
	workDir        = "/workspace"
)

// hostWorkDir returns the host directory to mount into the container.
// Defaults to the current working directory.
func hostWorkDir() string {
	if dir := os.Getenv("SANDBOX_WORKDIR"); dir != "" {
		return dir
	}
	dir, _ := os.Getwd()
	return dir
}

// ensureContainer starts the sandbox container if it's not already running.
func ensureContainer() error {
	// Check if already running.
	out, err := exec.Command("docker", "inspect", "-f", "{{.State.Running}}", containerName).CombinedOutput()
	if err == nil && strings.TrimSpace(string(out)) == "true" {
		return nil
	}

	// Remove any stopped container with the same name.
	_ = exec.Command("docker", "rm", "-f", containerName).Run()

	cmd := exec.Command("docker", "run", "-d",
		"--name", containerName,
		"-w", workDir, // Mount host workspace into container.
		"-v", hostWorkDir()+":"+workDir, // Security: no network access.
		"--network", "none", // Security: no privilege escalation.
		"--security-opt", "no-new-privileges", // Security: drop all Linux capabilities.
		"--cap-drop", "ALL", // Security: read-only root filesystem (workspace volume is still writable).
		"--read-only",                                // Writable /tmp for programs that need scratch space.
		"--tmpfs", "/tmp:rw,noexec,nosuid,size=256m", // Writable /var for apt/dpkg if needed.
		"--tmpfs", "/var:rw,noexec,nosuid,size=256m", // Security: limit resources.
		"--memory", "512m",
		"--cpus", "1",
		"--pids-limit", "256",
		containerImage,
		"sleep", "infinity",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to start container: %s: %w", string(out), err)
	}

	return nil
}

// dockerExec runs a command inside the sandbox container and returns combined output.
func dockerExec(command string, timeoutMs int) (string, error) {
	if err := ensureContainer(); err != nil {
		return "", err
	}

	if timeoutMs <= 0 {
		timeoutMs = 30000
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	cmd := exec.CommandContext(ctx, "docker", "exec", containerName, "bash", "-c", command)
	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("command timed out after %dms", timeoutMs)
	}
	return string(output), err
}
