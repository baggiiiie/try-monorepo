// Cross-cutting client state. Kept in one file because there are only a few
// stores and they reference each other (sync status reads from outbox / auth).

import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';

export type SyncPhase = 'synced' | 'offline' | 'syncing' | 'errors';

export type SyncState = {
	phase: SyncPhase;
	pendingWrites: number;
	failedWrites: number;
};

const initialPhase: SyncPhase = browser && !navigator.onLine ? 'offline' : 'synced';

export const syncState: Writable<SyncState> = writable({
	phase: initialPhase,
	pendingWrites: 0,
	failedWrites: 0
});

export function setSyncPhase(phase: SyncPhase): void {
	syncState.update((s) => ({ ...s, phase }));
}

export function setSyncCounts(pendingWrites: number, failedWrites: number): void {
	syncState.update((s) => {
		let phase = s.phase;
		if (failedWrites > 0) phase = 'errors';
		else if (pendingWrites > 0) phase = 'syncing';
		else if (browser && !navigator.onLine) phase = 'offline';
		else phase = 'synced';
		return { phase, pendingWrites, failedWrites };
	});
}

// authState tracks whether the browser carries a valid session cookie. We
// can't read the HttpOnly cookie directly, so this is a heuristic: it flips
// to `unauthenticated` when any API call returns 401, and back to
// `authenticated` after a successful `/api/auth/exchange`.
export type AuthPhase = 'unknown' | 'authenticated' | 'unauthenticated';
export const authState: Writable<AuthPhase> = writable('unknown');

export function markAuthenticated(): void {
	authState.set('authenticated');
}

export function markUnauthenticated(): void {
	authState.set('unauthenticated');
}
