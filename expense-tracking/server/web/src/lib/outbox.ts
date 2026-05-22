// IndexedDB-backed write outbox. Every mutation the PWA sends to the server
// is funneled through here; writes that succeed immediately are not
// persisted, writes that fail with a network error are enqueued and replayed
// when connectivity returns.
//
// Ordering: per `targetKey` FIFO. Writes targeting the same entity (e.g.
// `expense:<uuid>`) replay in the order they were enqueued; writes for
// different keys proceed in parallel.
//
// Status transitions:
//   queued ──network ok──▶ (deleted)
//   queued ──5xx / net──▶ queued (backoff schedule below)
//   queued ──4xx──────▶ failed (surfaced in Settings → Sync errors)

import Dexie, { type Table } from 'dexie';
import { browser } from '$app/environment';
import { setSyncCounts } from './stores';

export type OutboxStatus = 'queued' | 'failed';

export type OutboxRecord = {
	id?: number;
	method: 'POST' | 'PUT' | 'DELETE';
	url: string;
	body: unknown;
	targetKey: string;
	status: OutboxStatus;
	attempts: number;
	lastError?: string;
	nextAttemptAt: number;
	createdAt: number;
};

class OutboxDB extends Dexie {
	records!: Table<OutboxRecord, number>;

	constructor() {
		super('expenses-outbox');
		this.version(1).stores({
			records: '++id, status, targetKey, nextAttemptAt'
		});
	}
}

let db: OutboxDB | null = null;

function getDB(): OutboxDB {
	if (!browser) throw new Error('outbox accessed on server');
	if (!db) db = new OutboxDB();
	return db;
}

// Exponential backoff with a cap. Indices beyond the table reuse the last
// value (30 minutes).
const backoffSchedule = [1_000, 5_000, 30_000, 5 * 60_000, 30 * 60_000];

function backoffFor(attempts: number): number {
	const i = Math.min(attempts, backoffSchedule.length - 1);
	return backoffSchedule[i];
}

export async function enqueue(record: Omit<OutboxRecord, 'id' | 'status' | 'attempts' | 'nextAttemptAt' | 'createdAt'>): Promise<void> {
	const now = Date.now();
	await getDB().records.add({
		...record,
		status: 'queued',
		attempts: 0,
		nextAttemptAt: now,
		createdAt: now
	});
	await refreshCounts();
	void drain();
}

export async function listAll(): Promise<OutboxRecord[]> {
	return getDB().records.toArray();
}

export async function retry(id: number): Promise<void> {
	await getDB().records.update(id, {
		status: 'queued',
		attempts: 0,
		nextAttemptAt: Date.now(),
		lastError: undefined
	});
	await refreshCounts();
	void drain();
}

export async function discard(id: number): Promise<void> {
	await getDB().records.delete(id);
	await refreshCounts();
}

async function refreshCounts(): Promise<void> {
	if (!browser) return;
	const pending = await getDB().records.where('status').equals('queued').count();
	const failed = await getDB().records.where('status').equals('failed').count();
	setSyncCounts(pending, failed);
}

let draining = false;

// drain attempts every queued record whose backoff window has passed. Records
// targeting the same key are processed in FIFO order; different keys run in
// parallel.
export async function drain(): Promise<void> {
	if (!browser) return;
	if (draining) return;
	draining = true;
	try {
		const now = Date.now();
		const due = await getDB()
			.records.where('status')
			.equals('queued')
			.filter((r) => r.nextAttemptAt <= now)
			.sortBy('createdAt');

		// Group by targetKey so each key drains in FIFO without blocking others.
		const groups = new Map<string, OutboxRecord[]>();
		for (const r of due) {
			const list = groups.get(r.targetKey) ?? [];
			list.push(r);
			groups.set(r.targetKey, list);
		}

		await Promise.all(
			Array.from(groups.values()).map(async (records) => {
				for (const record of records) {
					const ok = await attempt(record);
					if (!ok) break; // stop this key's chain until the next drain
				}
			})
		);
	} finally {
		draining = false;
	}
	await refreshCounts();
}

async function attempt(record: OutboxRecord): Promise<boolean> {
	try {
		const response = await fetch(record.url, {
			method: record.method,
			credentials: 'same-origin',
			headers: record.body == null ? undefined : { 'Content-Type': 'application/json' },
			body: record.body == null ? undefined : JSON.stringify(record.body)
		});

		if (response.ok || response.status === 204) {
			await getDB().records.delete(record.id!);
			return true;
		}

		if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
			const text = await response.text().catch(() => '');
			await getDB().records.update(record.id!, {
				status: 'failed',
				lastError: `${response.status}: ${text || response.statusText}`,
				attempts: record.attempts + 1
			});
			return false;
		}

		// 5xx / 408 / 429: retry with backoff.
		const attempts = record.attempts + 1;
		await getDB().records.update(record.id!, {
			attempts,
			lastError: `${response.status}: ${response.statusText}`,
			nextAttemptAt: Date.now() + backoffFor(attempts)
		});
		return false;
	} catch (error) {
		const attempts = record.attempts + 1;
		await getDB().records.update(record.id!, {
			attempts,
			lastError: error instanceof Error ? error.message : String(error),
			nextAttemptAt: Date.now() + backoffFor(attempts)
		});
		return false;
	}
}

let started = false;

export function startOutboxDraining(): void {
	if (started || !browser) return;
	started = true;

	void refreshCounts();
	void drain();

	window.addEventListener('online', () => void drain());
	window.addEventListener('focus', () => void drain());
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') void drain();
	});

	// Best-effort periodic kick so records waiting on backoff eventually retry
	// even if the window stays open and idle.
	setInterval(() => void drain(), 30_000);
}
