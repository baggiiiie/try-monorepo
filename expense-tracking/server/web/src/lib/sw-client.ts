// Client-side service worker registration with an explicit update flow.
//
// SvelteKit's auto-registration is disabled in svelte.config.js so we can
// observe `updatefound` and surface a "reload to update" banner instead of
// silently activating a new worker (which would orphan in-flight edits).

import { writable, type Readable } from 'svelte/store';

type UpdateState = {
	available: boolean;
	apply: () => void;
};

const state = writable<UpdateState>({ available: false, apply: () => undefined });

export const updateAvailable: Readable<UpdateState> = state;

let registered = false;

export function registerServiceWorker(): void {
	if (registered) return;
	registered = true;

	if (typeof window === 'undefined') return;
	if (!('serviceWorker' in navigator)) return;

	// `service-worker.js` is the path SvelteKit's adapter-static emits.
	const swUrl = '/service-worker.js';

	void navigator.serviceWorker
		.register(swUrl, { type: 'module', scope: '/' })
		.then((registration) => {
			let reloading = false;
			navigator.serviceWorker.addEventListener('controllerchange', () => {
				if (reloading) return;
				reloading = true;
				window.location.reload();
			});

			const trackWaiting = (worker: ServiceWorker | null) => {
				if (!worker) return;
				const announce = () => {
					if (worker.state === 'installed' && navigator.serviceWorker.controller) {
						state.set({
							available: true,
							apply: () => worker.postMessage({ type: 'SKIP_WAITING' })
						});
					}
				};
				announce();
				worker.addEventListener('statechange', announce);
			};

			trackWaiting(registration.waiting);
			registration.addEventListener('updatefound', () => trackWaiting(registration.installing));
		})
		.catch((error) => {
			console.error('Service worker registration failed', error);
		});
}

export function dismissUpdateBanner(): void {
	state.set({ available: false, apply: () => undefined });
}
