package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestServerLogHandlerUsesUTC8Timestamp(t *testing.T) {
	var buf bytes.Buffer
	handler := newServerLogHandler(&buf)

	record := slog.NewRecord(time.Date(2026, 4, 26, 0, 1, 2, 345_000_000, time.UTC), slog.LevelInfo, "server.start", 0)
	if err := handler.Handle(context.Background(), record); err != nil {
		t.Fatalf("handle log record: %v", err)
	}

	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("decode log entry: %v", err)
	}

	got, ok := entry["time"].(string)
	if !ok {
		t.Fatalf("expected string time field, got %#v", entry["time"])
	}
	if !strings.HasPrefix(got, "2026-04-26T08:01:02.345") || !strings.HasSuffix(got, "+08:00") {
		t.Fatalf("expected UTC+8 timestamp, got %q", got)
	}
}
