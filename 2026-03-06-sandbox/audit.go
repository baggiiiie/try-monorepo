package main

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"
)

type Decision string

const (
	DecisionExecuted Decision = "executed"
	DecisionFailed   Decision = "failed"
	DecisionBlocked  Decision = "blocked"
	DecisionDenied   Decision = "denied"
	DecisionTimeout  Decision = "timeout"
)

type AuditEntry struct {
	Timestamp  string `json:"ts"`
	Command    string `json:"command"`
	Decision   string `json:"decision"`
	Reason     string `json:"reason,omitempty"`
	ExitCode   int    `json:"exit_code,omitempty"`
	Timeout    bool   `json:"timeout,omitempty"`
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

func (a *Auditor) LogEvent(command string, decision Decision, reason string, start time.Time, res *Result) {
	if a == nil || a.enc == nil {
		return
	}
	entry := AuditEntry{
		Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
		Command:    command,
		Decision:   string(decision),
		Reason:     reason,
		DurationMs: 0,
	}
	if !start.IsZero() {
		entry.DurationMs = time.Since(start).Milliseconds()
	}
	if res != nil {
		entry.ExitCode = exitCode(res.Err)
		entry.Timeout = res.Timeout
	}
	if reason == "" && res != nil {
		if res.Timeout {
			entry.Decision = string(DecisionTimeout)
		} else if res.Err != nil {
			entry.Decision = string(DecisionFailed)
			entry.Reason = res.Err.Error()
		}
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
