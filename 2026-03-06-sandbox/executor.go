package main

import (
	"context"
	"fmt"
	"math/rand"
	"os/exec"
	"strings"
	"time"
)

type Result struct {
	Output  string
	Err     error
	Timeout bool
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

func runInSandbox(containerName string, parts []string, timeout time.Duration) Result {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	args := []string{"exec", containerName}
	args = append(args, parts...)

	cmd := exec.CommandContext(ctx, "docker", args...)
	out, err := cmd.CombinedOutput()

	return Result{
		Output:  string(out),
		Err:     err,
		Timeout: ctx.Err() == context.DeadlineExceeded,
	}
}
