package singleusersecret

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// authFailureLimiter is a naive in-memory token bucket per client IP. Its only
// purpose is to slow brute-force guessing of the shared secret once the server
// is exposed on the public internet (see docs/adr/005-single-user-auth-scope.md).
//
// Buckets refill at 1 token every 6 seconds (≈10 attempts per minute) with a
// burst of 10. The first authenticated request from an IP costs nothing —
// only failures consume tokens.
//
// State lives only in memory and resets across restarts; that's an acceptable
// tradeoff for the single-binary deployment this server targets. There is no
// distributed coordination.
type authFailureLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*ipBucket
	now      func() time.Time
	burst    float64
	refill   float64 // tokens per second
	idleTTL  time.Duration
}

type ipBucket struct {
	tokens float64
	last   time.Time
}

func newAuthFailureLimiter() *authFailureLimiter {
	return &authFailureLimiter{
		buckets: make(map[string]*ipBucket),
		now:     time.Now,
		burst:   10,
		refill:  1.0 / 6.0,
		idleTTL: 10 * time.Minute,
	}
}

// allow consumes one token for ip. Returns true if there was budget remaining
// (the caller may respond with the normal 401), false if the IP is currently
// rate-limited and the caller should respond with 429.
func (l *authFailureLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	b, ok := l.buckets[ip]
	if !ok {
		b = &ipBucket{tokens: l.burst, last: now}
		l.buckets[ip] = b
	} else {
		elapsed := now.Sub(b.last).Seconds()
		if elapsed > 0 {
			b.tokens += elapsed * l.refill
			if b.tokens > l.burst {
				b.tokens = l.burst
			}
		}
		b.last = now
	}

	l.gcLocked(now)

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (l *authFailureLimiter) gcLocked(now time.Time) {
	if len(l.buckets) < 64 {
		return
	}
	for ip, b := range l.buckets {
		if now.Sub(b.last) > l.idleTTL {
			delete(l.buckets, ip)
		}
	}
}

// clientIP returns the best-effort source IP for a request, preferring
// proxy-supplied headers (Cloudflare Tunnel sets CF-Connecting-IP) so that
// rate-limiting works when the server sits behind a reverse proxy.
func clientIP(r *http.Request) string {
	if v := r.Header.Get("CF-Connecting-IP"); v != "" {
		return v
	}
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		// XFF can be a comma-separated list; the leftmost is the original client.
		for i := 0; i < len(v); i++ {
			if v[i] == ',' {
				return trimSpace(v[:i])
			}
		}
		return trimSpace(v)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}
