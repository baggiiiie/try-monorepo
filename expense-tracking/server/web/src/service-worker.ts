/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const worker = self as unknown as ServiceWorkerGlobalScope;
const cacheName = `expenses-${version}`;
const shell = ['/', ...build, ...files];

worker.addEventListener('install', (event) => {
	event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shell)));
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
	);
});

// User-consented update flow: the page tells us when to take over so we never
// reload mid-edit (the outbox would survive it, but it's still rude).
worker.addEventListener('message', (event) => {
	if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
		void worker.skipWaiting();
	}
});

async function networkFirst(request: Request, timeoutMs = 3000): Promise<Response> {
	const cache = await caches.open(cacheName);
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const response = await Promise.race([
			fetch(request),
			new Promise<Response>((_, reject) => {
				timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs);
			})
		]);
		if (timeout) clearTimeout(timeout);
		if (request.method === 'GET' && response.ok) {
			await cache.put(request, response.clone());
		}
		return response;
	} catch (error) {
		if (timeout) clearTimeout(timeout);
		const cached = await cache.match(request);
		if (cached) return cached;
		throw error;
	}
}

worker.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (url.origin !== location.origin) return;

	if (event.request.mode === 'navigate') {
		event.respondWith(networkFirst(event.request).catch(() => caches.match('/index.html') as Promise<Response>));
		return;
	}

	if (url.pathname.startsWith('/api/') && event.request.method === 'GET') {
		event.respondWith(networkFirst(event.request));
		return;
	}

	if (event.request.method === 'GET') {
		event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
	}
});
