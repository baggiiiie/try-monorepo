package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	webdist "expense-tracker/web"
)

func webStaticHandler() http.Handler {
	dist, err := fs.Sub(webdist.Dist, "dist")
	if err != nil {
		panic(err)
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}

		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}

		if _, err := fs.Stat(dist, name); err != nil {
			// SPA fallback: browser navigations return the app shell.
			// Missing asset paths keep their normal 404 so broken JS/CSS does not
			// silently receive HTML.
			if strings.Contains(path.Base(name), ".") {
				http.NotFound(w, r)
				return
			}
			name = "index.html"
		}

		setStaticCacheHeaders(w, name)
		http.ServeFileFS(w, r, dist, name)
	})
}

func setStaticCacheHeaders(w http.ResponseWriter, name string) {
	switch {
	case name == "index.html":
		w.Header().Set("Cache-Control", "no-cache")
	case name == "sw.js" || name == "service-worker.js":
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Service-Worker-Allowed", "/")
	case name == "manifest.webmanifest":
		w.Header().Set("Content-Type", "application/manifest+json")
	case strings.HasPrefix(name, "_app/immutable/"):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
}
