package api

import (
	"net/http"

	"expense-tracker/internal/singleusersecret"
)

// sessionCookieMaxAge is the lifetime of the PWA session cookie. The cookie
// carries the shared secret, so its lifetime is effectively "until the secret
// rotates"; one year is a reasonable upper bound that survives long stretches
// of PWA inactivity without forcing the user back through the paste-secret
// flow.
const sessionCookieMaxAge = 60 * 60 * 24 * 365

// authExchange swaps an Authorization: Bearer credential for an HttpOnly
// session cookie that subsequent same-origin PWA requests will carry
// automatically. The endpoint sits behind the same Require middleware as the
// rest of /api/*, so by the time control reaches this handler the caller has
// already proven possession of the shared secret (either via the bearer
// header or an existing session cookie). The handler simply copies that
// credential into the cookie so the browser can store it out of JavaScript's
// reach — defending the token against XSS once the server is exposed on the
// public internet via Cloudflare Tunnel.
func authExchange() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		value := singleusersecret.BearerToken(r.Header.Get("Authorization"))
		if value == "" {
			if c, err := r.Cookie(singleusersecret.SessionCookieName); err == nil {
				value = c.Value
			}
		}
		if value == "" {
			// Should be unreachable: the middleware would have already
			// rejected the request. Defensive only.
			writeError(w, r, http.StatusUnauthorized, "unauthorized")
			return
		}

		http.SetCookie(w, &http.Cookie{
			Name:     singleusersecret.SessionCookieName,
			Value:    value,
			Path:     "/api",
			HttpOnly: true,
			Secure:   true,
			SameSite: http.SameSiteStrictMode,
			MaxAge:   sessionCookieMaxAge,
		})
		w.WriteHeader(http.StatusNoContent)
	}
}
