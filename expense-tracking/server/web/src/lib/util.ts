// Small client-only helpers shared across pages.

export function newId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	// Fallback (older Safari). Not cryptographically strong but adequate
	// for a single-user expense ID.
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

export function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

export function nowMillis(): number {
	return Date.now();
}

export function formatMoney(cents: number | null | undefined, currency = 'USD'): string {
	if (cents == null) return '—';
	const major = cents / 100;
	try {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(major);
	} catch {
		return `${currency} ${major.toFixed(2)}`;
	}
}

export function parseAmount(input: string): number | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const value = Number(trimmed);
	if (!Number.isFinite(value)) return null;
	return Math.round(value * 100);
}

export function formatDate(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	return d.toLocaleString();
}

// dayKey produces a "YYYY-MM-DD" bucket using the local timezone, suitable
// for grouping the expense feed.
export function dayKey(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

// dateInputValue converts unix seconds to the "YYYY-MM-DD" shape an
// <input type="date"> wants.
export function dateInputValue(unixSeconds: number): string {
	return dayKey(unixSeconds);
}

// unixFromDateInput parses an "YYYY-MM-DD" value back to unix seconds at
// local midnight.
export function unixFromDateInput(value: string): number {
	const [y, m, d] = value.split('-').map((n) => Number(n));
	const date = new Date(y, (m ?? 1) - 1, d ?? 1);
	return Math.floor(date.getTime() / 1000);
}
