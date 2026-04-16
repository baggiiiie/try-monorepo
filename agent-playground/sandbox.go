package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

const (
	containerImage = "ubuntu:22.04"
	workDir        = "/workspace"
)

// containerName returns a per-workspace container name to avoid collisions.
func containerName() string {
	h := sha256.Sum256([]byte(hostWorkDir()))
	return fmt.Sprintf("agent-playground-%x", h[:4])
}

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
	name := containerName()

	// Check if already running.
	out, err := exec.Command("docker", "inspect", "-f", "{{.State.Running}}", name).CombinedOutput()
	if err == nil && strings.TrimSpace(string(out)) == "true" {
		return nil
	}

	// Remove any stopped container with the same name.
	_ = exec.Command("docker", "rm", "-f", name).Run()

	cmd := exec.Command("docker", "run", "-d",
		"--name", name,
		"--user", fmt.Sprintf("%d:%d", os.Getuid(), os.Getgid()),
		"-w", workDir,
		"-v", hostWorkDir()+":"+workDir,
		"--network", "none",
		"--security-opt", "no-new-privileges",
		"--cap-drop", "ALL",
		"--read-only",
		"--tmpfs", "/tmp:rw,noexec,nosuid,size=256m",
		"--tmpfs", "/var:rw,noexec,nosuid,size=256m",
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

// destroyContainer forcefully removes the sandbox container.
func destroyContainer() {
	_ = exec.Command("docker", "rm", "-f", containerName()).Run()
}

// localExec runs a command directly on the host and returns combined output.
func localExec(command string, timeoutMs int) (string, error) {
	if timeoutMs <= 0 {
		timeoutMs = 30000
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	cmd := exec.CommandContext(ctx, "bash", "-c", command)
	cmd.Dir = hostWorkDir()
	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("command timed out after %dms", timeoutMs)
	}
	return string(output), err
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

	cmd := exec.CommandContext(ctx, "docker", "exec", containerName(), "bash", "-c", command)
	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("command timed out after %dms", timeoutMs)
	}
	return string(output), err
}
