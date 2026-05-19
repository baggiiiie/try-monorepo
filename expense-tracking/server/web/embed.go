package web

import "embed"

// Dist contains the built web client assets.
//
// The checked-in dist/index.html is a tiny placeholder so the Go server can
// build before the SvelteKit app is scaffolded. Phase 3 replaces it with the
// real PWA build output.
//
//go:embed all:dist
var Dist embed.FS
