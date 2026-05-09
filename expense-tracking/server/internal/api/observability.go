package api

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"expense-tracker/internal/wideevent"

	"github.com/google/uuid"
)

type statusRecorder struct {
	http.ResponseWriter
	status      int
	bytes       int
	wroteHeader bool
}

func (r *statusRecorder) WriteHeader(status int) {
	if r.wroteHeader {
		return
	}
	r.status = status
	r.wroteHeader = true
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(body []byte) (int, error) {
	if !r.wroteHeader {
		r.WriteHeader(http.StatusOK)
	}
	n, err := r.ResponseWriter.Write(body)
	r.bytes += n
	return n, err
}

func observabilityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		requestID := requestIDFromHeader(r)
		clientBuild := strings.TrimSpace(r.Header.Get(wideevent.HeaderClientBuild))

		ctx := wideevent.WithAttrBag(r.Context())
		ctx = wideevent.WithRequestID(ctx, requestID)
		if clientBuild != "" {
			ctx = wideevent.WithClientBuild(ctx, clientBuild)
		}
		r = r.WithContext(ctx)

		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		recorder.Header().Set(wideevent.HeaderRequestID, requestID)

		defer func() {
			if recovered := recover(); recovered != nil {
				wideevent.Error(ctx, wideevent.EventHTTPRequestPanic,
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
					slog.Any("panic", recovered),
					slog.String("stack", string(debug.Stack())),
				)
				if !recorder.wroteHeader {
					writeError(recorder, r, http.StatusInternalServerError, "internal server error")
				}
			}

			attrs := []slog.Attr{
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", recorder.status),
				slog.Int("bytes", recorder.bytes),
				slog.Int64("duration_ms", time.Since(start).Milliseconds()),
				slog.String("remote_addr", r.RemoteAddr),
			}
			if userAgent := r.UserAgent(); userAgent != "" {
				attrs = append(attrs, slog.String("user_agent", userAgent))
			}
			attrs = append(attrs, wideevent.Attrs(ctx)...)

			switch {
			case recorder.status >= http.StatusInternalServerError:
				wideevent.Error(ctx, wideevent.EventHTTPRequest, attrs...)
			case recorder.status >= http.StatusBadRequest:
				wideevent.Warn(ctx, wideevent.EventHTTPRequest, attrs...)
			default:
				wideevent.Info(ctx, wideevent.EventHTTPRequest, attrs...)
			}
		}()

		next.ServeHTTP(recorder, r)
	})
}

func requestIDFromHeader(r *http.Request) string {
	requestID := strings.TrimSpace(r.Header.Get(wideevent.HeaderRequestID))
	if requestID != "" {
		return requestID
	}
	return uuid.NewString()
}
