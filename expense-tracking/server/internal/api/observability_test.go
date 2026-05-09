package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"expense-tracker/internal/wideevent"
)

func TestObservabilityMiddlewarePreservesIncomingRequestMetadata(t *testing.T) {
	handler := observabilityMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"request_id":   wideevent.RequestID(r.Context()),
			"client_build": wideevent.ClientBuild(r.Context()),
		})
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set(wideevent.HeaderRequestID, "req-123")
	req.Header.Set(wideevent.HeaderClientBuild, "20260422010101-deadbee")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	if got := recorder.Header().Get(wideevent.HeaderRequestID); got != "req-123" {
		t.Fatalf("expected response request id %q, got %q", "req-123", got)
	}

	var body map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}

	if got := body["request_id"]; got != "req-123" {
		t.Fatalf("expected context request id %q, got %q", "req-123", got)
	}
	if got := body["client_build"]; got != "20260422010101-deadbee" {
		t.Fatalf("expected context client build %q, got %q", "20260422010101-deadbee", got)
	}
}

func TestObservabilityMiddlewareGeneratesRequestIDForErrors(t *testing.T) {
	handler := observabilityMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, http.StatusInternalServerError, "boom")
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	requestID := recorder.Header().Get(wideevent.HeaderRequestID)
	if requestID == "" {
		t.Fatal("expected generated request id header")
	}

	var body errorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}

	if body.Error != "boom" {
		t.Fatalf("expected error %q, got %q", "boom", body.Error)
	}
	if body.RequestID != requestID {
		t.Fatalf("expected body request id %q, got %q", requestID, body.RequestID)
	}
}

func TestObservabilityMiddlewareMergesAttrBagIntoSingleEvent(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	handler := observabilityMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wideevent.AddAttrs(r.Context(), slog.Int("expenses_pushed", 7))
		writeJSON(w, http.StatusOK, struct{}{})
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/sync/push", nil)
	handler.ServeHTTP(httptest.NewRecorder(), req)

	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &entry); err != nil {
		t.Fatalf("expected exactly one JSON log entry, got %q: %v", buf.String(), err)
	}
	if got := entry["msg"]; got != wideevent.EventHTTPRequest {
		t.Fatalf("expected msg %q, got %v", wideevent.EventHTTPRequest, got)
	}
	if got := entry["expenses_pushed"]; got != float64(7) {
		t.Fatalf("expected expenses_pushed=7 from attr bag, got %v", got)
	}
}
