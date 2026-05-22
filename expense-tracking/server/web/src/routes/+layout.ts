// Entire web client is a SPA. We need the browser at module-load time
// (Dexie, service worker, navigator.onLine), so disable SSR and let
// adapter-static's fallback serve every route.
export const ssr = false;
export const prerender = false;
