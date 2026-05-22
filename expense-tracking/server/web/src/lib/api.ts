// Same-origin HTTP client. Auth credential is the HttpOnly cookie the browser
// attaches automatically; we never read or write it from JavaScript.
//
// Read paths use `apiGet` and surface errors to the caller. Write paths use
// `apiWrite`, which on a *network* failure hands the request to the outbox
// (returning a synthetic "queued" result) and on an HTTP failure returns the
// real status/body so the UI can present it.

import { goto } from '$app/navigation';
import { browser } from '$app/environment';
import { markAuthenticated, markUnauthenticated, setSyncPhase } from './stores';
import { enqueue } from './outbox';

export class ApiError extends Error {
	constructor(public status: number, public body: string) {
		super(`HTTP ${status}: ${body || 'request failed'}`);
		this.name = 'ApiError';
	}
}

type WriteMethod = 'POST' | 'PUT' | 'DELETE';

export type WriteResult<T> =
	| { kind: 'ok'; value: T }
	| { kind: 'queued' } // network failure → handed to outbox
	| { kind: 'error'; error: ApiError };

async function parseJSON<T>(response: Response): Promise<T> {
	if (response.status === 204) return undefined as T;
	const text = await response.text();
	if (!text) return undefined as T;
	return JSON.parse(text) as T;
}

async function handleUnauthorized(): Promise<void> {
	markUnauthenticated();
	if (browser) {
		const here = window.location.pathname;
		if (here !== '/settings') {
			await goto('/settings?reauth=1');
		}
	}
}

export async function apiGet<T>(url: string): Promise<T> {
	const response = await fetch(url, { credentials: 'same-origin' });
	if (response.status === 401) {
		await handleUnauthorized();
		throw new ApiError(401, 'unauthorized');
	}
	if (!response.ok) {
		throw new ApiError(response.status, await response.text().catch(() => ''));
	}
	markAuthenticated();
	return parseJSON<T>(response);
}

export async function apiWrite<T>(
	method: WriteMethod,
	url: string,
	body: unknown,
	targetKey: string
): Promise<WriteResult<T>> {
	let response: Response;
	try {
		response = await fetch(url, {
			method,
			credentials: 'same-origin',
			headers: body == null ? undefined : { 'Content-Type': 'application/json' },
			body: body == null ? undefined : JSON.stringify(body)
		});
	} catch {
		// Network unreachable: queue and let the outbox replay.
		await enqueue({ method, url, body, targetKey });
		setSyncPhase('syncing');
		return { kind: 'queued' };
	}

	if (response.status === 401) {
		await handleUnauthorized();
		return { kind: 'error', error: new ApiError(401, 'unauthorized') };
	}

	if (response.ok || response.status === 204) {
		markAuthenticated();
		const value = await parseJSON<T>(response);
		return { kind: 'ok', value };
	}

	if (response.status >= 500 || response.status === 408 || response.status === 429) {
		// Treat transient server errors like a network failure: queue + retry.
		await enqueue({ method, url, body, targetKey });
		setSyncPhase('syncing');
		return { kind: 'queued' };
	}

	const text = await response.text().catch(() => '');
	return { kind: 'error', error: new ApiError(response.status, text) };
}

export async function exchangeSecret(secret: string): Promise<void> {
	const response = await fetch('/api/auth/exchange', {
		method: 'POST',
		headers: { Authorization: `Bearer ${secret}` },
		credentials: 'same-origin'
	});
	if (!response.ok) {
		throw new ApiError(response.status, await response.text().catch(() => ''));
	}
	markAuthenticated();
}
