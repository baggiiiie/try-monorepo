// Package singleusersecret implements the shared bearer-token check that
// guards /api/* (except /api/health). The package name is the assumption:
// the system has exactly one principal — the project owner — and they hold
// the secret. There are no users, no sessions, no per-device identity, no
// revocation list. See docs/adr/005-single-user-auth-scope.md for the named
// triggers that force replacing this scheme with real auth.
package singleusersecret

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// secretFile is the on-disk representation of the shared secret.
type secretFile struct {
	Secret string `json:"secret"`
}

// LoadOrCreate returns the secret stored at path. If no file exists, a new
// random 32-byte secret is generated, persisted, and the second return value
// is true to indicate this was a fresh generation (callers may want to print
// it to the operator).
//
// The EXPENSE_SYNC_SECRET environment variable, if set, takes precedence over
// the file and is never written to disk.
func LoadOrCreate(path string) (secret string, generated bool, err error) {
	if env := strings.TrimSpace(os.Getenv("EXPENSE_SYNC_SECRET")); env != "" {
		return env, false, nil
	}

	data, err := os.ReadFile(path)
	if err == nil {
		var sf secretFile
		if jsonErr := json.Unmarshal(data, &sf); jsonErr != nil {
			return "", false, fmt.Errorf("parsing secret file %s: %w", path, jsonErr)
		}
		s := strings.TrimSpace(sf.Secret)
		if s == "" {
			return "", false, fmt.Errorf("secret file %s contains no secret", path)
		}
		return s, false, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", false, fmt.Errorf("reading secret file %s: %w", path, err)
	}

	s, err := generateSecret()
	if err != nil {
		return "", false, err
	}
	if err := writeSecretFile(path, s); err != nil {
		return "", false, err
	}
	return s, true, nil
}

// Rotate generates a new secret and overwrites the file at path with it.
func Rotate(path string) (string, error) {
	s, err := generateSecret()
	if err != nil {
		return "", err
	}
	if err := writeSecretFile(path, s); err != nil {
		return "", err
	}
	return s, nil
}

func generateSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generating secret: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func writeSecretFile(path, secret string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating secret directory: %w", err)
	}
	data, err := json.MarshalIndent(secretFile{Secret: secret}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("writing secret file %s: %w", path, err)
	}
	return nil
}

// Require returns an http.Handler middleware that requires every request to
// carry the configured secret as an "Authorization: Bearer <secret>" header.
// Comparison is constant-time. The errorWriter callback is invoked on failure
// so the caller can render an error in the project's preferred shape.
func Require(secret string, errorWriter func(http.ResponseWriter, *http.Request, int, string)) func(http.Handler) http.Handler {
	want := []byte(secret)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got := bearerToken(r.Header.Get("Authorization"))
			if got == "" || subtle.ConstantTimeCompare([]byte(got), want) != 1 {
				errorWriter(w, r, http.StatusUnauthorized, "unauthorized")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func bearerToken(header string) string {
	const prefix = "Bearer "
	if len(header) <= len(prefix) {
		return ""
	}
	if !strings.EqualFold(header[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}
