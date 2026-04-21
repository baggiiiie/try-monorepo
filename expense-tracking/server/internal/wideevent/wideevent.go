package wideevent

import (
	"context"
	"log/slog"
)

const (
	HeaderRequestID   = "X-Request-ID"
	HeaderClientBuild = "X-Client-Build"
)

type contextKey string

const (
	requestIDContextKey   contextKey = "request_id"
	clientBuildContextKey contextKey = "client_build"
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
