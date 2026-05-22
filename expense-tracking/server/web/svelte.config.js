import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter({
			pages: 'dist',
			assets: 'dist',
			fallback: 'index.html',
			precompress: false
		}),
		// We register the service worker manually so we can detect updates and
		// surface a "reload" banner instead of taking control mid-edit. See
		// src/lib/sw-client.ts.
		serviceWorker: {
			register: false
		}
	}
};

export default config;
