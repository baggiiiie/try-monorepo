package main

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"
)

type AuditEntry struct {
	Timestamp  string `json:"ts"`
	Command    string `json:"command"`
	Decision   string `json:"decision"`
	Reason     string `json:"reason,omitempty"`
	ExitCode   int    `json:"exit_code,omitempty"`
	DurationMs int64  `json:"duration_ms"`
}

type Auditor struct {
	file *os.File
	enc  *json.Encoder
}

func newAuditor(path string) (*Auditor, error) {
	if strings.TrimSpace(path) == "" {
		return &Auditor{}, nil
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	return &Auditor{
		file: f,
		enc:  json.NewEncoder(f),
	}, nil
}

func (a *Auditor) LogBlocked(command, reason string) {
	if a == nil || a.enc == nil {
		return
	}
	_ = a.enc.Encode(AuditEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Command:   command,
		Decision:  "blocked",
		Reason:    reason,
	})
}

func (a *Auditor) LogExecution(command string, start time.Time, res Result) {
	if a == nil || a.enc == nil {
		return
	}
	entry := AuditEntry{
		Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
		Command:    command,
		Decision:   "executed",
		DurationMs: time.Since(start).Milliseconds(),
		ExitCode:   exitCode(res.Err),
	}
	if res.Timeout {
		entry.Decision = "timeout"
	} else if res.Err != nil {
		entry.Decision = "failed"
		entry.Reason = res.Err.Error()
	}
	_ = a.enc.Encode(entry)
}

func (a *Auditor) Close() error {
	if a == nil || a.file == nil {
		return nil
	}
	return a.file.Close()
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	if ee, ok := errors.AsType[*exec.ExitError](err); ok {
		return ee.ExitCode()
	}
	return -1
}
