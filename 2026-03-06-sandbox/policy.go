package main

import (
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
)

type Config struct {
	NetworkMode  string
	AllowedHosts map[string]bool
}

type PolicyDecision struct {
	Allowed          bool
	BlockReason      string
	RequiresApproval bool
	ApprovalReason   string
	Parts            []string
}

var allowedCommands = map[string]bool{
	"echo": true,
	"ls":   true,
	"pwd":  true,
	"cat":  true,
	"curl": true,
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

func evaluatePolicy(input string, cfg Config) PolicyDecision {
	parts := strings.Fields(input)
	if len(parts) == 0 {
		return PolicyDecision{BlockReason: "empty command"}
	}

	cmdName := parts[0]

	if !allowedCommands[cmdName] {
		return PolicyDecision{BlockReason: fmt.Sprintf("command not allowed: %s", cmdName)}
	}

	if strings.ContainsAny(input, ";|&<>`") || strings.Contains(input, "$(") {
		return PolicyDecision{BlockReason: "shell metacharacters not allowed"}
	}

	if outsidePaths := pathsOutsideWorkspace(parts); len(outsidePaths) > 0 {
		return PolicyDecision{
			Allowed:          true,
			RequiresApproval: true,
			ApprovalReason:   fmt.Sprintf("accesses path outside /workspace: %s", strings.Join(outsidePaths, ", ")),
			Parts:            parts,
		}
	}

	if err := validateNetwork(parts, cfg); err != nil {
		return PolicyDecision{BlockReason: err.Error()}
	}

	return PolicyDecision{Allowed: true, Parts: parts}
}

func pathsOutsideWorkspace(parts []string) []string {
	cmdName := parts[0]
	if cmdName != "ls" && cmdName != "cat" {
		return nil
	}

	var outside []string
	for _, arg := range parts[1:] {
		if arg == "" || strings.HasPrefix(arg, "-") {
			continue
		}
		if !isPathWithinWorkspace(arg) {
			outside = append(outside, arg)
		}
	}
	return outside
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
	if parts[0] != "curl" {
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
