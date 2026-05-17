package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"expense-tracker/internal/singleusersecret"
)

func TestAuthExchangeIssuesSessionCookie(t *testing.T) {
	router := NewRouter(RouterServices{}, "topsecret")

	req := httptest.NewRequest(http.MethodPost, "/api/auth/exchange", nil)
	req.Header.Set("Authorization", "Bearer topsecret")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d (%s)", rec.Code, rec.Body.String())
	}

	cookies := rec.Result().Cookies()
	var session *http.Cookie
	for _, c := range cookies {
		if c.Name == singleusersecret.SessionCookieName {
			session = c
			break
		}
	}
	if session == nil {
		t.Fatalf("expected %s cookie in response, got %+v", singleusersecret.SessionCookieName, cookies)
	}
	if session.Value != "topsecret" {
		t.Fatalf("cookie value: expected secret to be echoed, got %q", session.Value)
	}
	if !session.HttpOnly {
		t.Fatal("cookie must be HttpOnly")
	}
	if !session.Secure {
		t.Fatal("cookie must be Secure")
	}
	if session.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie SameSite: expected Strict, got %v", session.SameSite)
	}
	if session.Path != "/api" {
		t.Fatalf("cookie Path: expected /api, got %q", session.Path)
	}
	if session.MaxAge <= 0 {
		t.Fatalf("cookie MaxAge must be positive, got %d", session.MaxAge)
	}
}

func TestAuthExchangeRejectsMissingCredential(t *testing.T) {
	router := NewRouter(RouterServices{}, "topsecret")

	req := httptest.NewRequest(http.MethodPost, "/api/auth/exchange", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without credential, got %d", rec.Code)
	}
}
