package singleusersecret

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRequireAcceptsBearerHeader(t *testing.T) {
	handler := Require("topsecret", textError)(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/api/x", nil)
	req.Header.Set("Authorization", "Bearer topsecret")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestRequireAcceptsSessionCookie(t *testing.T) {
	handler := Require("topsecret", textError)(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/api/x", nil)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "topsecret"})
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected cookie credential to authenticate, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestRequireRejectsBadCredentialWith401UntilRateLimited(t *testing.T) {
	handler := Require("topsecret", textError)(okHandler())

	// The default bucket allows a burst of 10 failed attempts before the
	// limiter trips and starts returning 429s.
	for i := 0; i < 10; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/x", nil)
		req.Header.Set("Authorization", "Bearer wrong")
		req.RemoteAddr = "10.0.0.1:1234"
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401, got %d", i+1, rec.Code)
		}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/x", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	req.RemoteAddr = "10.0.0.1:1234"
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after burst exhausted, got %d", rec.Code)
	}
}

func TestRequireRateLimitIsPerIP(t *testing.T) {
	handler := Require("topsecret", textError)(okHandler())

	// Exhaust attacker IP A.
	for i := 0; i < 11; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/x", nil)
		req.Header.Set("Authorization", "Bearer wrong")
		req.RemoteAddr = "10.0.0.1:1234"
		handler.ServeHTTP(rec, req)
	}

	// A fresh IP must still get a normal 401 on its first miss.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/x", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	req.RemoteAddr = "10.0.0.2:1234"
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected unrelated IP to get 401, got %d", rec.Code)
	}
}

func TestAuthFailureLimiterRefills(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	lim := newAuthFailureLimiter()
	lim.now = func() time.Time { return now }

	// Burn the bucket.
	for i := 0; i < 10; i++ {
		if !lim.allow("ip") {
			t.Fatalf("attempt %d unexpectedly denied", i+1)
		}
	}
	if lim.allow("ip") {
		t.Fatal("11th attempt should be denied")
	}

	// One token should be back after the refill interval (≈6 seconds).
	now = now.Add(7 * time.Second)
	if !lim.allow("ip") {
		t.Fatal("expected one refilled token to admit a single attempt")
	}
	if lim.allow("ip") {
		t.Fatal("expected bucket to be drained again immediately after")
	}
}

func TestClientIPPrefersProxyHeaders(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "127.0.0.1:5555"
	r.Header.Set("CF-Connecting-IP", "203.0.113.7")

	if got := clientIP(r); got != "203.0.113.7" {
		t.Fatalf("expected CF-Connecting-IP, got %q", got)
	}

	r.Header.Del("CF-Connecting-IP")
	r.Header.Set("X-Forwarded-For", "198.51.100.1, 10.0.0.1")
	if got := clientIP(r); got != "198.51.100.1" {
		t.Fatalf("expected leftmost XFF entry, got %q", got)
	}

	r.Header.Del("X-Forwarded-For")
	if got := clientIP(r); got != "127.0.0.1" {
		t.Fatalf("expected host from RemoteAddr, got %q", got)
	}
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func textError(w http.ResponseWriter, _ *http.Request, status int, msg string) {
	w.WriteHeader(status)
	_, _ = w.Write([]byte(msg))
}
