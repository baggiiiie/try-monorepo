package wideevent

import (
	"context"
	"log/slog"
	"sync"
)

// Event names for the unit-of-work events emitted by this codebase.
//
// One unit of work emits exactly one event. Handlers that want to record
// what happened during the unit of work attach attributes via AddAttrs;
// they do not invent their own event names. See ADR 006.
const (
	EventHTTPRequest      = "http.request"
	EventHTTPRequestPanic = "http.request.panic"
	EventCLICommand       = "cli.command"
)

const (
	HeaderRequestID   = "X-Request-ID"
	HeaderClientBuild = "X-Client-Build"
)

type contextKey string

const (
	requestIDContextKey   contextKey = "request_id"
	clientBuildContextKey contextKey = "client_build"
	attrBagContextKey     contextKey = "attr_bag"
)

func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, requestIDContextKey, requestID)
}

func RequestID(ctx context.Context) string {
	requestID, _ := ctx.Value(requestIDContextKey).(string)
	return requestID
}

func WithClientBuild(ctx context.Context, clientBuild string) context.Context {
	return context.WithValue(ctx, clientBuildContextKey, clientBuild)
}

func ClientBuild(ctx context.Context) string {
	clientBuild, _ := ctx.Value(clientBuildContextKey).(string)
	return clientBuild
}

// attrBag accumulates attributes contributed by handlers during a single
// unit of work (an HTTP request or a CLI command invocation). The owning
// emitter — the HTTP middleware or cli.Execute — drains it into the
// single deferred event for that unit of work.
//
// The bag also holds named integer counters (see IncrCounter) that
// callers anywhere in the call stack can bump independently; they are
// surfaced as additional Int64 attrs at drain time. Counters keep
// orthogonal increments (e.g. tx_retries from the SQLite busy-retry
// loop) free of duplicate-key collisions in the final event.
//
// The bag is mutable shared state attached to context. It is intended for
// one-shot enrichment within the request/command lifetime; writes after
// the deferred event has fired are silently ignored.
type attrBag struct {
	mu       sync.Mutex
	attrs    []slog.Attr
	counters map[string]int64
}

// WithAttrBag returns a context carrying a fresh, empty attribute bag.
// Call it once at the top of a unit of work.
func WithAttrBag(ctx context.Context) context.Context {
	return context.WithValue(ctx, attrBagContextKey, &attrBag{})
}

// AddAttrs appends attrs to the in-flight event's attribute bag. If ctx
// has no bag (e.g. outside a unit of work), the call is a silent no-op.
func AddAttrs(ctx context.Context, attrs ...slog.Attr) {
	bag, _ := ctx.Value(attrBagContextKey).(*attrBag)
	if bag == nil {
		return
	}
	bag.mu.Lock()
	bag.attrs = append(bag.attrs, attrs...)
	bag.mu.Unlock()
}

// IncrCounter adds delta to the named counter on ctx's bag. Counters are
// surfaced by Attrs as Int64 attrs only when their value is non-zero, so
// a request that triggers no retries or no materializations does not
// pollute its event with zero-valued noise.
func IncrCounter(ctx context.Context, key string, delta int64) {
	bag, _ := ctx.Value(attrBagContextKey).(*attrBag)
	if bag == nil {
		return
	}
	bag.mu.Lock()
	if bag.counters == nil {
		bag.counters = make(map[string]int64)
	}
	bag.counters[key] += delta
	bag.mu.Unlock()
}

// Attrs returns a copy of the attributes accumulated on ctx's bag,
// followed by any non-zero counter values as Int64 attrs.
func Attrs(ctx context.Context) []slog.Attr {
	bag, _ := ctx.Value(attrBagContextKey).(*attrBag)
	if bag == nil {
		return nil
	}
	bag.mu.Lock()
	defer bag.mu.Unlock()
	if len(bag.attrs) == 0 && len(bag.counters) == 0 {
		return nil
	}
	out := make([]slog.Attr, 0, len(bag.attrs)+len(bag.counters))
	out = append(out, bag.attrs...)
	for k, v := range bag.counters {
		if v == 0 {
			continue
		}
		out = append(out, slog.Int64(k, v))
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func Info(ctx context.Context, event string, attrs ...slog.Attr) {
	slog.LogAttrs(ctx, slog.LevelInfo, event, withContextAttrs(ctx, attrs)...)
}

func Warn(ctx context.Context, event string, attrs ...slog.Attr) {
	slog.LogAttrs(ctx, slog.LevelWarn, event, withContextAttrs(ctx, attrs)...)
}

func Error(ctx context.Context, event string, attrs ...slog.Attr) {
	slog.LogAttrs(ctx, slog.LevelError, event, withContextAttrs(ctx, attrs)...)
}

func withContextAttrs(ctx context.Context, attrs []slog.Attr) []slog.Attr {
	contextAttrs := make([]slog.Attr, 0, 2)
	if requestID := RequestID(ctx); requestID != "" {
		contextAttrs = append(contextAttrs, slog.String("request_id", requestID))
	}
	if clientBuild := ClientBuild(ctx); clientBuild != "" {
		contextAttrs = append(contextAttrs, slog.String("client_build", clientBuild))
	}
	return append(contextAttrs, attrs...)
}
